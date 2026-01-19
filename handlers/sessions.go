package handlers

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// Session represents a Claude session entry
type Session struct {
	SessionID    string `json:"sessionId"`
	FullPath     string `json:"fullPath"`
	FileMtime    int64  `json:"fileMtime"`
	FirstPrompt  string `json:"firstPrompt"`
	MessageCount int    `json:"messageCount"`
	Created      string `json:"created"`
	Modified     string `json:"modified"`
	GitBranch    string `json:"gitBranch"`
	ProjectPath  string `json:"projectPath"`
	IsSidechain  bool   `json:"isSidechain"`
}

// SessionsIndex represents the sessions-index.json structure
type SessionsIndex struct {
	Version int       `json:"version"`
	Entries []Session `json:"entries"`
}

// Message represents a single message from the .jsonl file
type Message struct {
	Type        string                 `json:"type"`
	UUID        string                 `json:"uuid"`
	Timestamp   string                 `json:"timestamp"`
	Message     map[string]interface{} `json:"message,omitempty"`
	SessionID   string                 `json:"sessionId,omitempty"`
	CWD         string                 `json:"cwd,omitempty"`
	GitBranch   string                 `json:"gitBranch,omitempty"`
	ParentUUID  *string                `json:"parentUuid,omitempty"`
	IsSidechain bool                   `json:"isSidechain,omitempty"`
}

// SessionsResponse is the response for ListSessions
type SessionsResponse struct {
	Sessions []Session `json:"sessions"`
	Total    int       `json:"total"`
}

// HistoryResponse is the response for GetSessionHistory
type HistoryResponse struct {
	Messages []Message `json:"messages"`
	Total    int       `json:"total"`
	SessionID string   `json:"sessionId"`
}

// SessionDirtyCheckRequest represents the request for checking multiple sessions' dirty status
type SessionDirtyCheckRequest struct {
	Sessions []SessionCheckInfo `json:"sessions"`
}

// SessionCheckInfo contains info for checking a single session's dirty status
type SessionCheckInfo struct {
	SessionID  string `json:"sessionId"`
	LastMtime  int64  `json:"lastMtime"`
}

// SessionDirtyCheckResponse represents the response for dirty check
type SessionDirtyCheckResponse struct {
	DirtySessions []DirtySessionInfo `json:"dirtySessions"`
}

// DirtySessionInfo contains info about a dirty session
type DirtySessionInfo struct {
	SessionID string `json:"sessionId"`
	NewMtime  int64  `json:"newMtime"`
}

// getClaudeDir returns the Claude directory path (~/.claude)
func getClaudeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".claude")
}

// getProjectsDir returns the projects directory path (~/.claude/projects)
func getProjectsDir() string {
	return filepath.Join(getClaudeDir(), "projects")
}

// hashProjectPath converts a project path to its directory name
// e.g., /home/seo/apps/yggdrasil -> -home-seo-apps-yggdrasil
func hashProjectPath(projectPath string) string {
	// Replace all slashes with dashes
	result := strings.ReplaceAll(projectPath, "/", "-")
	// Ensure it starts with a single dash
	if !strings.HasPrefix(result, "-") {
		result = "-" + result
	}
	return result
}

// parseUnindexedSession reads a .jsonl file and extracts session metadata
// Returns nil if unable to parse
func parseUnindexedSession(filePath string, dirName string) *Session {
	file, err := os.Open(filePath)
	if err != nil {
		return nil
	}
	defer file.Close()

	// Get file info for modified time
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return nil
	}

	// Extract session ID from filename
	sessionID := strings.TrimSuffix(filepath.Base(filePath), ".jsonl")

	// Convert directory name back to project path (e.g., -home-user-project -> /home/user/project)
	projectPath := strings.ReplaceAll(dirName, "-", "/")
	if !strings.HasPrefix(projectPath, "/") {
		projectPath = "/" + projectPath
	}

	scanner := bufio.NewScanner(file)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)

	var firstPrompt string
	var created string
	var cwd string
	messageCount := 0

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		var msg Message
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			continue
		}

		// Get created timestamp from first message
		if created == "" && msg.Timestamp != "" {
			created = msg.Timestamp
		}

		// Get working directory from summary message
		if msg.Type == "summary" && msg.CWD != "" {
			cwd = msg.CWD
		}

		// Count user/assistant messages
		if msg.Type == "user" || msg.Type == "human" || msg.Type == "assistant" {
			messageCount++

			// Get first prompt from first user message
			if firstPrompt == "" && (msg.Type == "user" || msg.Type == "human") {
				if content, ok := msg.Message["content"]; ok {
					switch v := content.(type) {
					case string:
						firstPrompt = v
					case []interface{}:
						for _, block := range v {
							if blockMap, ok := block.(map[string]interface{}); ok {
								if blockMap["type"] == "text" {
									if text, ok := blockMap["text"].(string); ok {
										firstPrompt = text
										break
									}
								}
							}
						}
					}
				}
			}
		}
	}

	// Skip empty sessions (no messages)
	if messageCount == 0 {
		return nil
	}

	// Truncate first prompt if too long
	if len(firstPrompt) > 100 {
		firstPrompt = firstPrompt[:100] + "..."
	}

	// Note: Don't use cwd from session file - it may be incorrect
	// The directory name (-home-seo) is the source of truth for projectPath (/home/seo)
	_ = cwd // Suppress unused variable warning

	return &Session{
		SessionID:    sessionID,
		FullPath:     filePath,
		FileMtime:    fileInfo.ModTime().Unix(),
		FirstPrompt:  firstPrompt,
		MessageCount: messageCount,
		Created:      created,
		Modified:     fileInfo.ModTime().Format("2006-01-02T15:04:05.000Z"),
		ProjectPath:  projectPath,
	}
}

// ListSessions handles GET /api/sessions
// Query parameters:
//   - work_dir: filter sessions by project path
func ListSessions(c *gin.Context) {
	workDir := c.Query("work_dir")
	projectsDir := getProjectsDir()

	// Check if projects directory exists
	if _, err := os.Stat(projectsDir); os.IsNotExist(err) {
		c.JSON(http.StatusOK, SessionsResponse{
			Sessions: []Session{},
			Total:    0,
		})
		return
	}

	// Read all project directories
	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to read projects directory",
			"details": err.Error(),
		})
		return
	}

	var allSessions []Session
	indexedSessionIDs := make(map[string]bool)

	// Iterate through each project directory
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		projectDir := filepath.Join(projectsDir, entry.Name())
		indexPath := filepath.Join(projectDir, "sessions-index.json")

		// Derive correct projectPath from directory name
		// e.g., -home-seo -> /home/seo
		correctProjectPath := strings.ReplaceAll(entry.Name(), "-", "/")
		if !strings.HasPrefix(correctProjectPath, "/") {
			correctProjectPath = "/" + correctProjectPath
		}

		// Try to read sessions-index.json if it exists
		if data, err := os.ReadFile(indexPath); err == nil {
			var index SessionsIndex
			if err := json.Unmarshal(data, &index); err == nil {
				// Filter sessions by work_dir if specified
				for _, session := range index.Entries {
					// Override projectPath with correct value derived from directory
					session.ProjectPath = correctProjectPath
					if workDir == "" || session.ProjectPath == workDir {
						allSessions = append(allSessions, session)
						indexedSessionIDs[session.SessionID] = true
					}
				}
			}
		}

		// Scan for .jsonl files not in the index
		files, err := os.ReadDir(projectDir)
		if err != nil {
			continue
		}

		for _, file := range files {
			if file.IsDir() || !strings.HasSuffix(file.Name(), ".jsonl") {
				continue
			}

			sessionID := strings.TrimSuffix(file.Name(), ".jsonl")

			// Skip if already in index
			if indexedSessionIDs[sessionID] {
				continue
			}

			// Parse the unindexed session
			filePath := filepath.Join(projectDir, file.Name())
			session := parseUnindexedSession(filePath, entry.Name())
			if session != nil {
				// Filter by work_dir if specified
				if workDir == "" || session.ProjectPath == workDir {
					allSessions = append(allSessions, *session)
				}
			}
		}
	}

	// Sort sessions by modified date (descending)
	sort.Slice(allSessions, func(i, j int) bool {
		return allSessions[i].Modified > allSessions[j].Modified
	})

	// Limit to 50 sessions
	if len(allSessions) > 50 {
		allSessions = allSessions[:50]
	}

	c.JSON(http.StatusOK, SessionsResponse{
		Sessions: allSessions,
		Total:    len(allSessions),
	})
}

// GetSession handles GET /api/session/:id/info
// Returns session metadata (firstPrompt, projectPath, etc.) for a single session
func GetSession(c *gin.Context) {
	sessionID := c.Param("id")
	projectsDir := getProjectsDir()

	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read projects directory"})
		return
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		projectDir := filepath.Join(projectsDir, entry.Name())

		// Derive correct projectPath from directory name
		// e.g., -home-seo -> /home/seo
		correctProjectPath := strings.ReplaceAll(entry.Name(), "-", "/")
		if !strings.HasPrefix(correctProjectPath, "/") {
			correctProjectPath = "/" + correctProjectPath
		}

		// Check sessions-index.json first
		indexPath := filepath.Join(projectDir, "sessions-index.json")
		if data, err := os.ReadFile(indexPath); err == nil {
			var index SessionsIndex
			if err := json.Unmarshal(data, &index); err == nil {
				for _, session := range index.Entries {
					if session.SessionID == sessionID {
						// Override projectPath with correct value derived from directory
						session.ProjectPath = correctProjectPath
						c.JSON(http.StatusOK, session)
						return
					}
				}
			}
		}

		// Check .jsonl file directly
		sessionFile := filepath.Join(projectDir, sessionID+".jsonl")
		if _, err := os.Stat(sessionFile); err == nil {
			session := parseUnindexedSession(sessionFile, entry.Name())
			if session != nil {
				c.JSON(http.StatusOK, session)
				return
			}
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
}

// DeleteSession handles DELETE /api/sessions/:session_id
// URL parameters:
//   - session_id: the session UUID to delete
// Query parameters:
//   - project: project path (optional, used to find the correct project directory)
func DeleteSession(c *gin.Context) {
	sessionID := c.Param("id")
	projectPath := c.Query("project")
	projectsDir := getProjectsDir()

	var sessionFilePath string
	var projectDir string

	// If project path is provided, use it to find the session file
	if projectPath != "" {
		dirName := hashProjectPath(projectPath)
		projectDir = filepath.Join(projectsDir, dirName)
		sessionFilePath = filepath.Join(projectDir, sessionID+".jsonl")
	} else {
		// Search for the session file in all project directories
		entries, err := os.ReadDir(projectsDir)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "Failed to read projects directory",
				"details": err.Error(),
			})
			return
		}

		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}

			candidatePath := filepath.Join(projectsDir, entry.Name(), sessionID+".jsonl")
			if _, err := os.Stat(candidatePath); err == nil {
				sessionFilePath = candidatePath
				projectDir = filepath.Join(projectsDir, entry.Name())
				break
			}
		}
	}

	// Check if session file was found
	if sessionFilePath == "" {
		c.JSON(http.StatusNotFound, gin.H{
			"error": fmt.Sprintf("Session %s not found", sessionID),
		})
		return
	}

	// Check if file exists
	if _, err := os.Stat(sessionFilePath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{
			"error": fmt.Sprintf("Session file not found: %s", sessionID),
		})
		return
	}

	// Delete the session file
	if err := os.Remove(sessionFilePath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to delete session file",
			"details": err.Error(),
		})
		return
	}

	// Update sessions-index.json if it exists
	indexPath := filepath.Join(projectDir, "sessions-index.json")
	if data, err := os.ReadFile(indexPath); err == nil {
		var index SessionsIndex
		if err := json.Unmarshal(data, &index); err == nil {
			// Filter out the deleted session
			newEntries := make([]Session, 0, len(index.Entries))
			for _, entry := range index.Entries {
				if entry.SessionID != sessionID {
					newEntries = append(newEntries, entry)
				}
			}
			index.Entries = newEntries

			// Write updated index
			if newData, err := json.MarshalIndent(index, "", "  "); err == nil {
				os.WriteFile(indexPath, newData, 0644)
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"sessionId": sessionID,
	})
}

// GetSessionHistory handles GET /api/sessions/:session_id/history
// URL parameters:
//   - session_id: the session UUID
// Query parameters:
//   - project: project path (optional, used to find the correct project directory)
//   - limit: maximum number of messages to return (default: 100)
//   - offset: number of messages to skip (default: 0)
func GetSessionHistory(c *gin.Context) {
	sessionID := c.Param("id")
	projectPath := c.Query("project")
	limitStr := c.DefaultQuery("limit", "100")
	offsetStr := c.DefaultQuery("offset", "0")

	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit < 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid limit parameter",
		})
		return
	}

	offset, err := strconv.Atoi(offsetStr)
	if err != nil || offset < 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid offset parameter",
		})
		return
	}

	projectsDir := getProjectsDir()
	var sessionFilePath string

	// If project path is provided, use it to find the session file
	if projectPath != "" {
		// Convert project path to directory name (e.g., /home/user/project -> -home-user-project)
		dirName := hashProjectPath(projectPath)
		sessionFilePath = filepath.Join(projectsDir, dirName, sessionID+".jsonl")
	} else {
		// Search for the session file in all project directories
		entries, err := os.ReadDir(projectsDir)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "Failed to read projects directory",
				"details": err.Error(),
			})
			return
		}

		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}

			candidatePath := filepath.Join(projectsDir, entry.Name(), sessionID+".jsonl")
			if _, err := os.Stat(candidatePath); err == nil {
				sessionFilePath = candidatePath
				break
			}
		}
	}

	// Check if session file was found
	if sessionFilePath == "" {
		c.JSON(http.StatusNotFound, gin.H{
			"error": fmt.Sprintf("Session %s not found", sessionID),
		})
		return
	}

	// Check if file exists
	if _, err := os.Stat(sessionFilePath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{
			"error": fmt.Sprintf("Session file not found: %s", sessionID),
		})
		return
	}

	// Read and parse the .jsonl file
	file, err := os.Open(sessionFilePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to open session file",
			"details": err.Error(),
		})
		return
	}
	defer file.Close()

	var messages []Message
	scanner := bufio.NewScanner(file)

	// Increase buffer size for large lines
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024) // 1MB max line size

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		var msg Message
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			// Log error but continue processing
			fmt.Fprintf(os.Stderr, "Error parsing message line: %v\n", err)
			continue
		}

		// Filter only user, human, and assistant message types
		if msg.Type == "user" || msg.Type == "human" || msg.Type == "assistant" {
			messages = append(messages, msg)
		}
	}

	if err := scanner.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to read session file",
			"details": err.Error(),
		})
		return
	}

	total := len(messages)

	// Return the LAST N messages (most recent) instead of first N
	// This ensures users see their latest conversation
	if total > limit {
		messages = messages[total-limit:]
	}

	c.JSON(http.StatusOK, HistoryResponse{
		Messages:  messages,
		Total:     total,
		SessionID: sessionID,
	})
}

// CheckSessionsDirty handles POST /api/sessions/dirty-check
// Checks multiple sessions for changes by comparing their modification times
func CheckSessionsDirty(c *gin.Context) {
	var req SessionDirtyCheckRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	projectsDir := getProjectsDir()
	var dirtySessions []DirtySessionInfo

	for _, check := range req.Sessions {
		// Search for the session file
		entries, err := os.ReadDir(projectsDir)
		if err != nil {
			continue
		}

		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}

			sessionFile := filepath.Join(projectsDir, entry.Name(), check.SessionID+".jsonl")
			fileInfo, err := os.Stat(sessionFile)
			if err != nil {
				continue
			}

			// Compare mtime
			newMtime := fileInfo.ModTime().Unix()
			if newMtime > check.LastMtime {
				dirtySessions = append(dirtySessions, DirtySessionInfo{
					SessionID: check.SessionID,
					NewMtime:  newMtime,
				})
			}
			break // Found the file, no need to check other directories
		}
	}

	c.JSON(http.StatusOK, SessionDirtyCheckResponse{
		DirtySessions: dirtySessions,
	})
}

// GetSessionMtime handles GET /api/session/:id/mtime
// Returns the modification time of a session file
func GetSessionMtime(c *gin.Context) {
	sessionID := c.Param("id")
	projectsDir := getProjectsDir()

	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read projects directory"})
		return
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		sessionFile := filepath.Join(projectsDir, entry.Name(), sessionID+".jsonl")
		fileInfo, err := os.Stat(sessionFile)
		if err != nil {
			continue
		}

		c.JSON(http.StatusOK, gin.H{
			"sessionId": sessionID,
			"mtime":     fileInfo.ModTime().Unix(),
		})
		return
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
}
