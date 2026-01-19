package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"claude-web-ui/handlers"

	"github.com/gin-gonic/gin"
)

func main() {
	// Parse command line arguments
	port := flag.Int("port", 43210, "Server port")
	logDir := flag.String("log-dir", "./logs", "Log directory")
	flag.Parse()

	// Setup logging to file
	if err := setupLogging(*logDir); err != nil {
		log.Fatalf("Failed to setup logging: %v", err)
	}

	// Set Gin mode
	gin.SetMode(gin.ReleaseMode)

	// Create Gin router
	router := gin.New()

	// Add middleware
	router.Use(recoveryMiddleware())
	router.Use(loggingMiddleware())
	router.Use(corsMiddleware())

	// Health check endpoint
	router.GET("/health", healthCheck())

	// Serve static files from client/dist
	router.Static("/assets", "./client/dist/assets")
	router.StaticFile("/favicon.ico", "./client/dist/favicon.ico")

	// API routes
	api := router.Group("/api")
	{
		api.GET("/sessions", handlers.ListSessions)
		api.POST("/sessions/dirty-check", handlers.CheckSessionsDirty)
		api.GET("/session/:id/info", handlers.GetSession)
		api.GET("/session/:id/history", handlers.GetSessionHistory)
		api.GET("/session/:id/mtime", handlers.GetSessionMtime)
		api.DELETE("/session/:id", handlers.DeleteSession)
		api.POST("/chat", handlers.Chat)
		api.DELETE("/chat", handlers.InterruptChat)
		api.POST("/chat/interactive", handlers.ChatInteractive)
		api.GET("/chat/ws", handlers.ChatWebSocket)
		api.POST("/directories", handlers.ListDirectories)
		api.POST("/files", handlers.ListFiles)
		api.POST("/file/read", handlers.ReadFile)
		api.GET("/commands", handlers.ListCommands)
		api.GET("/config", handlers.GetConfig)
		api.GET("/plugins", handlers.ListPlugins)
		api.GET("/mcp", handlers.GetMCPServers)
		api.POST("/upload", handlers.UploadFile)
		api.GET("/upload/:filename", handlers.GetUploadedFile)
		api.DELETE("/upload/:filename", handlers.DeleteUploadedFile)
		api.GET("/terminal", handlers.TerminalHandler)

		// Active processes
		api.GET("/processes", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"processes": handlers.GetActiveProcesses(),
			})
		})

		// State management (session processing status only - tabs managed client-side)
		api.GET("/state", handlers.GetState)
		api.GET("/state/subscribe", handlers.SubscribeState)
	}

	// Serve index.html for root and any unmatched routes (SPA fallback)
	router.NoRoute(func(c *gin.Context) {
		c.File("./client/dist/index.html")
	})

	// Create HTTPS server (localhost only for security)
	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	server := &http.Server{
		Addr:    addr,
		Handler: router,
	}

	// Signal handling for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP, syscall.SIGQUIT)

	// Start server in goroutine
	go func() {
		log.Printf("Starting HTTPS server on https://%s", addr)
		if err := server.ListenAndServeTLS("cert.pem", "key.pem"); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start HTTPS server: %v", err)
		}
	}()

	// Wait for signal
	sig := <-sigChan
	log.Printf("Received signal: %v. Shutting down gracefully...", sig)

	// Graceful shutdown with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Server shutdown error: %v", err)
	}

	log.Printf("Server stopped")
}

// recoveryMiddleware handles panics and returns 500 errors
func recoveryMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("PANIC recovered: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error": "Internal server error",
				})
				c.Abort()
			}
		}()
		c.Next()
	}
}

// loggingMiddleware logs all requests (except health checks)
func loggingMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		method := c.Request.Method

		c.Next()

		// Skip logging for health check
		if path == "/health" {
			return
		}

		duration := time.Since(start)
		statusCode := c.Writer.Status()

		log.Printf("[%s] %s %d - %v", method, path, statusCode, duration)
	}
}

// corsMiddleware handles CORS
func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE, PATCH")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

// healthCheck returns server health status
func healthCheck() gin.HandlerFunc {
	startTime := time.Now()
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "healthy",
			"uptime":  time.Since(startTime).String(),
			"time":    time.Now().Format(time.RFC3339),
		})
	}
}

// setupLogging configures logging to both stdout and file
func setupLogging(logDir string) error {
	// Create log directory if not exists
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return fmt.Errorf("failed to create log directory: %w", err)
	}

	// Create log file with date
	logFileName := fmt.Sprintf("server_%s.log", time.Now().Format("2006-01-02"))
	logPath := filepath.Join(logDir, logFileName)

	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("failed to open log file: %w", err)
	}

	// Write to both stdout and file
	multiWriter := io.MultiWriter(os.Stdout, logFile)
	log.SetOutput(multiWriter)
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)

	log.Printf("Logging initialized. Log file: %s", logPath)
	return nil
}
