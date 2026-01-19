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

// Session WebSocket Hub - manages connections per session for broadcasting
type SessionHub struct {
	sessions           map[string]map[*WSConnection]bool
	pendingPrompts     map[string]string   // sessionID -> pending user prompt
	accumulatedContent map[string][]string // sessionID -> accumulated data chunks
	mu                 sync.RWMutex
}

var sessionHub = &SessionHub{
	sessions:           make(map[string]map[*WSConnection]bool),
	pendingPrompts:     make(map[string]string),
	accumulatedContent: make(map[string][]string),
}

func (h *SessionHub) Subscribe(sessionID string, ws *WSConnection) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.sessions[sessionID] == nil {
		h.sessions[sessionID] = make(map[*WSConnection]bool)
	}
	h.sessions[sessionID][ws] = true
	log.Printf("[SessionHub] Subscribe session=%s (total=%d)", sessionID, len(h.sessions[sessionID]))

	// Send pending prompt to newly subscribed client if exists
	if prompt, ok := h.pendingPrompts[sessionID]; ok && prompt != "" {
		go ws.SendJSON(map[string]interface{}{
			"type":      "userPrompt",
			"sessionId": sessionID,
			"prompt":    prompt,
		})
		log.Printf("[SessionHub] Sent pending prompt to new subscriber for session=%s", sessionID)
	}

	// Send accumulated content to newly subscribed client (for late joiners)
	if chunks, ok := h.accumulatedContent[sessionID]; ok && len(chunks) > 0 {
		go func() {
			for _, chunk := range chunks {
				ws.SendJSON(map[string]interface{}{
					"type": "data",
					"data": chunk,
				})
			}
			log.Printf("[SessionHub] Sent %d accumulated chunks to new subscriber for session=%s", len(chunks), sessionID)
		}()
	}
}

func (h *SessionHub) Unsubscribe(sessionID string, ws *WSConnection) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.sessions[sessionID] != nil {
		delete(h.sessions[sessionID], ws)
		if len(h.sessions[sessionID]) == 0 {
			delete(h.sessions, sessionID)
		}
	}
}

func (h *SessionHub) Broadcast(sessionID string, msg interface{}) {
	h.mu.RLock()
	conns := h.sessions[sessionID]
	h.mu.RUnlock()
	for ws := range conns {
		ws.SendJSON(msg)
	}
}

func (h *SessionHub) SetPendingPrompt(sessionID string, prompt string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pendingPrompts[sessionID] = prompt
	log.Printf("[SessionHub] Set pending prompt for session=%s: %s", sessionID, prompt)
}

func (h *SessionHub) ClearPendingPrompt(sessionID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.pendingPrompts, sessionID)
	log.Printf("[SessionHub] Cleared pending prompt for session=%s", sessionID)
}

func (h *SessionHub) AppendContent(sessionID string, data string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.accumulatedContent[sessionID] = append(h.accumulatedContent[sessionID], data)
}

func (h *SessionHub) ClearAccumulatedContent(sessionID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.accumulatedContent, sessionID)
	log.Printf("[SessionHub] Cleared accumulated content for session=%s", sessionID)
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

	// Track subscribed sessions for cleanup
	subscribedSessions := make(map[string]bool)
	defer func() {
		for sessionID := range subscribedSessions {
			sessionHub.Unsubscribe(sessionID, ws)
		}
	}()

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
		case "subscribe":
			// Subscribe to session updates
			var req struct {
				SessionID string `json:"sessionId"`
			}
			if err := json.Unmarshal(msg.Payload, &req); err != nil || req.SessionID == "" {
				continue
			}
			sessionHub.Subscribe(req.SessionID, ws)
			subscribedSessions[req.SessionID] = true

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
			log.Printf("[WS] Interrupt requested for session %s", req.SessionID)
			// Find the process first (with RLock), then kill it outside the lock
			var cmdToKill *exec.Cmd
			var pidToUnregister int
			processLock.RLock()
			for pid, info := range activeProcesses {
				if info.SessionID == req.SessionID {
					cmdToKill = info.Cmd
					pidToUnregister = pid
					break
				}
			}
			processLock.RUnlock()

			// Now kill and cleanup outside the lock
			if cmdToKill != nil && cmdToKill.Process != nil {
				log.Printf("[WS] Killing process %d for session %s", pidToUnregister, req.SessionID)
				cmdToKill.Process.Kill()
				unregisterProcess(pidToUnregister)
				SetSessionLoading(req.SessionID, false)
				SetSessionProcessID(req.SessionID, nil)
				log.Printf("[WS] Interrupt complete for session %s", req.SessionID)
			} else {
				log.Printf("[WS] No process found for session %s", req.SessionID)
			}
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
		"--dangerously-skip-permissions",
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

	// Create command using script to force PTY for proper output streaming
	// script -q -c "command" /dev/null forces PTY mode without saving typescript
	// Shell-escape each argument to handle spaces and special characters
	quotedArgs := make([]string, len(args))
	for i, arg := range args {
		// Use single quotes to avoid shell interpretation
		// Replace any single quotes in the arg with '\'' (close quote, escaped quote, open quote)
		escapedArg := strings.ReplaceAll(arg, "'", "'\"'\"'")
		quotedArgs[i] = "'" + escapedArg + "'"
	}
	claudeCmd := "claude " + strings.Join(quotedArgs, " ")
	cmd := exec.Command("script", "-q", "-c", claudeCmd, "/dev/null")
	cmd.Dir = workDir
	cmd.Env = os.Environ()

	log.Printf("[WS] Executing via script: claude %s (workDir: %s)", strings.Join(args, " "), workDir)

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
		// Subscribe sender to this session for broadcasts
		sessionHub.Subscribe(activeSessionID, ws)
	}

	// Cleanup on exit
	defer func() {
		log.Printf("[WS] Cleanup: session %s, process %d", activeSessionID, processID)
		// Update state FIRST (before unregisterProcess to avoid race)
		if activeSessionID != "" {
			log.Printf("[WS] Cleanup: setting session %s loading=false", activeSessionID)
			SetSessionLoading(activeSessionID, false)
			SetSessionProcessID(activeSessionID, nil)
			sessionHub.ClearPendingPrompt(activeSessionID)
			sessionHub.ClearAccumulatedContent(activeSessionID)
		}
		// Then unregister process
		unregisterProcess(processID)
		ws.stdinPipe = nil
		log.Printf("[WS] Cleanup done for session %s", activeSessionID)
	}()

	// Set pending prompt and broadcast to all subscribers (including sender)
	if activeSessionID != "" && req.Prompt != "" {
		sessionHub.SetPendingPrompt(activeSessionID, req.Prompt)
		sessionHub.Broadcast(activeSessionID, map[string]interface{}{
			"type":      "userPrompt",
			"sessionId": activeSessionID,
			"prompt":    req.Prompt,
		})
	}

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
		log.Printf("[WS] Starting stdout reader")
		scanner := bufio.NewScanner(stdout)
		buf := make([]byte, 0, 64*1024)
		scanner.Buffer(buf, 1024*1024)
		log.Printf("[WS] Entering scanner loop")

		for scanner.Scan() {
			line := scanner.Text()
			if len(line) > 100 {
				log.Printf("[WS] stdout line: %s...", line[:100])
			} else {
				log.Printf("[WS] stdout line: %s", line)
			}
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

			// Forward the line - broadcast to all subscribers if session exists
			msg := map[string]interface{}{
				"type": "data",
				"data": line,
			}
			if activeSessionID != "" {
				sessionHub.AppendContent(activeSessionID, line)
				sessionHub.Broadcast(activeSessionID, msg)
			} else {
				ws.SendJSON(msg)
			}
		}
		if err := scanner.Err(); err != nil {
			log.Printf("[WS] Scanner error: %v", err)
		}
		log.Printf("[WS] Stdout reader finished")
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

	// Helper to send or broadcast
	sendOrBroadcast := func(msg map[string]interface{}) {
		if activeSessionID != "" {
			sessionHub.Broadcast(activeSessionID, msg)
		} else {
			ws.SendJSON(msg)
		}
	}

	if err != nil {
		exitErr, ok := err.(*exec.ExitError)
		if ok {
			exitCode := exitErr.ExitCode()
			if exitCode == 1 || exitCode == -1 || exitCode == 130 || exitCode == 137 {
				sendOrBroadcast(map[string]interface{}{
					"type": "done",
				})
			} else {
				sendOrBroadcast(map[string]interface{}{
					"type":    "error",
					"message": fmt.Sprintf("Command exited with error: %v (exit code: %d)", err, exitCode),
				})
			}
		} else {
			sendOrBroadcast(map[string]interface{}{
				"type":    "error",
				"message": fmt.Sprintf("Command execution failed: %v", err),
			})
		}
		return
	}

	sendOrBroadcast(map[string]interface{}{
		"type": "done",
	})
}
