import { useState, useEffect, useCallback, memo } from 'react';
import { X, Server, Globe, Terminal, ChevronDown, ChevronRight, Lock, FolderOpen, User } from 'lucide-react';

interface MCPServerConfig {
  type: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  source: string;
}

interface MCPServer {
  name: string;
  config: MCPServerConfig;
}

// ============ Shared Content Component ============

interface MCPViewerContentProps {
  workDir?: string;
  compact?: boolean;
}

export const MCPViewerContent = memo(function MCPViewerContent({
  workDir = '.',
  compact = false,
}: MCPViewerContentProps) {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
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
  }, [workDir]);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const toggleExpand = useCallback((name: string) => {
    setExpandedServer(prev => prev === name ? null : name);
  }, []);

  const textSize = compact ? 'text-xs' : 'text-sm';
  const px = compact ? 'px-2' : 'px-4';
  const py = compact ? 'py-1.5' : 'py-2';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      {compact && (
        <div className="flex items-center justify-between px-4 h-10 border-b border-border bg-bg-secondary">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-accent-purple" />
            <span className="text-accent-purple text-sm">MCP</span>
          </div>
          <span className="text-text-secondary text-xs">{servers.length}</span>
        </div>
      )}

      {/* Command output header */}
      {!compact && (
        <div className="px-4 py-2 border-b border-border text-sm">
          <span className="text-accent-green">$</span> mcp list --all
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className={`flex items-center justify-center py-8 text-text-secondary ${textSize}`}>
            <span className="text-accent-orange animate-pulse">loading...</span>
          </div>
        )}

        {error && (
          <div className={`${px} py-2 ${textSize}`}>
            <span className="text-accent-red">ERROR:</span> {error}
          </div>
        )}

        {!loading && !error && servers.length === 0 && (
          <div className={`flex flex-col items-center justify-center py-8 text-text-secondary ${textSize}`}>
            <p>No MCP servers configured</p>
            {!compact && <p className="text-xs mt-2 text-text-secondary/70">Create ~/.claude/mcp.json or .mcp.json</p>}
          </div>
        )}

        {!loading && !error && servers.length > 0 && (
          <div>
            {servers.map((server, index) => (
              <div key={server.name} className="border-b border-border last:border-0">
                <button
                  onClick={() => toggleExpand(server.name)}
                  className={`w-full flex items-center gap-2 ${px} ${py} hover:bg-bg-tertiary transition-colors ${textSize} text-left`}
                >
                  {expandedServer === server.name ? (
                    <ChevronDown className="w-3 h-3 text-text-secondary" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-text-secondary" />
                  )}

                  {!compact && <span className="text-text-secondary">[{index}]</span>}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {server.config.type === 'http' ? (
                        <Globe className={`${compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} text-accent-purple`} />
                      ) : (
                        <Terminal className={`${compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} text-accent-claude`} />
                      )}
                      <span className="text-accent-purple truncate">{server.name}</span>
                      <span className={`text-text-secondary ${compact ? 'text-[10px]' : 'text-xs'} uppercase`}>[{server.config.type}]</span>
                      {server.config.source === 'user' ? (
                        <span className={`text-accent-green ${compact ? 'text-[10px]' : 'text-xs'} flex items-center gap-0.5`}>
                          <User className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
                          {!compact && 'user'}
                        </span>
                      ) : (
                        <span className={`text-accent-orange ${compact ? 'text-[10px]' : 'text-xs'} flex items-center gap-0.5`}>
                          <FolderOpen className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
                          {!compact && 'project'}
                        </span>
                      )}
                    </div>

                    <div className={`mt-0.5 ${compact ? 'text-[10px]' : 'text-xs'} text-text-secondary truncate`}>
                      {server.config.type === 'http' && server.config.url}
                      {server.config.type === 'stdio' && server.config.command}
                    </div>
                  </div>
                </button>

                {/* Expanded Details */}
                {expandedServer === server.name && (
                  <div className={`${px} py-2 ${compact ? 'pl-6' : 'pl-12'} space-y-2 bg-bg-primary border-t border-border`}>
                    {server.config.type === 'http' && server.config.url && (
                      <div>
                        <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-text-secondary mb-1 flex items-center gap-1`}>
                          <Globe className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
                          url:
                        </div>
                        <div className={`px-1.5 py-1 bg-bg-tertiary ${compact ? 'text-[10px]' : 'text-xs'} text-accent-claude font-mono break-all`}>
                          {server.config.url}
                        </div>
                      </div>
                    )}

                    {server.config.type === 'stdio' && server.config.command && (
                      <div>
                        <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-text-secondary mb-1 flex items-center gap-1`}>
                          <Terminal className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
                          command:
                        </div>
                        <div className={`px-1.5 py-1 bg-bg-tertiary ${compact ? 'text-[10px]' : 'text-xs'} text-accent-claude font-mono`}>
                          {server.config.command}
                        </div>
                      </div>
                    )}

                    {server.config.args && server.config.args.length > 0 && (
                      <div>
                        <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-text-secondary mb-1`}>args:</div>
                        <div className="flex flex-wrap gap-1">
                          {server.config.args.map((arg, idx) => (
                            <span key={idx} className={`px-1.5 py-0.5 bg-bg-tertiary ${compact ? 'text-[10px]' : 'text-xs'} text-accent-green font-mono`}>
                              {arg}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {server.config.env && Object.keys(server.config.env).length > 0 && (
                      <div>
                        <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-text-secondary mb-1 flex items-center gap-1`}>
                          <Lock className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
                          env:
                        </div>
                        <div className="space-y-0.5">
                          {Object.entries(server.config.env).map(([key, value]) => (
                            <div key={key} className={`px-1.5 py-0.5 bg-bg-tertiary ${compact ? 'text-[10px]' : 'text-xs'} font-mono`}>
                              <span className="text-accent-orange">{key}</span>
                              <span className="text-text-secondary">=</span>
                              <span className="text-text-primary">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {!compact && (
                      <div className="pt-1 text-xs text-text-secondary/70 flex items-center gap-1">
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
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {!compact && (
        <div className="px-4 py-2 border-t border-border text-xs text-text-secondary flex items-center justify-between">
          <span>{servers.length} server{servers.length !== 1 ? 's' : ''} configured</span>
          <span className="flex items-center gap-1.5">
            <Server className="w-3 h-3 text-accent-purple" />
            MCP
          </span>
        </div>
      )}
    </div>
  );
});

// ============ Modal Wrapper Component ============

interface MCPViewerProps {
  isOpen: boolean;
  onClose: () => void;
  workDir?: string;
}

export function MCPViewer({ isOpen, onClose, workDir = '.' }: MCPViewerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

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

        <MCPViewerContent workDir={workDir} compact={false} />
      </div>
    </div>
  );
}
