import { useState, useEffect } from 'react';
import { X, Puzzle, Terminal, Bot, Sparkles, ChevronDown, ChevronRight } from 'lucide-react';

interface Plugin {
  name: string;
  version: string;
  path: string;
  enabled: boolean;
  commands: string[];
  agents: string[];
  skills: string[];
}

interface PluginsViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PluginsViewer({ isOpen, onClose }: PluginsViewerProps) {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadPlugins();
    }
  }, [isOpen]);

  const loadPlugins = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/plugins');

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text || 'Failed to load plugins'}`);
      }

      const data = await response.json();
      setPlugins(data.plugins || []);
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setError('Cannot connect to server');
      } else {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (name: string) => {
    setExpandedPlugin(expandedPlugin === name ? null : name);
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
          <span className="text-text-secondary text-xs ml-2">plugins — ~/.claude/plugins</span>
          <button onClick={onClose} className="ml-auto text-text-secondary hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Command output header */}
        <div className="px-4 py-2 border-b border-border text-sm">
          <span className="text-accent-green">$</span> ls -la ~/.claude/plugins/
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

          {!loading && !error && plugins.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-text-secondary text-sm">
              <p>No plugins installed</p>
              <p className="text-xs mt-2 text-text-secondary/70">
                Use /plugin install to add plugins
              </p>
            </div>
          )}

          {!loading && !error && plugins.length > 0 && (
            <div>
              {plugins.map((plugin, index) => (
                <div key={plugin.name} className="border-b border-border last:border-0">
                  <button
                    onClick={() => toggleExpand(plugin.name)}
                    className="w-full flex items-center gap-3 px-4 py-2 hover:bg-bg-tertiary transition-colors text-sm text-left"
                  >
                    {expandedPlugin === plugin.name ? (
                      <ChevronDown className="w-3 h-3 text-text-secondary" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-text-secondary" />
                    )}

                    <span className="text-text-secondary">[{index}]</span>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-accent-purple">{plugin.name}</span>
                        <span className="text-text-secondary text-xs">v{plugin.version}</span>
                        {plugin.enabled ? (
                          <span className="text-accent-green text-xs">[ON]</span>
                        ) : (
                          <span className="text-text-secondary text-xs">[OFF]</span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 mt-1 text-xs text-text-secondary">
                        {plugin.commands?.length > 0 && (
                          <span className="flex items-center gap-1">
                            <Terminal className="w-3 h-3" />
                            {plugin.commands.length}
                          </span>
                        )}
                        {plugin.agents?.length > 0 && (
                          <span className="flex items-center gap-1">
                            <Bot className="w-3 h-3" />
                            {plugin.agents.length}
                          </span>
                        )}
                        {plugin.skills?.length > 0 && (
                          <span className="flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />
                            {plugin.skills.length}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Expanded Details */}
                  {expandedPlugin === plugin.name && (
                    <div className="px-4 py-3 pl-12 space-y-3 bg-bg-primary border-t border-border">
                      {plugin.commands?.length > 0 && (
                        <div>
                          <div className="text-xs text-text-secondary mb-1.5 flex items-center gap-1.5">
                            <Terminal className="w-3 h-3" />
                            commands:
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {plugin.commands.map((cmd) => (
                              <span key={cmd} className="px-2 py-1 bg-bg-tertiary text-xs text-accent-claude">
                                /{plugin.name}:{cmd}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {plugin.agents?.length > 0 && (
                        <div>
                          <div className="text-xs text-text-secondary mb-1.5 flex items-center gap-1.5">
                            <Bot className="w-3 h-3" />
                            agents:
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {plugin.agents.map((agent) => (
                              <span key={agent} className="px-2 py-1 bg-bg-tertiary text-xs text-accent-green">
                                {plugin.name}:{agent}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {plugin.skills?.length > 0 && (
                        <div>
                          <div className="text-xs text-text-secondary mb-1.5 flex items-center gap-1.5">
                            <Sparkles className="w-3 h-3" />
                            skills:
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {plugin.skills.map((skill) => (
                              <span key={skill} className="px-2 py-1 bg-bg-tertiary text-xs text-accent-orange">
                                {skill}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="pt-2 text-xs text-text-secondary/70 truncate">
                        {plugin.path}
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
          <span>{plugins.length} plugin{plugins.length !== 1 ? 's' : ''} installed</span>
          <span className="flex items-center gap-1.5">
            <span className="text-accent-green">●</span>
            PLUGINS
          </span>
        </div>
      </div>
    </div>
  );
}
