import { useState, useEffect } from 'react';
import { X, FileText, Globe, FolderOpen, File, Settings } from 'lucide-react';
import { localStorageApi } from '@/store/chat-store';

interface ConfigFile {
  type: 'global' | 'project' | 'root';
  path: string;
  content: string;
}

interface ConfigViewerProps {
  isOpen: boolean;
  onClose: () => void;
  workDir: string;
}

export function ConfigViewer({ isOpen, onClose, workDir }: ConfigViewerProps) {
  const [configs, setConfigs] = useState<ConfigFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('settings');

  // UI Settings
  const [autoExpandTools, setAutoExpandTools] = useState(() => localStorageApi.loadAutoExpandTools());

  useEffect(() => {
    if (isOpen) {
      loadConfigs();
    }
  }, [isOpen, workDir]);

  const loadConfigs = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = workDir
        ? `/api/config?work_dir=${encodeURIComponent(workDir)}`
        : '/api/config';
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error('Failed to load configs');
      }

      const data = await response.json();
      setConfigs(data.configs || []);

      // Keep settings as default tab, but switch to first config if no settings selected
      if (activeTab !== 'settings' && data.configs && data.configs.length > 0) {
        setActiveTab(data.configs[0].type);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'global':
        return <Globe className="w-icon-sm h-icon-sm" />;
      case 'project':
        return <FolderOpen className="w-icon-sm h-icon-sm" />;
      case 'root':
        return <File className="w-icon-sm h-icon-sm" />;
      default:
        return <FileText className="w-icon-sm h-icon-sm" />;
    }
  };

  const getLabel = (type: string) => {
    switch (type) {
      case 'global':
        return 'Global (~/.claude/CLAUDE.md)';
      case 'project':
        return 'Project (.claude/CLAUDE.md)';
      case 'root':
        return 'Root (CLAUDE.md)';
      default:
        return type;
    }
  };

  const activeConfig = configs.find(c => c.type === activeTab);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

      {/* Terminal-style modal */}
      <div className="relative w-full max-w-4xl h-[85vh] bg-bg-secondary border border-border flex flex-col animate-scaleIn">
        {/* Terminal header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-tertiary">
          <span className="text-accent-red text-xs">●</span>
          <span className="text-accent-orange text-xs">●</span>
          <span className="text-accent-green text-xs">●</span>
          <span className="text-text-secondary text-xs ml-2">config — CLAUDE.md</span>
          <button onClick={onClose} className="ml-auto text-text-secondary hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0 px-2 py-1 border-b border-border bg-bg-primary">
          {/* Settings tab - always first */}
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
              activeTab === 'settings'
                ? 'text-accent-claude border-b-2 border-accent-claude -mb-px'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <span className="text-text-secondary">[0]</span>
            <Settings className="w-icon-sm h-icon-sm" />
            <span className="hidden sm:inline">settings</span>
          </button>
          {configs.map((config, index) => (
            <button
              key={config.type}
              onClick={() => setActiveTab(config.type)}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                activeTab === config.type
                  ? 'text-accent-claude border-b-2 border-accent-claude -mb-px'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <span className="text-text-secondary">[{index + 1}]</span>
              {getIcon(config.type)}
              <span className="hidden sm:inline">{config.type}</span>
            </button>
          ))}
        </div>

        {/* Command output header */}
        {activeTab !== 'settings' && activeConfig && (
          <div className="px-4 py-2 border-b border-border text-sm">
            <span className="text-accent-green">$</span> cat {activeConfig.path}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto bg-bg-primary p-4">
          {activeTab === 'settings' ? (
            <div className="space-y-4">
              <div className="text-sm text-text-secondary mb-4">UI Settings</div>

              {/* Auto-expand tools toggle */}
              <div className="flex items-center justify-between py-2 border-b border-border">
                <div>
                  <div className="text-sm text-text-primary">Auto-expand tool blocks</div>
                  <div className="text-xs text-text-secondary">Automatically expand tool call blocks when displayed</div>
                </div>
                <button
                  onClick={() => {
                    const newValue = !autoExpandTools;
                    setAutoExpandTools(newValue);
                    localStorageApi.saveAutoExpandTools(newValue);
                  }}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    autoExpandTools ? 'bg-accent-green' : 'bg-bg-tertiary'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full bg-text-primary transition-transform mx-0.5 ${
                    autoExpandTools ? 'translate-x-6' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              <div className="text-xs text-text-secondary mt-8">
                Note: Some settings require page refresh to take effect.
              </div>
            </div>
          ) : (
            <>
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

              {!loading && !error && configs.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-text-secondary text-sm">
                  <p>No CLAUDE.md files found</p>
                  <p className="text-xs mt-2 text-text-secondary/70">
                    Create ~/.claude/CLAUDE.md or .claude/CLAUDE.md
                  </p>
                </div>
              )}

              {!loading && !error && activeConfig && (
                <div className="font-mono text-sm">
                  <pre className="whitespace-pre-wrap text-text-primary leading-relaxed">
                    {activeConfig.content}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {activeTab === 'settings' ? (
          <div className="px-4 py-2 border-t border-border text-xs text-text-secondary flex items-center justify-between">
            <span>Claude Web UI Settings</span>
            <span className="flex items-center gap-1.5">
              <span className="text-accent-green">●</span>
              EDITABLE
            </span>
          </div>
        ) : activeConfig && (
          <div className="px-4 py-2 border-t border-border text-xs text-text-secondary flex items-center justify-between">
            <span className="truncate">{activeConfig.path}</span>
            <span className="flex items-center gap-1.5">
              <span className="text-accent-green">●</span>
              READ-ONLY
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
