package handlers

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// imagePathRegex matches [Image: /path/to/file.jpg] patterns
var imagePathRegex = regexp.MustCompile(`\[Image:\s*([^\]]+)\]`)

// ProcessInfo holds information about an active process
type ProcessInfo struct {
	Cmd       *exec.Cmd `json:"-"`
	SessionID string    `json:"sessionId"`
	WorkDir   string    `json:"workDir"`
	StartTime int64     `json:"startTime"`
}

// Process management for interruption
var (
	activeProcesses = make(map[int]*ProcessInfo)
	processLock     sync.RWMutex
	processCounter  int
	counterLock     sync.Mutex
)

func getNextProcessID() int {
	counterLock.Lock()
	defer counterLock.Unlock()
	processCounter++
	return processCounter
}

func registerProcess(id int, info *ProcessInfo) {
	processLock.Lock()
	defer processLock.Unlock()
	activeProcesses[id] = info
}

func unregisterProcess(id int) {
	processLock.Lock()
	defer processLock.Unlock()
	delete(activeProcesses, id)
}

func getProcess(id int) *exec.Cmd {
	processLock.RLock()
	defer processLock.RUnlock()
	if info, ok := activeProcesses[id]; ok {
		return info.Cmd
	}
	return nil
}

// ActiveProcessInfo is the public struct for API responses
type ActiveProcessInfo struct {
	ProcessID int    `json:"processId"`
	SessionID string `json:"sessionId"`
	WorkDir   string `json:"workDir"`
	StartTime int64  `json:"startTime"`
}

// GetActiveProcesses returns info about all active processes
func GetActiveProcesses() []ActiveProcessInfo {
	processLock.RLock()
	defer processLock.RUnlock()
	result := make([]ActiveProcessInfo, 0, len(activeProcesses))
	for id, info := range activeProcesses {
		result = append(result, ActiveProcessInfo{
			ProcessID: id,
			SessionID: info.SessionID,
			WorkDir:   info.WorkDir,
			StartTime: info.StartTime,
		})
	}
	return result
}

// ChatRequest represents the request body for chat endpoints
type ChatRequest struct {
	Prompt    string `json:"prompt"`
	SessionID string `json:"sessionId"`
	WorkDir   string `json:"workDir"`
	Continue  bool   `json:"continue"`
	PlanMode  bool   `json:"planMode"`
}

// SSEMessage represents a Server-Sent Event message
type SSEMessage struct {
	Type    string                 `json:"type"`
	Message string                 `json:"message,omitempty"`
	Data    map[string]interface{} `json:"data,omitempty"`
}

// Chat handles the basic chat endpoint with SSE streaming
func Chat(c *gin.Context) {
	var req ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	executeChatStream(c, req, false)
}

// ChatInteractive handles the interactive chat endpoint with optional --continue flag
func ChatInteractive(c *gin.Context) {
	var req ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	executeChatStream(c, req, req.Continue)
}

// InterruptChat handles interrupting an active chat process
func InterruptChat(c *gin.Context) {
	sessionID := c.Query("sessionId")

	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sessionId is required"})
		return
	}

	var processID int
	var cmd *exec.Cmd

	// Find by session ID
	processLock.RLock()
	for pid, info := range activeProcesses {
		if info.SessionID == sessionID {
			processID = pid
			cmd = info.Cmd
			break
		}
	}
	processLock.RUnlock()

	if cmd == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "process not found"})
		return
	}

	// Kill the process
	if cmd.Process != nil {
		if err := cmd.Process.Kill(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to kill process: %v", err)})
			return
		}
	}

	unregisterProcess(processID)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// executeChatStream executes the claude CLI command and streams output via SSE
func executeChatStream(c *gin.Context, req ChatRequest, withContinue bool) {
	// Check if this session is already loading
	if req.SessionID != "" && IsSessionLoading(req.SessionID) {
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		sendSSEError(c, "This session is already processing a request")
		return
	}

	// Set SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Transfer-Encoding", "chunked")

	// Determine working directory - priority: request > session metadata > home
	workDir := req.WorkDir
	if workDir == "" && req.SessionID != "" {
		// Get workDir from Claude CLI session metadata
		workDir = GetSessionWorkDir(req.SessionID)
	}
	if workDir == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			sendSSEError(c, fmt.Sprintf("Failed to get home directory: %v", err))
			return
		}
		workDir = homeDir
	}

	// Validate working directory
	if _, err := os.Stat(workDir); os.IsNotExist(err) {
		sendSSEError(c, fmt.Sprintf("Working directory does not exist: %s", workDir))
		return
	}

	// Extract image paths from prompt and prepare clean prompt
	prompt := req.Prompt
	var imagePaths []string

	matches := imagePathRegex.FindAllStringSubmatch(prompt, -1)
	for _, match := range matches {
		if len(match) > 1 {
			path := strings.TrimSpace(match[1])
			// Verify file exists
			if _, err := os.Stat(path); err == nil {
				imagePaths = append(imagePaths, path)
			}
		}
	}

	// Remove [Image: ...] patterns from prompt text
	cleanPrompt := imagePathRegex.ReplaceAllString(prompt, "")
	cleanPrompt = strings.TrimSpace(cleanPrompt)

	// If only images were sent, add a default prompt
	if cleanPrompt == "" && len(imagePaths) > 0 {
		cleanPrompt = "이 이미지를 분석해줘"
	}

	// Build claude command arguments
	args := []string{
		"-p",
		"--output-format", "stream-json",
		"--verbose",
		"--dangerously-skip-permissions",
	}

	// Add session ID if provided
	if req.SessionID != "" {
		args = append(args, "--resume", req.SessionID)
	}

	// Add continue flag if requested or if no prompt provided
	if withContinue || (cleanPrompt == "" && len(imagePaths) == 0) {
		args = append(args, "--continue")
	}

	// Add image files if any
	for _, imgPath := range imagePaths {
		args = append(args, "--files", imgPath)
	}

	// Add prompt only if not empty
	if cleanPrompt != "" {
		args = append(args, cleanPrompt)
	}

	// Create command
	cmd := exec.Command("claude", args...)
	cmd.Dir = workDir

	// Log the command for debugging
	log.Printf("[CHAT] Executing: claude %s (workDir: %s)", strings.Join(args, " "), workDir)

	// Set up environment
	cmd.Env = os.Environ()

	// Get stdout pipe
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		sendSSEError(c, fmt.Sprintf("Failed to create stdout pipe: %v", err))
		return
	}

	// Get stderr pipe
	stderr, err := cmd.StderrPipe()
	if err != nil {
		sendSSEError(c, fmt.Sprintf("Failed to create stderr pipe: %v", err))
		return
	}

	// Start the command
	if err := cmd.Start(); err != nil {
		sendSSEError(c, fmt.Sprintf("Failed to start claude command: %v", err))
		return
	}

	// Register process for potential interruption
	processID := getNextProcessID()
	registerProcess(processID, &ProcessInfo{
		Cmd:       cmd,
		SessionID: req.SessionID,
		WorkDir:   workDir,
		StartTime: time.Now().Unix(),
	})

	// Track the session ID that will be assigned (for new sessions)
	activeSessionID := req.SessionID

	// Update session state with processId (will be updated with real sessionId when received)
	if activeSessionID != "" {
		SetSessionLoading(activeSessionID, true)
		SetSessionProcessID(activeSessionID, &processID)
	}

	// Cleanup on exit
	defer func() {
		unregisterProcess(processID)
		if activeSessionID != "" {
			SetSessionLoading(activeSessionID, false)
			SetSessionProcessID(activeSessionID, nil)
		}
	}()

	// Send process ID to client
	sendSSEMessage(c, SSEMessage{
		Type:    "processId",
		Message: strconv.Itoa(processID),
	})

	// Create channels for handling output and errors
	doneChan := make(chan error, 1)
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		sendSSEError(c, "Streaming not supported")
		return
	}

	// Read stdout in a goroutine
	go func() {
		scanner := bufio.NewScanner(stdout)
		// Increase buffer size for large lines
		buf := make([]byte, 0, 64*1024)
		scanner.Buffer(buf, 1024*1024)

		for scanner.Scan() {
			line := scanner.Text()
			if line != "" {
				// Forward the line as SSE data
				if _, err := fmt.Fprintf(c.Writer, "data: %s\n\n", line); err != nil {
					return
				}
				flusher.Flush()
			}
		}

		if err := scanner.Err(); err != nil {
			sendSSEMessage(c, SSEMessage{
				Type:    "error",
				Message: fmt.Sprintf("Error reading stdout: %v", err),
			})
			flusher.Flush()
		}
	}()

	// Read stderr in a goroutine
	go func() {
		scanner := bufio.NewScanner(stderr)
		buf := make([]byte, 0, 64*1024)
		scanner.Buffer(buf, 1024*1024)

		for scanner.Scan() {
			line := scanner.Text()
			if line != "" {
				// Send stderr as error messages
				sendSSEMessage(c, SSEMessage{
					Type:    "stderr",
					Message: line,
				})
				flusher.Flush()
			}
		}
	}()

	// Wait for command to finish
	go func() {
		doneChan <- cmd.Wait()
	}()

	// Handle completion or error
	err = <-doneChan
	if err != nil {
		exitErr, ok := err.(*exec.ExitError)
		if ok {
			exitCode := exitErr.ExitCode()
			// Exit code 1 is often used for normal termination (user interrupt, etc.)
			// Exit code -1 or 137 typically means process was killed (SIGKILL)
			// Exit code 130 means SIGINT (Ctrl+C)
			if exitCode == 1 || exitCode == -1 || exitCode == 130 || exitCode == 137 {
				// Treat as normal termination, not an error
				sendSSEMessage(c, SSEMessage{
					Type: "done",
				})
			} else {
				sendSSEMessage(c, SSEMessage{
					Type:    "error",
					Message: fmt.Sprintf("Command exited with error: %v (exit code: %d)", err, exitCode),
				})
			}
		} else {
			sendSSEMessage(c, SSEMessage{
				Type:    "error",
				Message: fmt.Sprintf("Command execution failed: %v", err),
			})
		}
		flusher.Flush()
		return
	}

	// Send completion message
	sendSSEMessage(c, SSEMessage{
		Type: "done",
	})
	flusher.Flush()
}

// sendSSEMessage sends a structured SSE message
func sendSSEMessage(c *gin.Context, msg SSEMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		fmt.Fprintf(c.Writer, "data: {\"type\":\"error\",\"message\":\"Failed to encode message\"}\n\n")
		return
	}
	fmt.Fprintf(c.Writer, "data: %s\n\n", string(data))
}

// sendSSEError sends an error message and closes the stream
func sendSSEError(c *gin.Context, message string) {
	sendSSEMessage(c, SSEMessage{
		Type:    "error",
		Message: message,
	})
	if flusher, ok := c.Writer.(http.Flusher); ok {
		flusher.Flush()
	}
}

// GetWorkingDirectory safely resolves and validates a working directory path
func GetWorkingDirectory(requestedPath string) (string, error) {
	var workDir string

	if requestedPath == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("failed to get home directory: %w", err)
		}
		workDir = homeDir
	} else {
		// Clean and resolve the path
		cleanPath := filepath.Clean(requestedPath)

		// If relative path, make it absolute from home
		if !filepath.IsAbs(cleanPath) {
			homeDir, err := os.UserHomeDir()
			if err != nil {
				return "", fmt.Errorf("failed to get home directory: %w", err)
			}
			cleanPath = filepath.Join(homeDir, cleanPath)
		}

		workDir = cleanPath
	}

	// Validate directory exists
	info, err := os.Stat(workDir)
	if os.IsNotExist(err) {
		return "", fmt.Errorf("directory does not exist: %s", workDir)
	}
	if err != nil {
		return "", fmt.Errorf("failed to stat directory: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("path is not a directory: %s", workDir)
	}

	return workDir, nil
}

// ParseStreamJSON parses a stream-json formatted line from claude CLI
func ParseStreamJSON(line string) (map[string]interface{}, error) {
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(line), &result); err != nil {
		return nil, err
	}
	return result, nil
}

// BuildClaudeCommand constructs the claude CLI command with appropriate flags
func BuildClaudeCommand(prompt, sessionID, workDir string, withContinue bool) *exec.Cmd {
	args := []string{
		"-p",
		"--output-format", "stream-json",
		"--verbose",
		"--dangerously-skip-permissions",
	}

	if sessionID != "" {
		args = append(args, "--resume", sessionID)
	}

	if withContinue {
		args = append(args, "--continue")
	}

	args = append(args, prompt)

	cmd := exec.Command("claude", args...)
	cmd.Dir = workDir
	cmd.Env = os.Environ()

	return cmd
}

// StreamReader reads from an io.Reader and sends lines to a channel
type StreamReader struct {
	reader  io.Reader
	lineCh  chan string
	errorCh chan error
}

// NewStreamReader creates a new stream reader
func NewStreamReader(reader io.Reader) *StreamReader {
	return &StreamReader{
		reader:  reader,
		lineCh:  make(chan string, 100),
		errorCh: make(chan error, 1),
	}
}

// Start begins reading from the stream
func (sr *StreamReader) Start() {
	go func() {
		scanner := bufio.NewScanner(sr.reader)
		buf := make([]byte, 0, 64*1024)
		scanner.Buffer(buf, 1024*1024)

		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line != "" {
				sr.lineCh <- line
			}
		}

		if err := scanner.Err(); err != nil {
			sr.errorCh <- err
		}

		close(sr.lineCh)
		close(sr.errorCh)
	}()
}

// Lines returns the channel for reading lines
func (sr *StreamReader) Lines() <-chan string {
	return sr.lineCh
}

// Errors returns the channel for reading errors
func (sr *StreamReader) Errors() <-chan error {
	return sr.errorCh
}
