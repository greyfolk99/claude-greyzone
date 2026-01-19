import { useState, useEffect, useCallback, memo } from 'react';
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

// ============ Shared Content Component ============

interface PluginsViewerContentProps {
  compact?: boolean;
}

export const PluginsViewerContent = memo(function PluginsViewerContent({
  compact = false,
}: PluginsViewerContentProps) {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);

  const loadPlugins = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    loadPlugins();
  }, [loadPlugins]);

  const toggleExpand = useCallback((name: string) => {
    setExpandedPlugin(prev => prev === name ? null : name);
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
            <Puzzle className="w-4 h-4 text-accent-purple" />
            <span className="text-accent-purple text-sm">Plugins</span>
          </div>
          <span className="text-text-secondary text-xs">{plugins.length}</span>
        </div>
      )}

      {/* Command output header */}
      {!compact && (
        <div className="px-4 py-2 border-b border-border text-sm">
          <span className="text-accent-green">$</span> ls -la ~/.claude/plugins/
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

        {!loading && !error && plugins.length === 0 && (
          <div className={`flex flex-col items-center justify-center py-8 text-text-secondary ${textSize}`}>
            <p>No plugins installed</p>
            {!compact && <p className="text-xs mt-2 text-text-secondary/70">Use /plugin install to add plugins</p>}
          </div>
        )}

        {!loading && !error && plugins.length > 0 && (
          <div>
            {plugins.map((plugin, index) => (
              <div key={plugin.name} className="border-b border-border last:border-0">
                <button
                  onClick={() => toggleExpand(plugin.name)}
                  className={`w-full flex items-center gap-2 ${px} ${py} hover:bg-bg-tertiary transition-colors ${textSize} text-left`}
                >
                  {expandedPlugin === plugin.name ? (
                    <ChevronDown className="w-3 h-3 text-text-secondary" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-text-secondary" />
                  )}

                  {!compact && <span className="text-text-secondary">[{index}]</span>}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-accent-purple truncate">{plugin.name}</span>
                      <span className={`text-text-secondary ${compact ? 'text-[10px]' : 'text-xs'}`}>v{plugin.version}</span>
                      {plugin.enabled ? (
                        <span className={`text-accent-green ${compact ? 'text-[10px]' : 'text-xs'}`}>[ON]</span>
                      ) : (
                        <span className={`text-text-secondary ${compact ? 'text-[10px]' : 'text-xs'}`}>[OFF]</span>
                      )}
                    </div>

                    <div className={`flex items-center gap-2 mt-0.5 ${compact ? 'text-[10px]' : 'text-xs'} text-text-secondary`}>
                      {plugin.commands?.length > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Terminal className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
                          {plugin.commands.length}
                        </span>
                      )}
                      {plugin.agents?.length > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Bot className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
                          {plugin.agents.length}
                        </span>
                      )}
                      {plugin.skills?.length > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Sparkles className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
                          {plugin.skills.length}
                        </span>
                      )}
                    </div>
                  </div>
                </button>

                {/* Expanded Details */}
                {expandedPlugin === plugin.name && (
                  <div className={`${px} py-2 ${compact ? 'pl-6' : 'pl-12'} space-y-2 bg-bg-primary border-t border-border`}>
                    {plugin.commands?.length > 0 && (
                      <div>
                        <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-text-secondary mb-1 flex items-center gap-1`}>
                          <Terminal className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
                          commands:
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {plugin.commands.map((cmd) => (
                            <span key={cmd} className={`px-1.5 py-0.5 bg-bg-tertiary ${compact ? 'text-[10px]' : 'text-xs'} text-accent-claude`}>
                              /{plugin.name}:{cmd}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {plugin.agents?.length > 0 && (
                      <div>
                        <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-text-secondary mb-1 flex items-center gap-1`}>
                          <Bot className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
                          agents:
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {plugin.agents.map((agent) => (
                            <span key={agent} className={`px-1.5 py-0.5 bg-bg-tertiary ${compact ? 'text-[10px]' : 'text-xs'} text-accent-green`}>
                              {plugin.name}:{agent}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {plugin.skills?.length > 0 && (
                      <div>
                        <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-text-secondary mb-1 flex items-center gap-1`}>
                          <Sparkles className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
                          skills:
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {plugin.skills.map((skill) => (
                            <span key={skill} className={`px-1.5 py-0.5 bg-bg-tertiary ${compact ? 'text-[10px]' : 'text-xs'} text-accent-orange`}>
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {!compact && (
                      <div className="pt-1 text-xs text-text-secondary/70 truncate">
                        {plugin.path}
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
          <span>{plugins.length} plugin{plugins.length !== 1 ? 's' : ''} installed</span>
          <span className="flex items-center gap-1.5">
            <span className="text-accent-green">●</span>
            PLUGINS
          </span>
        </div>
      )}
    </div>
  );
});

// ============ Modal Wrapper Component ============

interface PluginsViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PluginsViewer({ isOpen, onClose }: PluginsViewerProps) {
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
          <span className="text-text-secondary text-xs ml-2">plugins — ~/.claude/plugins</span>
          <button onClick={onClose} className="ml-auto text-text-secondary hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <PluginsViewerContent compact={false} />
      </div>
    </div>
  );
}
