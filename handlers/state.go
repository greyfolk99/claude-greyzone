package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// TabState represents the minimal state of a single tab
// Messages are NOT stored here - they come from Claude CLI sessions on-demand
type TabState struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionId,omitempty"` // Claude CLI session ID (empty = new session)
	IsLoading bool   `json:"isLoading"`
	ProcessID *int   `json:"processId,omitempty"`
}

// AppState represents the entire application state (in-memory only, no persistence)
type AppState struct {
	Tabs        []TabState `json:"tabs"`
	ActiveTabID string     `json:"activeTabId"`
	Version     int64      `json:"version"`
}

// SSE client for state updates
type StateClient struct {
	ID      string
	Channel chan []byte
	Done    chan struct{}
}

// StateManager handles all state operations with proper concurrency
// This is intentionally in-memory only - no file persistence
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
			Tabs:    []TabState{},
			Version: time.Now().UnixMilli(),
		},
	}

	// Create one default tab on startup
	defaultTab := TabState{
		ID: generateID(),
	}
	stateManager.state.Tabs = []TabState{defaultTab}
	stateManager.state.ActiveTabID = defaultTab.ID

	log.Printf("StateManager initialized (in-memory only, no persistence)")
}

func generateID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return "tab-" + hex.EncodeToString(b)
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
			// Client buffer full - log warning instead of silently dropping
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
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	stateCopy := AppState{
		Tabs:        make([]TabState, len(sm.state.Tabs)),
		ActiveTabID: sm.state.ActiveTabID,
		Version:     sm.state.Version,
	}

	// Copy tabs and sync loading state with actual process state
	for i, tab := range sm.state.Tabs {
		tabCopy := tab
		// If tab has a processId, verify it's still running
		if tab.ProcessID != nil {
			processLock.RLock()
			_, stillRunning := activeProcesses[*tab.ProcessID]
			processLock.RUnlock()
			if !stillRunning {
				// Process finished but state wasn't updated - fix it
				tabCopy.IsLoading = false
				tabCopy.ProcessID = nil
			}
		}
		stateCopy.Tabs[i] = tabCopy
	}
	return stateCopy
}

// FindTab finds a tab by ID
func (sm *StateManager) findTab(tabID string) *TabState {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	for i, t := range sm.state.Tabs {
		if t.ID == tabID {
			return &sm.state.Tabs[i]
		}
	}
	return nil
}

// FindTabBySession finds a tab by session ID (for 1:1 constraint)
func (sm *StateManager) findTabBySession(sessionID string) *TabState {
	if sessionID == "" {
		return nil
	}

	sm.mu.RLock()
	defer sm.mu.RUnlock()

	for i, t := range sm.state.Tabs {
		if t.SessionID == sessionID {
			return &sm.state.Tabs[i]
		}
	}
	return nil
}

// IsSessionOpen checks if a session is already open in any tab
func (sm *StateManager) isSessionOpen(sessionID string) bool {
	return sm.findTabBySession(sessionID) != nil
}

// CreateTab creates a new tab and returns it
func (sm *StateManager) createTab() TabState {
	newTab := TabState{
		ID: generateID(),
	}

	sm.mu.Lock()
	sm.state.Tabs = append(sm.state.Tabs, newTab)
	sm.state.ActiveTabID = newTab.ID
	sm.mu.Unlock()

	sm.broadcast()
	return newTab
}

// DeleteTab removes a tab
func (sm *StateManager) deleteTab(tabID string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	newTabs := make([]TabState, 0, len(sm.state.Tabs))
	for _, t := range sm.state.Tabs {
		if t.ID != tabID {
			newTabs = append(newTabs, t)
		}
	}

	// If no tabs left, create a new empty one
	if len(newTabs) == 0 {
		newTab := TabState{ID: generateID()}
		newTabs = []TabState{newTab}
		sm.state.ActiveTabID = newTab.ID
	} else if sm.state.ActiveTabID == tabID {
		// If deleted tab was active, switch to last tab
		sm.state.ActiveTabID = newTabs[len(newTabs)-1].ID
	}

	sm.state.Tabs = newTabs

	go sm.broadcast()
}

// SetActiveTab sets the active tab
func (sm *StateManager) setActiveTab(tabID string) {
	sm.mu.Lock()
	sm.state.ActiveTabID = tabID
	sm.mu.Unlock()

	sm.broadcast()
}

// SetTabSession sets the session ID for a tab (with 1:1 constraint)
func (sm *StateManager) setTabSession(tabID, sessionID string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	// Check 1:1 constraint: session can only be open in one tab
	if sessionID != "" {
		for _, t := range sm.state.Tabs {
			if t.ID != tabID && t.SessionID == sessionID {
				return fmt.Errorf("session %s is already open in tab %s", sessionID, t.ID)
			}
		}
	}

	// Set session ID
	for i, t := range sm.state.Tabs {
		if t.ID == tabID {
			sm.state.Tabs[i].SessionID = sessionID
			break
		}
	}

	go sm.broadcast()
	return nil
}

// SetTabLoading sets the loading state for a tab
func (sm *StateManager) setTabLoading(tabID string, loading bool) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	for i, t := range sm.state.Tabs {
		if t.ID == tabID {
			sm.state.Tabs[i].IsLoading = loading
			break
		}
	}

	go sm.broadcast()
}

// SetTabProcessID sets the process ID for a tab
func (sm *StateManager) setTabProcessID(tabID string, processID *int) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	for i, t := range sm.state.Tabs {
		if t.ID == tabID {
			sm.state.Tabs[i].ProcessID = processID
			break
		}
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

func CreateTabHandler(c *gin.Context) {
	tab := stateManager.createTab()
	c.JSON(http.StatusOK, tab)
}

func DeleteTabHandler(c *gin.Context) {
	tabID := c.Param("id")
	stateManager.deleteTab(tabID)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func SetActiveTabHandler(c *gin.Context) {
	tabID := c.Param("id")
	stateManager.setActiveTab(tabID)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// SetTabSessionRequest is the request body for setting tab session
type SetTabSessionRequest struct {
	SessionID string `json:"sessionId"`
}

func SetTabSessionHandler(c *gin.Context) {
	tabID := c.Param("id")

	var req SetTabSessionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := stateManager.setTabSession(tabID, req.SessionID); err != nil {
		// Session already open in another tab - return the tab ID
		existingTab := stateManager.findTabBySession(req.SessionID)
		if existingTab != nil {
			c.JSON(http.StatusConflict, gin.H{
				"error":         err.Error(),
				"existingTabId": existingTab.ID,
			})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetSessionTabHandler returns the tab ID for a session (or null if not open)
func GetSessionTabHandler(c *gin.Context) {
	sessionID := c.Param("sessionId")

	tab := stateManager.findTabBySession(sessionID)
	if tab == nil {
		c.JSON(http.StatusOK, gin.H{"tabId": nil})
		return
	}

	c.JSON(http.StatusOK, gin.H{"tabId": tab.ID})
}

// === Internal functions for chat handler ===

func SetTabLoading(tabID string, loading bool) {
	stateManager.setTabLoading(tabID, loading)
}

func SetTabProcessID(tabID string, processID *int) {
	stateManager.setTabProcessID(tabID, processID)
}

func SetTabSession(tabID string, sessionID string) error {
	return stateManager.setTabSession(tabID, sessionID)
}

func IsTabLoading(tabID string) bool {
	tab := stateManager.findTab(tabID)
	if tab == nil {
		return false
	}
	// If tab has a processId, verify it's still actually running
	if tab.IsLoading && tab.ProcessID != nil {
		processLock.RLock()
		_, stillRunning := activeProcesses[*tab.ProcessID]
		processLock.RUnlock()
		if !stillRunning {
			// Process finished but state wasn't updated - fix it now
			stateManager.setTabLoading(tabID, false)
			stateManager.setTabProcessID(tabID, nil)
			return false
		}
	}
	return tab.IsLoading
}

func GetTabSession(tabID string) string {
	tab := stateManager.findTab(tabID)
	if tab == nil {
		return ""
	}
	return tab.SessionID
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
