import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { X, Terminal as TerminalIcon } from 'lucide-react';
import 'xterm/css/xterm.css';

interface TerminalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Terminal({ isOpen, onClose }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !terminalRef.current) return;

    // Initialize xterm.js
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace",
      fontSize: 14,
      lineHeight: 1.5,
      theme: {
        background: '#0d0d0d',
        foreground: '#e0e0e0',
        cursor: '#da7756',
        cursorAccent: '#0d0d0d',
        selectionBackground: 'rgba(218, 119, 86, 0.3)',
        selectionForeground: '#e0e0e0',
        black: '#0d0d0d',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#fb923c',
        blue: '#60a5fa',
        magenta: '#a78bfa',
        cyan: '#22d3ee',
        white: '#e0e0e0',
        brightBlack: '#707070',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fdba74',
        brightBlue: '#93c5fd',
        brightMagenta: '#c4b5fd',
        brightCyan: '#67e8f9',
        brightWhite: '#f5f5f5',
      },
      allowProposedApi: true,
      scrollback: 10000,
    });

    // Setup addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    // Open terminal in container
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Setup WebSocket connection
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/terminal`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setConnectionError(null);
        term.writeln('\x1b[32m● Connected to terminal server\x1b[0m');
        term.writeln('');
      };

      ws.onmessage = (event) => {
        term.write(event.data);
      };

      ws.onerror = () => {
        setConnectionError('WebSocket connection failed');
        setIsConnected(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
        term.writeln('');
        term.writeln('\x1b[31m● Connection closed\x1b[0m');
      };

      // Handle terminal input
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'Failed to connect');
      term.writeln('\x1b[31m● Failed to connect to terminal server\x1b[0m');
    }

    // Handle window resize
    const handleResize = () => {
      if (fitAddonRef.current && terminalRef.current) {
        try {
          fitAddonRef.current.fit();

          // Send resize info to server
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            const dims = fitAddonRef.current.proposeDimensions();
            if (dims) {
              wsRef.current.send(JSON.stringify({
                type: 'resize',
                cols: dims.cols,
                rows: dims.rows,
              }));
            }
          }
        } catch (err) {
          console.error('Failed to fit terminal:', err);
        }
      }
    };

    window.addEventListener('resize', handleResize);

    // Initial resize after a brief delay to ensure container is rendered
    const resizeTimeout = setTimeout(handleResize, 100);

    // Cleanup
    return () => {
      clearTimeout(resizeTimeout);
      window.removeEventListener('resize', handleResize);

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
      }

      fitAddonRef.current = null;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

      {/* Terminal window */}
      <div className="relative w-full max-w-6xl h-[90vh] bg-bg-secondary border border-border flex flex-col animate-scaleIn">
        {/* Terminal header with dots */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-tertiary">
          <span className="text-accent-red text-xs">●</span>
          <span className="text-accent-orange text-xs">●</span>
          <span className="text-accent-green text-xs">●</span>
          <span className="text-text-secondary text-xs ml-2 flex items-center gap-2">
            <TerminalIcon className="w-3 h-3" />
            terminal — /bin/bash
          </span>
          <button
            onClick={onClose}
            className="ml-auto text-text-secondary hover:text-text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Connection status bar */}
        <div className="px-4 py-2 border-b border-border text-sm flex items-center justify-between bg-bg-secondary">
          <div className="flex items-center gap-2">
            <span className="text-accent-green">$</span>
            <span className="text-text-secondary">bash</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {connectionError && (
              <span className="text-accent-red flex items-center gap-1">
                <span>●</span>
                ERROR: {connectionError}
              </span>
            )}
            {!connectionError && (
              <span className={`flex items-center gap-1 ${isConnected ? 'text-accent-green' : 'text-accent-orange'}`}>
                <span>●</span>
                {isConnected ? 'CONNECTED' : 'CONNECTING...'}
              </span>
            )}
          </div>
        </div>

        {/* Terminal container */}
        <div className="flex-1 overflow-hidden bg-bg-primary">
          <div
            ref={terminalRef}
            className="w-full h-full p-2"
            style={{
              minHeight: 0, // Required for flex child to respect height
            }}
          />
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border text-xs text-text-secondary flex items-center justify-between bg-bg-tertiary">
          <span className="flex items-center gap-2">
            <span>WSL2 • Ubuntu</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className={isConnected ? 'text-accent-green' : 'text-accent-orange'}>●</span>
            TERMINAL
          </span>
        </div>
      </div>
    </div>
  );
}
