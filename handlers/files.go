package handlers

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

const maxFileSize = 1 * 1024 * 1024 // 1MB

// FileItem represents a file or directory entry
type FileItem struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Type     string `json:"type"` // "directory" or "file"
	Size     int64  `json:"size"`
	Modified int64  `json:"modified"` // Unix timestamp
}

// DirectoryItem represents a directory entry
type DirectoryItem struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// ListDirectoriesRequest represents the request body for listing directories
type ListDirectoriesRequest struct {
	Path string `json:"path"`
}

// ListDirectoriesResponse represents the response for listing directories
type ListDirectoriesResponse struct {
	Directories []DirectoryItem `json:"directories"`
}

// ListFilesRequest represents the request body for listing files
type ListFilesRequest struct {
	Path string `json:"path"`
}

// ListFilesResponse represents the response for listing files
type ListFilesResponse struct {
	Items []FileItem `json:"items"`
}

// ReadFileRequest represents the request body for reading a file
type ReadFileRequest struct {
	Path string `json:"path"`
}

// ReadFileResponse represents the response for reading a file
type ReadFileResponse struct {
	Content  string `json:"content"`
	Language string `json:"language"`
	Path     string `json:"path"`
	Name     string `json:"name"`
	Size     int64  `json:"size"`
}

var langMap = map[string]string{
	".py":   "python",
	".js":   "javascript",
	".ts":   "typescript",
	".jsx":  "jsx",
	".tsx":  "tsx",
	".json": "json",
	".html": "html",
	".css":  "css",
	".scss": "scss",
	".md":   "markdown",
	".sh":   "bash",
	".yaml": "yaml",
	".yml":  "yaml",
	".xml":  "xml",
	".sql":  "sql",
	".go":   "go",
	".rs":   "rust",
	".java": "java",
	".c":    "c",
	".h":    "c",
	".cpp":  "cpp",
	".rb":   "ruby",
	".php":  "php",
}

// ListDirectories lists all directories in the given path
func ListDirectories(c *gin.Context) {
	var req ListDirectoriesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Default to $HOME if path is empty
	dirPath := req.Path
	if dirPath == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get home directory"})
			return
		}
		dirPath = homeDir
	}

	// Check if path exists
	info, err := os.Stat(dirPath)
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Path does not exist"})
			return
		}
		if os.IsPermission(err) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Permission denied"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if !info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Path is not a directory"})
		return
	}

	// Read directory contents
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		if os.IsPermission(err) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Permission denied"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var directories []DirectoryItem

	// Add parent directory (..) if not at root
	if dirPath != "/" && dirPath != filepath.VolumeName(dirPath)+string(filepath.Separator) {
		parentPath := filepath.Dir(dirPath)
		directories = append(directories, DirectoryItem{
			Name: "..",
			Path: parentPath,
		})
	}

	// Filter and add directories (excluding hidden files)
	for _, entry := range entries {
		name := entry.Name()
		// Skip hidden files (starting with .)
		if strings.HasPrefix(name, ".") {
			continue
		}

		if entry.IsDir() {
			fullPath := filepath.Join(dirPath, name)
			directories = append(directories, DirectoryItem{
				Name: name,
				Path: fullPath,
			})
		}
	}

	c.JSON(http.StatusOK, ListDirectoriesResponse{
		Directories: directories,
	})
}

// ListFiles lists all files and directories in the given path
func ListFiles(c *gin.Context) {
	var req ListFilesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Default to $HOME if path is empty
	dirPath := req.Path
	if dirPath == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get home directory"})
			return
		}
		dirPath = homeDir
	}

	// Check if path exists
	info, err := os.Stat(dirPath)
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Path does not exist"})
			return
		}
		if os.IsPermission(err) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Permission denied"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if !info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Path is not a directory"})
		return
	}

	// Read directory contents
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		if os.IsPermission(err) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Permission denied"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var directories []FileItem
	var files []FileItem

	// Separate directories and files (excluding hidden files)
	for _, entry := range entries {
		name := entry.Name()
		// Skip hidden files (starting with .)
		if strings.HasPrefix(name, ".") {
			continue
		}

		fullPath := filepath.Join(dirPath, name)
		fileInfo, err := entry.Info()
		if err != nil {
			continue
		}

		item := FileItem{
			Name:     name,
			Path:     fullPath,
			Size:     fileInfo.Size(),
			Modified: fileInfo.ModTime().Unix(),
		}

		if entry.IsDir() {
			item.Type = "directory"
			directories = append(directories, item)
		} else {
			item.Type = "file"
			files = append(files, item)
		}
	}

	// Sort directories and files by name
	sort.Slice(directories, func(i, j int) bool {
		return directories[i].Name < directories[j].Name
	})
	sort.Slice(files, func(i, j int) bool {
		return files[i].Name < files[j].Name
	})

	// Combine: directories first, then files
	items := append(directories, files...)

	c.JSON(http.StatusOK, ListFilesResponse{
		Items: items,
	})
}

// ReadFile reads the contents of a file
func ReadFile(c *gin.Context) {
	var req ReadFileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if req.Path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Path is required"})
		return
	}

	// Check if file exists and is a file
	info, err := os.Stat(req.Path)
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "File does not exist"})
			return
		}
		if os.IsPermission(err) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Permission denied"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Path is a directory, not a file"})
		return
	}

	// Check file size
	if info.Size() > maxFileSize {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "File is too large (max 1MB)"})
		return
	}

	// Read file contents
	file, err := os.Open(req.Path)
	if err != nil {
		if os.IsPermission(err) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Permission denied"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read file"})
		return
	}
	defer file.Close()

	contentBytes, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read file"})
		return
	}

	// Check if content is valid UTF-8 (not binary)
	if !utf8.Valid(contentBytes) {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "File is binary"})
		return
	}

	content := string(contentBytes)

	// Detect language from file extension
	ext := strings.ToLower(filepath.Ext(req.Path))
	language := langMap[ext]
	if language == "" {
		language = "plaintext"
	}

	c.JSON(http.StatusOK, ReadFileResponse{
		Content:  content,
		Language: language,
		Path:     req.Path,
		Name:     filepath.Base(req.Path),
		Size:     info.Size(),
	})
}
