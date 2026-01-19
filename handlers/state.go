package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// SessionState represents the processing state of a session
type SessionState struct {
	SessionID string `json:"sessionId"`
	IsLoading bool   `json:"isLoading"`
	ProcessID *int   `json:"processId,omitempty"`
}

// AppState represents the server state (session processing status only)
type AppState struct {
	Sessions map[string]*SessionState `json:"sessions"` // sessionId -> state
	Version  int64                    `json:"version"`
}

// SSE client for state updates
type StateClient struct {
	ID      string
	Channel chan []byte
	Done    chan struct{}
}

// StateManager handles session state with proper concurrency
type StateManager struct {
	state    AppState
	mu       sync.RWMutex
	clients  map[string]*StateClient
	clientMu sync.RWMutex
}

var stateManager *StateManager

func init() {
	stateManager = &StateManager{
		clients: make(map[string]*StateClient),
		state: AppState{
			Sessions: make(map[string]*SessionState),
			Version:  time.Now().UnixMilli(),
		},
	}

	log.Printf("StateManager initialized (session state only, tabs managed client-side)")
}

func generateID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// Broadcast state to all connected clients
func (sm *StateManager) broadcast() {
	sm.mu.Lock()
	sm.state.Version = time.Now().UnixMilli()
	data, _ := json.Marshal(sm.state)
	sm.mu.Unlock()

	sm.clientMu.RLock()
	defer sm.clientMu.RUnlock()

	for _, client := range sm.clients {
		select {
		case client.Channel <- data:
		default:
			log.Printf("Warning: client %s buffer full, state update dropped", client.ID)
		}
	}
}

// AddClient adds a new SSE client
func (sm *StateManager) addClient() *StateClient {
	client := &StateClient{
		ID:      generateID(),
		Channel: make(chan []byte, 10),
		Done:    make(chan struct{}),
	}

	sm.clientMu.Lock()
	sm.clients[client.ID] = client
	sm.clientMu.Unlock()

	return client
}

// RemoveClient removes an SSE client
func (sm *StateManager) removeClient(id string) {
	sm.clientMu.Lock()
	defer sm.clientMu.Unlock()

	if client, ok := sm.clients[id]; ok {
		close(client.Done)
		delete(sm.clients, id)
	}
}

// GetState returns a copy of current state with synced process info
func (sm *StateManager) getState() AppState {
	// First, get a snapshot of active processes (lock order: processLock first)
	processLock.RLock()
	activeProcessSnapshot := make(map[int]bool)
	for pid := range activeProcesses {
		activeProcessSnapshot[pid] = true
	}
	processLock.RUnlock()

	// Now check for stale sessions with state lock
	sm.mu.Lock()
	sessionsToClean := []string{}
	for sessionId, session := range sm.state.Sessions {
		if session.ProcessID != nil {
			if !activeProcessSnapshot[*session.ProcessID] {
				// Process finished but state wasn't updated - fix it now
				session.IsLoading = false
				session.ProcessID = nil
				// Mark for cleanup if no longer needed
				if !session.IsLoading {
					sessionsToClean = append(sessionsToClean, sessionId)
				}
			}
		}
	}
	// Clean up stale sessions
	for _, sessionId := range sessionsToClean {
		delete(sm.state.Sessions, sessionId)
	}
	needsBroadcast := len(sessionsToClean) > 0
	sm.mu.Unlock()

	// Broadcast if we cleaned up stale sessions
	if needsBroadcast {
		go sm.broadcast()
	}

	// Now return a copy
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	stateCopy := AppState{
		Sessions: make(map[string]*SessionState),
		Version:  sm.state.Version,
	}

	for sessionId, session := range sm.state.Sessions {
		sessionCopy := &SessionState{
			SessionID: session.SessionID,
			IsLoading: session.IsLoading,
			ProcessID: session.ProcessID,
		}
		stateCopy.Sessions[sessionId] = sessionCopy
	}
	return stateCopy
}

// GetSessionState returns state for a specific session
func (sm *StateManager) getSessionState(sessionId string) *SessionState {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	if session, ok := sm.state.Sessions[sessionId]; ok {
		return session
	}
	return nil
}

// SetSessionLoading sets the loading state for a session
func (sm *StateManager) setSessionLoading(sessionId string, loading bool) {
	if sessionId == "" {
		return
	}

	sm.mu.Lock()
	defer sm.mu.Unlock()

	if _, ok := sm.state.Sessions[sessionId]; !ok {
		sm.state.Sessions[sessionId] = &SessionState{
			SessionID: sessionId,
		}
	}
	sm.state.Sessions[sessionId].IsLoading = loading

	// Clean up if session is no longer loading and has no process
	if !loading && sm.state.Sessions[sessionId].ProcessID == nil {
		delete(sm.state.Sessions, sessionId)
	}

	go sm.broadcast()
}

// SetSessionProcessID sets the process ID for a session
func (sm *StateManager) setSessionProcessID(sessionId string, processID *int) {
	if sessionId == "" {
		return
	}

	sm.mu.Lock()
	defer sm.mu.Unlock()

	if _, ok := sm.state.Sessions[sessionId]; !ok {
		sm.state.Sessions[sessionId] = &SessionState{
			SessionID: sessionId,
		}
	}
	sm.state.Sessions[sessionId].ProcessID = processID

	// Clean up if session is no longer loading and has no process
	if !sm.state.Sessions[sessionId].IsLoading && processID == nil {
		delete(sm.state.Sessions, sessionId)
	}

	go sm.broadcast()
}

// === HTTP Handlers ===

func GetState(c *gin.Context) {
	c.JSON(http.StatusOK, stateManager.getState())
}

func SubscribeState(c *gin.Context) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Streaming not supported"})
		return
	}

	client := stateManager.addClient()
	defer stateManager.removeClient(client.ID)

	// Send initial state
	stateManager.mu.RLock()
	data, _ := json.Marshal(stateManager.state)
	stateManager.mu.RUnlock()

	c.Writer.Write([]byte("data: "))
	c.Writer.Write(data)
	c.Writer.Write([]byte("\n\n"))
	flusher.Flush()

	// Heartbeat ticker
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	ctx := c.Request.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := c.Writer.Write([]byte(": heartbeat\n\n")); err != nil {
				return
			}
			flusher.Flush()
		case data := <-client.Channel:
			if _, err := c.Writer.Write([]byte("data: ")); err != nil {
				return
			}
			if _, err := c.Writer.Write(data); err != nil {
				return
			}
			if _, err := c.Writer.Write([]byte("\n\n")); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// === Internal functions for chat handler ===

func SetSessionLoading(sessionId string, loading bool) {
	stateManager.setSessionLoading(sessionId, loading)
}

func SetSessionProcessID(sessionId string, processID *int) {
	stateManager.setSessionProcessID(sessionId, processID)
}

func IsSessionLoading(sessionId string) bool {
	// Get snapshot of active processes first (lock order: processLock before sm.mu)
	processLock.RLock()
	activeProcessSnapshot := make(map[int]bool)
	for pid := range activeProcesses {
		activeProcessSnapshot[pid] = true
	}
	processLock.RUnlock()

	session := stateManager.getSessionState(sessionId)
	if session == nil {
		return false
	}
	// If session has a processId, verify it's still actually running
	if session.IsLoading && session.ProcessID != nil {
		if !activeProcessSnapshot[*session.ProcessID] {
			// Process finished but state wasn't updated - fix it now
			stateManager.setSessionLoading(sessionId, false)
			stateManager.setSessionProcessID(sessionId, nil)
			return false
		}
	}
	return session.IsLoading
}

// GetSessionWorkDir returns the workDir for a session by finding its file location
func GetSessionWorkDir(sessionID string) string {
	if sessionID == "" {
		log.Printf("[GetSessionWorkDir] Empty sessionID")
		return ""
	}

	// Find the session file and derive workDir from its location
	projectsDir := getProjectsDir()
	if projectsDir == "" {
		log.Printf("[GetSessionWorkDir] Empty projectsDir")
		return ""
	}

	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		log.Printf("[GetSessionWorkDir] Failed to read projectsDir: %v", err)
		return ""
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		sessionFile := filepath.Join(projectsDir, entry.Name(), sessionID+".jsonl")
		if _, err := os.Stat(sessionFile); err == nil {
			// Found the session file - derive workDir from directory name
			// e.g., -home-seo -> /home/seo
			dirName := entry.Name()
			workDir := strings.ReplaceAll(dirName, "-", "/")
			if !strings.HasPrefix(workDir, "/") {
				workDir = "/" + workDir
			}
			log.Printf("[GetSessionWorkDir] sessionID=%s -> workDir=%s", sessionID, workDir)
			return workDir
		}
	}
	log.Printf("[GetSessionWorkDir] Session not found: %s", sessionID)
	return ""
}

// getAllSessions scans all Claude CLI sessions from ~/.claude/projects
// Includes both indexed sessions and unindexed .jsonl files
func getAllSessions() []Session {
	projectsDir := getProjectsDir()
	if projectsDir == "" {
		return []Session{}
	}

	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		return []Session{}
	}

	var allSessions []Session
	indexedSessionIDs := make(map[string]bool)

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		projectDir := filepath.Join(projectsDir, entry.Name())
		indexPath := filepath.Join(projectDir, "sessions-index.json")

		// Try to read sessions from index
		if data, err := os.ReadFile(indexPath); err == nil {
			var index SessionsIndex
			if err := json.Unmarshal(data, &index); err == nil {
				for _, session := range index.Entries {
					allSessions = append(allSessions, session)
					indexedSessionIDs[session.SessionID] = true
				}
			}
		}

		// Scan for unindexed .jsonl files
		files, err := os.ReadDir(projectDir)
		if err != nil {
			continue
		}

		for _, file := range files {
			if file.IsDir() || !strings.HasSuffix(file.Name(), ".jsonl") {
				continue
			}

			sessionID := strings.TrimSuffix(file.Name(), ".jsonl")
			if indexedSessionIDs[sessionID] {
				continue
			}

			// Parse unindexed session
			filePath := filepath.Join(projectDir, file.Name())
			session := parseUnindexedSession(filePath, entry.Name())
			if session != nil {
				allSessions = append(allSessions, *session)
			}
		}
	}

	return allSessions
}
