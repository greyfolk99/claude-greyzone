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
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var chatUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for development
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// WebSocket message types
type WSMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// Chat request payload
type WSChatRequest struct {
	Prompt    string `json:"prompt"`
	SessionID string `json:"sessionId,omitempty"`
	WorkDir   string `json:"workDir,omitempty"`
	Continue  bool   `json:"continue,omitempty"`
}

// User input payload (for yes/no responses)
type WSUserInput struct {
	Input string `json:"input"`
}

// WebSocket connection wrapper
type WSConnection struct {
	conn     *websocket.Conn
	send     chan []byte
	done     chan struct{}
	mu       sync.Mutex
	stdinPipe io.WriteCloser
}

func newWSConnection(conn *websocket.Conn) *WSConnection {
	return &WSConnection{
		conn: conn,
		send: make(chan []byte, 256),
		done: make(chan struct{}),
	}
}

func (c *WSConnection) SendJSON(v interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteJSON(v)
}

func (c *WSConnection) Close() {
	close(c.done)
	c.conn.Close()
}

// ChatWebSocket handles WebSocket chat connections
func ChatWebSocket(c *gin.Context) {
	conn, err := chatUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[WS] Upgrade error: %v", err)
		return
	}

	ws := newWSConnection(conn)
	defer ws.Close()

	log.Printf("[WS] New connection established")

	// Read messages from client
	for {
		var msg WSMessage
		if err := conn.ReadJSON(&msg); err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[WS] Read error: %v", err)
			}
			break
		}

		switch msg.Type {
		case "chat":
			var req WSChatRequest
			if err := json.Unmarshal(msg.Payload, &req); err != nil {
				ws.SendJSON(map[string]interface{}{
					"type":    "error",
					"message": "Invalid chat request",
				})
				continue
			}
			go handleWSChat(ws, req)

		case "input":
			// Handle user input (for yes/no responses)
			var input WSUserInput
			if err := json.Unmarshal(msg.Payload, &input); err != nil {
				continue
			}
			// Write to stdin if we have a pipe
			if ws.stdinPipe != nil {
				ws.stdinPipe.Write([]byte(input.Input + "\n"))
			}

		case "interrupt":
			// Handle interrupt - find and kill process
			var req struct {
				SessionID string `json:"sessionId"`
			}
			if err := json.Unmarshal(msg.Payload, &req); err != nil {
				continue
			}
			// Find and kill the process
			processLock.RLock()
			for pid, info := range activeProcesses {
				if info.SessionID == req.SessionID {
					if info.Cmd.Process != nil {
						info.Cmd.Process.Kill()
					}
					unregisterProcess(pid)
					break
				}
			}
			processLock.RUnlock()
		}
	}
}

// handleWSChat executes claude CLI and streams output via WebSocket
func handleWSChat(ws *WSConnection, req WSChatRequest) {
	// Check if session is already loading
	if req.SessionID != "" && IsSessionLoading(req.SessionID) {
		ws.SendJSON(map[string]interface{}{
			"type":    "error",
			"message": "This session is already processing a request",
		})
		return
	}

	// Determine working directory
	workDir := req.WorkDir
	if workDir == "" && req.SessionID != "" {
		workDir = GetSessionWorkDir(req.SessionID)
	}
	if workDir == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			ws.SendJSON(map[string]interface{}{
				"type":    "error",
				"message": fmt.Sprintf("Failed to get home directory: %v", err),
			})
			return
		}
		workDir = homeDir
	}

	// Validate working directory
	if _, err := os.Stat(workDir); os.IsNotExist(err) {
		ws.SendJSON(map[string]interface{}{
			"type":    "error",
			"message": fmt.Sprintf("Working directory does not exist: %s", workDir),
		})
		return
	}

	// Extract image paths from prompt
	prompt := req.Prompt
	var imagePaths []string
	imagePathRegex := regexp.MustCompile(`\[Image:\s*([^\]]+)\]`)

	matches := imagePathRegex.FindAllStringSubmatch(prompt, -1)
	for _, match := range matches {
		if len(match) > 1 {
			path := strings.TrimSpace(match[1])
			if _, err := os.Stat(path); err == nil {
				imagePaths = append(imagePaths, path)
			}
		}
	}

	// Remove [Image: ...] patterns from prompt
	cleanPrompt := imagePathRegex.ReplaceAllString(prompt, "")
	cleanPrompt = strings.TrimSpace(cleanPrompt)

	if cleanPrompt == "" && len(imagePaths) > 0 {
		cleanPrompt = "이 이미지를 분석해줘"
	}

	// Build claude command arguments
	args := []string{
		"-p",
		"--output-format", "stream-json",
		"--verbose",
	}

	if req.SessionID != "" {
		args = append(args, "--resume", req.SessionID)
	}

	if req.Continue || (cleanPrompt == "" && len(imagePaths) == 0) {
		args = append(args, "--continue")
	}

	for _, imgPath := range imagePaths {
		args = append(args, "--files", imgPath)
	}

	if cleanPrompt != "" {
		args = append(args, cleanPrompt)
	}

	// Create command
	cmd := exec.Command("claude", args...)
	cmd.Dir = workDir
	cmd.Env = os.Environ()

	log.Printf("[WS] Executing: claude %s (workDir: %s)", strings.Join(args, " "), workDir)

	// Get pipes
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		ws.SendJSON(map[string]interface{}{
			"type":    "error",
			"message": fmt.Sprintf("Failed to create stdout pipe: %v", err),
		})
		return
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		ws.SendJSON(map[string]interface{}{
			"type":    "error",
			"message": fmt.Sprintf("Failed to create stderr pipe: %v", err),
		})
		return
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		ws.SendJSON(map[string]interface{}{
			"type":    "error",
			"message": fmt.Sprintf("Failed to create stdin pipe: %v", err),
		})
		return
	}
	ws.stdinPipe = stdin

	// Start command
	if err := cmd.Start(); err != nil {
		ws.SendJSON(map[string]interface{}{
			"type":    "error",
			"message": fmt.Sprintf("Failed to start claude command: %v", err),
		})
		return
	}

	// Register process
	processID := getNextProcessID()
	registerProcess(processID, &ProcessInfo{
		Cmd:       cmd,
		SessionID: req.SessionID,
		WorkDir:   workDir,
		StartTime: time.Now().Unix(),
	})

	activeSessionID := req.SessionID
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
		ws.stdinPipe = nil
	}()

	// Send process ID
	ws.SendJSON(map[string]interface{}{
		"type":      "processId",
		"processId": processID,
	})

	// Wait group for readers
	var wg sync.WaitGroup

	// Read stdout
	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		buf := make([]byte, 0, 64*1024)
		scanner.Buffer(buf, 1024*1024)

		for scanner.Scan() {
			line := scanner.Text()
			if line == "" {
				continue
			}

			// Parse JSON to detect input requests
			var data map[string]interface{}
			if err := json.Unmarshal([]byte(line), &data); err == nil {
				// Check for input request (permission prompts, etc.)
				if msgType, ok := data["type"].(string); ok {
					if msgType == "user" {
						// Check if this is an input request
						if msg, ok := data["message"].(map[string]interface{}); ok {
							if content, ok := msg["content"].([]interface{}); ok {
								for _, item := range content {
									if block, ok := item.(map[string]interface{}); ok {
										if blockType, ok := block["type"].(string); ok && blockType == "tool_result" {
											// This might be an input request
											ws.SendJSON(map[string]interface{}{
												"type": "inputRequest",
												"data": data,
											})
											continue
										}
									}
								}
							}
						}
					}
				}
			}

			// Forward the line
			ws.SendJSON(map[string]interface{}{
				"type": "data",
				"data": line,
			})
		}
	}()

	// Read stderr
	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		buf := make([]byte, 0, 64*1024)
		scanner.Buffer(buf, 1024*1024)

		for scanner.Scan() {
			line := scanner.Text()
			if line != "" {
				ws.SendJSON(map[string]interface{}{
					"type":    "stderr",
					"message": line,
				})
			}
		}
	}()

	// Wait for command to finish
	err = cmd.Wait()
	wg.Wait()

	if err != nil {
		exitErr, ok := err.(*exec.ExitError)
		if ok {
			exitCode := exitErr.ExitCode()
			if exitCode == 1 || exitCode == -1 || exitCode == 130 || exitCode == 137 {
				ws.SendJSON(map[string]interface{}{
					"type": "done",
				})
			} else {
				ws.SendJSON(map[string]interface{}{
					"type":    "error",
					"message": fmt.Sprintf("Command exited with error: %v (exit code: %d)", err, exitCode),
				})
			}
		} else {
			ws.SendJSON(map[string]interface{}{
				"type":    "error",
				"message": fmt.Sprintf("Command execution failed: %v", err),
			})
		}
		return
	}

	ws.SendJSON(map[string]interface{}{
		"type": "done",
	})
}
