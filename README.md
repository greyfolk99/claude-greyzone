# Claude Web UI

Personal web interface for Claude CLI.

## Warning

**Recommended for use only in VPN + sandbox environments.**

This project controls Claude CLI processes via web, which poses serious security risks if exposed externally:
- Claude CLI has system command execution privileges
- Exposed web interface enables Remote Code Execution (RCE)
- File system access without authentication

## Features

### Chat
- Multi-tab chat interface
- WebSocket-based real-time message streaming
- Session management (Claude CLI integration)
- Terminal-style dark theme
- Tool block display (git diff view for Edit operations)
- Plan mode toggle

### Multi-device Support
- Session broadcast: View real-time streaming of the same session from other devices
- Server state SSE subscription: Session status sync across all clients
- Running session indicator (color pulse animation in sidebar)

### Sidebar
- File explorer: Directory browsing, working directory change, new session creation
- Session list: Recent/tree view, search, open in new tab, delete
- MCP plugin viewer
- Config viewer (CLAUDE.md, .clauderc)

### Other
- Interrupt: Stop running processes
- Message queue: Support for consecutive message input

## Stack

- **Backend**: Go (Gin, gorilla/websocket, SSE)
- **Frontend**: React, TypeScript, Tailwind CSS, Vite, Zustand

## Running

```bash
# Build client
cd client
bun install
bun run build

# Build and run server
cd ..
go build -o server
./server --port=43210
```

## License

For personal use.
