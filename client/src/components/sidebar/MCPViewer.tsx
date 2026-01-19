import { useState, useEffect } from 'react';
import { X, Server, Globe, Terminal, ChevronDown, ChevronRight, Lock, FolderOpen, User } from 'lucide-react';

interface MCPServerConfig {
  type: string; // "http" or "stdio"
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  source: string; // "user" or "project"
}

interface MCPServer {
  name: string;
  config: MCPServerConfig;
}

interface MCPViewerProps {
  isOpen: boolean;
  onClose: () => void;
  workDir?: string;
}

export function MCPViewer({ isOpen, onClose, workDir = '.' }: MCPViewerProps) {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadServers();
    }
  }, [isOpen, workDir]);

  const loadServers = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/mcp?work_dir=${encodeURIComponent(workDir)}`);

      if (!response.ok) {
        throw new Error('Failed to load MCP servers');
      }

      const data = await response.json();
      setServers(data.servers || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (name: string) => {
    setExpandedServer(expandedServer === name ? null : name);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

      {/* Terminal-style modal */}
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-bg-secondary border border-border flex flex-col animate-scaleIn">
        {/* Terminal header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-tertiary">
          <span className="text-accent-red text-xs">●</span>
          <span className="text-accent-orange text-xs">●</span>
          <span className="text-accent-green text-xs">●</span>
          <span className="text-text-secondary text-xs ml-2">mcp — Model Context Protocol</span>
          <button onClick={onClose} className="ml-auto text-text-secondary hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Command output header */}
        <div className="px-4 py-2 border-b border-border text-sm">
          <span className="text-accent-green">$</span> mcp list --all
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="flex items-center justify-center py-12 text-text-secondary text-sm">
              <span className="text-accent-orange animate-pulse">loading...</span>
            </div>
          )}

          {error && (
            <div className="px-4 py-3 text-sm">
              <span className="text-accent-red">ERROR:</span> {error}
            </div>
          )}

          {!loading && !error && servers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-text-secondary text-sm">
              <p>No MCP servers configured</p>
              <p className="text-xs mt-2 text-text-secondary/70">
                Create ~/.claude/mcp.json or .mcp.json in project
              </p>
            </div>
          )}

          {!loading && !error && servers.length > 0 && (
            <div>
              {servers.map((server, index) => (
                <div key={server.name} className="border-b border-border last:border-0">
                  <button
                    onClick={() => toggleExpand(server.name)}
                    className="w-full flex items-center gap-3 px-4 py-2 hover:bg-bg-tertiary transition-colors text-sm text-left"
                  >
                    {expandedServer === server.name ? (
                      <ChevronDown className="w-3 h-3 text-text-secondary" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-text-secondary" />
                    )}

                    <span className="text-text-secondary">[{index}]</span>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {server.config.type === 'http' ? (
                          <Globe className="w-3 h-3 text-accent-purple" />
                        ) : (
                          <Terminal className="w-3 h-3 text-accent-claude" />
                        )}
                        <span className="text-accent-purple">{server.name}</span>
                        <span className="text-text-secondary text-xs uppercase">[{server.config.type}]</span>
                        {server.config.source === 'user' ? (
                          <span className="text-accent-green text-xs flex items-center gap-1">
                            <User className="w-3 h-3" />
                            user
                          </span>
                        ) : (
                          <span className="text-accent-orange text-xs flex items-center gap-1">
                            <FolderOpen className="w-3 h-3" />
                            project
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 mt-1 text-xs text-text-secondary truncate">
                        {server.config.type === 'http' && server.config.url && (
                          <span className="truncate">{server.config.url}</span>
                        )}
                        {server.config.type === 'stdio' && server.config.command && (
                          <span className="truncate">{server.config.command}</span>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Expanded Details */}
                  {expandedServer === server.name && (
                    <div className="px-4 py-3 pl-12 space-y-3 bg-bg-primary border-t border-border">
                      {/* Type & URL/Command */}
                      {server.config.type === 'http' && server.config.url && (
                        <div>
                          <div className="text-xs text-text-secondary mb-1.5 flex items-center gap-1.5">
                            <Globe className="w-3 h-3" />
                            url:
                          </div>
                          <div className="px-2 py-1.5 bg-bg-tertiary text-xs text-accent-claude font-mono">
                            {server.config.url}
                          </div>
                        </div>
                      )}

                      {server.config.type === 'stdio' && server.config.command && (
                        <div>
                          <div className="text-xs text-text-secondary mb-1.5 flex items-center gap-1.5">
                            <Terminal className="w-3 h-3" />
                            command:
                          </div>
                          <div className="px-2 py-1.5 bg-bg-tertiary text-xs text-accent-claude font-mono">
                            {server.config.command}
                          </div>
                        </div>
                      )}

                      {/* Args */}
                      {server.config.args && server.config.args.length > 0 && (
                        <div>
                          <div className="text-xs text-text-secondary mb-1.5">
                            args:
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {server.config.args.map((arg, idx) => (
                              <span key={idx} className="px-2 py-1 bg-bg-tertiary text-xs text-accent-green font-mono">
                                {arg}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Environment Variables */}
                      {server.config.env && Object.keys(server.config.env).length > 0 && (
                        <div>
                          <div className="text-xs text-text-secondary mb-1.5 flex items-center gap-1.5">
                            <Lock className="w-3 h-3" />
                            environment:
                          </div>
                          <div className="space-y-1">
                            {Object.entries(server.config.env).map(([key, value]) => (
                              <div key={key} className="px-2 py-1.5 bg-bg-tertiary text-xs font-mono">
                                <span className="text-accent-orange">{key}</span>
                                <span className="text-text-secondary">=</span>
                                <span className="text-text-primary">{value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Source */}
                      <div className="pt-2 text-xs text-text-secondary/70 flex items-center gap-1.5">
                        {server.config.source === 'user' ? (
                          <>
                            <User className="w-3 h-3" />
                            ~/.claude/mcp.json
                          </>
                        ) : (
                          <>
                            <FolderOpen className="w-3 h-3" />
                            {workDir}/.mcp.json
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border text-xs text-text-secondary flex items-center justify-between">
          <span>{servers.length} server{servers.length !== 1 ? 's' : ''} configured</span>
          <span className="flex items-center gap-1.5">
            <Server className="w-3 h-3 text-accent-purple" />
            MCP
          </span>
        </div>
      </div>
    </div>
  );
}
