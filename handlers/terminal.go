package handlers

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"unsafe"

	"github.com/creack/pty"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// checkTerminalOrigin validates WebSocket origin for terminal connections
func checkTerminalOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	// Allow requests with no Origin (same-origin or non-browser clients)
	if origin == "" {
		return true
	}

	// Allow localhost variants
	allowedPrefixes := []string{
		"http://localhost",
		"https://localhost",
		"http://127.0.0.1",
		"https://127.0.0.1",
		"http://[::1]",
		"https://[::1]",
	}
	for _, prefix := range allowedPrefixes {
		if strings.HasPrefix(origin, prefix) {
			return true
		}
	}

	// Allow Tailscale IPs (100.x.x.x range)
	if strings.Contains(origin, "://100.") {
		return true
	}

	log.Printf("[Terminal WS] Rejected connection from origin: %s", origin)
	return false
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     checkTerminalOrigin,
}

// ResizeMessage represents a terminal resize message
type ResizeMessage struct {
	Type string `json:"type"`
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

// TerminalHandler handles WebSocket terminal connections
func TerminalHandler(c *gin.Context) {
	// Upgrade HTTP connection to WebSocket
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("Failed to upgrade to WebSocket: %v", err)
		return
	}
	defer conn.Close()

	// Create bash shell command
	cmd := exec.Command("bash")
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	// Start the command with a PTY
	ptmx, err := pty.Start(cmd)
	if err != nil {
		log.Printf("Failed to start PTY: %v", err)
		conn.WriteMessage(websocket.TextMessage, []byte("Failed to start terminal"))
		return
	}
	defer func() {
		ptmx.Close()
		cmd.Process.Kill()
		cmd.Wait()
	}()

	// Use a WaitGroup to ensure proper cleanup
	var wg sync.WaitGroup
	wg.Add(2)

	// Copy PTY output to WebSocket
	go func() {
		defer wg.Done()
		buf := make([]byte, 8192)
		for {
			n, err := ptmx.Read(buf)
			if err != nil {
				if err != io.EOF {
					log.Printf("PTY read error: %v", err)
				}
				return
			}
			if n > 0 {
				if err := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
					log.Printf("WebSocket write error: %v", err)
					return
				}
			}
		}
	}()

	// Copy WebSocket input to PTY
	go func() {
		defer wg.Done()
		for {
			msgType, msg, err := conn.ReadMessage()
			if err != nil {
				if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
					log.Printf("WebSocket read error: %v", err)
				}
				return
			}

			// Handle resize messages (JSON)
			if msgType == websocket.TextMessage {
				var resizeMsg ResizeMessage
				if err := json.Unmarshal(msg, &resizeMsg); err == nil && resizeMsg.Type == "resize" {
					if resizeMsg.Cols > 0 && resizeMsg.Rows > 0 {
						if err := resizePty(ptmx, resizeMsg.Cols, resizeMsg.Rows); err != nil {
							log.Printf("Failed to resize PTY: %v", err)
						}
					}
					continue
				}
			}

			// Write regular terminal input to PTY
			if _, err := ptmx.Write(msg); err != nil {
				log.Printf("PTY write error: %v", err)
				return
			}
		}
	}()

	// Wait for both goroutines to finish
	wg.Wait()
}

// resizePty resizes the PTY to the specified dimensions
func resizePty(ptmx *os.File, cols, rows uint16) error {
	size := struct {
		Row    uint16
		Col    uint16
		Xpixel uint16
		Ypixel uint16
	}{
		Row: rows,
		Col: cols,
	}

	_, _, errno := syscall.Syscall(
		syscall.SYS_IOCTL,
		ptmx.Fd(),
		syscall.TIOCSWINSZ,
		uintptr(unsafe.Pointer(&size)),
	)

	if errno != 0 {
		return errno
	}

	return nil
}
