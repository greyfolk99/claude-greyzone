package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	// Maximum upload size: 10MB
	maxUploadSize = 10 * 1024 * 1024
	// Temp directory for uploads
	uploadTempDir = "uploads"
	// Cleanup threshold: 1 hour
	cleanupThreshold = 1 * time.Hour
)

// UploadResponse represents the response for a successful file upload
type UploadResponse struct {
	FilePath string `json:"filePath"`
	FileName string `json:"fileName"`
	FileType string `json:"fileType"`
	FileSize int64  `json:"fileSize"`
}

// Supported image MIME types
var supportedImageTypes = map[string]bool{
	"image/jpeg": true,
	"image/jpg":  true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
}

// Supported image extensions
var supportedImageExts = map[string]bool{
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".gif":  true,
	".webp": true,
}

// UploadFile handles image file uploads via multipart form data
func UploadFile(c *gin.Context) {
	// Parse multipart form with max memory
	if err := c.Request.ParseMultipartForm(maxUploadSize); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "File too large or invalid request"})
		return
	}

	// Get the file from the form
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file provided"})
		return
	}
	defer file.Close()

	// Validate file size
	if header.Size > maxUploadSize {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{
			"error": fmt.Sprintf("File too large (max %dMB)", maxUploadSize/(1024*1024)),
		})
		return
	}

	// Validate file type by extension
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !supportedImageExts[ext] {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{
			"error": fmt.Sprintf("Unsupported file type. Supported: JPEG, PNG, GIF, WebP"),
		})
		return
	}

	// Detect MIME type from file content
	mimeType, err := detectMimeType(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to detect file type"})
		return
	}

	// Validate MIME type
	if !supportedImageTypes[mimeType] {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{
			"error": fmt.Sprintf("Unsupported image type: %s", mimeType),
		})
		return
	}

	// Reset file pointer after reading
	if _, err := file.Seek(0, 0); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process file"})
		return
	}

	// Create temp directory if it doesn't exist
	tempDir := filepath.Join(os.TempDir(), uploadTempDir)
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create upload directory"})
		return
	}

	// Generate unique filename using hash and timestamp
	uniqueFilename, err := generateUniqueFilename(file, ext)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate filename"})
		return
	}

	// Reset file pointer again after hashing
	if _, err := file.Seek(0, 0); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process file"})
		return
	}

	// Create destination file
	destPath := filepath.Join(tempDir, uniqueFilename)
	destFile, err := os.Create(destPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save file"})
		return
	}
	defer destFile.Close()

	// Copy file contents
	written, err := io.Copy(destFile, file)
	if err != nil {
		os.Remove(destPath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save file"})
		return
	}

	// Run cleanup of old files asynchronously
	go CleanupOldUploads()

	// Return success response
	c.JSON(http.StatusOK, UploadResponse{
		FilePath: destPath,
		FileName: uniqueFilename,
		FileType: mimeType,
		FileSize: written,
	})
}

// detectMimeType detects the MIME type from file content
func detectMimeType(file multipart.File) (string, error) {
	// Read first 512 bytes for MIME detection
	buffer := make([]byte, 512)
	n, err := file.Read(buffer)
	if err != nil && err != io.EOF {
		return "", err
	}

	// Detect content type
	mimeType := http.DetectContentType(buffer[:n])
	return mimeType, nil
}

// generateUniqueFilename creates a unique filename using hash and timestamp
func generateUniqueFilename(file multipart.File, ext string) (string, error) {
	// Create hash of file contents
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", err
	}
	hash := hex.EncodeToString(hasher.Sum(nil))

	// Use first 16 characters of hash + timestamp
	timestamp := time.Now().Unix()
	filename := fmt.Sprintf("%s_%d%s", hash[:16], timestamp, ext)

	return filename, nil
}

// CleanupOldUploads removes temporary files older than the cleanup threshold
func CleanupOldUploads() {
	tempDir := filepath.Join(os.TempDir(), uploadTempDir)

	// Check if directory exists
	if _, err := os.Stat(tempDir); os.IsNotExist(err) {
		return
	}

	// Read directory contents
	entries, err := os.ReadDir(tempDir)
	if err != nil {
		return
	}

	// Current time for comparison
	now := time.Now()

	// Iterate through files and remove old ones
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		filePath := filepath.Join(tempDir, entry.Name())
		fileInfo, err := entry.Info()
		if err != nil {
			continue
		}

		// Check if file is older than threshold
		age := now.Sub(fileInfo.ModTime())
		if age > cleanupThreshold {
			// Remove old file
			os.Remove(filePath)
		}
	}
}

// GetUploadedFile serves an uploaded file
func GetUploadedFile(c *gin.Context) {
	filename := c.Param("filename")
	if filename == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Filename is required"})
		return
	}

	// Sanitize filename to prevent directory traversal
	cleanFilename := filepath.Base(filename)
	tempDir := filepath.Join(os.TempDir(), uploadTempDir)
	filePath := filepath.Join(tempDir, cleanFilename)

	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}

	// Serve the file
	c.File(filePath)
}

// DeleteUploadedFile deletes an uploaded file
func DeleteUploadedFile(c *gin.Context) {
	filename := c.Param("filename")
	if filename == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Filename is required"})
		return
	}

	// Sanitize filename
	cleanFilename := filepath.Base(filename)
	tempDir := filepath.Join(os.TempDir(), uploadTempDir)
	filePath := filepath.Join(tempDir, cleanFilename)

	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}

	// Delete the file
	if err := os.Remove(filePath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete file"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
