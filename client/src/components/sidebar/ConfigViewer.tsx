import { useState, useEffect, useCallback, memo } from 'react';
import { X, FileText, Globe, FolderOpen, File, Settings } from 'lucide-react';
import { localStorageApi } from '@/store/chat-store';

interface ConfigFile {
  type: 'global' | 'project' | 'root';
  path: string;
  content: string;
}

// ============ Shared Content Component ============

interface ConfigViewerContentProps {
  workDir: string;
  compact?: boolean;
}

export const ConfigViewerContent = memo(function ConfigViewerContent({
  workDir,
  compact = false,
}: ConfigViewerContentProps) {
  const [configs, setConfigs] = useState<ConfigFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('settings');
  const [autoExpandTools, setAutoExpandTools] = useState(() => localStorageApi.loadAutoExpandTools());

  const loadConfigs = useCallback(async () => {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [workDir]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const getIcon = (type: string) => {
    const size = compact ? 'w-3 h-3' : 'w-icon-sm h-icon-sm';
    switch (type) {
      case 'global':
        return <Globe className={size} />;
      case 'project':
        return <FolderOpen className={size} />;
      case 'root':
        return <File className={size} />;
      default:
        return <FileText className={size} />;
    }
  };

  const activeConfig = configs.find(c => c.type === activeTab);
  const textSize = compact ? 'text-xs' : 'text-sm';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      {compact && (
        <div className="flex items-center justify-between px-4 h-10 border-b border-border bg-bg-secondary">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-accent-claude" />
            <span className="text-accent-claude text-sm">Config</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className={`flex items-center gap-0 ${compact ? 'px-1' : 'px-2'} py-1 border-b border-border bg-bg-primary overflow-x-auto`}>
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex items-center gap-1 ${compact ? 'px-2 py-1' : 'px-3 py-1.5'} ${compact ? 'text-[10px]' : 'text-xs'} transition-colors whitespace-nowrap ${
            activeTab === 'settings'
              ? 'text-accent-claude border-b-2 border-accent-claude -mb-px'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <Settings className={compact ? 'w-3 h-3' : 'w-icon-sm h-icon-sm'} />
          {!compact && 'settings'}
        </button>
        {configs.map((config) => (
          <button
            key={config.type}
            onClick={() => setActiveTab(config.type)}
            className={`flex items-center gap-1 ${compact ? 'px-2 py-1' : 'px-3 py-1.5'} ${compact ? 'text-[10px]' : 'text-xs'} transition-colors whitespace-nowrap ${
              activeTab === config.type
                ? 'text-accent-claude border-b-2 border-accent-claude -mb-px'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {getIcon(config.type)}
            {!compact && config.type}
          </button>
        ))}
      </div>

      {/* Command output header */}
      {activeTab !== 'settings' && activeConfig && !compact && (
        <div className="px-4 py-2 border-b border-border text-sm">
          <span className="text-accent-green">$</span> cat {activeConfig.path}
        </div>
      )}

      {/* Content */}
      <div className={`flex-1 overflow-auto bg-bg-primary ${compact ? 'p-2' : 'p-4'}`}>
        {activeTab === 'settings' ? (
          <div className="space-y-3">
            {!compact && <div className="text-sm text-text-secondary mb-4">UI Settings</div>}

            {/* Auto-expand tools toggle */}
            <div className={`flex items-center justify-between ${compact ? 'py-1' : 'py-2'} border-b border-border`}>
              <div className="flex-1 min-w-0 mr-2">
                <div className={`${textSize} text-text-primary ${compact ? 'truncate' : ''}`}>Auto-expand tools</div>
                {!compact && <div className="text-xs text-text-secondary">Expand tool call blocks automatically</div>}
              </div>
              <button
                onClick={() => {
                  const newValue = !autoExpandTools;
                  setAutoExpandTools(newValue);
                  localStorageApi.saveAutoExpandTools(newValue);
                }}
                className={`${compact ? 'w-8 h-4' : 'w-12 h-6'} rounded-full transition-colors flex-shrink-0 ${
                  autoExpandTools ? 'bg-accent-green' : 'bg-bg-tertiary'
                }`}
              >
                <div className={`${compact ? 'w-3 h-3' : 'w-5 h-5'} rounded-full bg-text-primary transition-transform mx-0.5 ${
                  autoExpandTools ? (compact ? 'translate-x-4' : 'translate-x-6') : 'translate-x-0'
                }`} />
              </button>
            </div>
          </div>
        ) : (
          <>
            {loading && (
              <div className={`flex items-center justify-center py-8 text-text-secondary ${textSize}`}>
                <span className="text-accent-orange animate-pulse">loading...</span>
              </div>
            )}

            {error && (
              <div className={`py-2 ${textSize}`}>
                <span className="text-accent-red">ERROR:</span> {error}
              </div>
            )}

            {!loading && !error && configs.length === 0 && (
              <div className={`flex flex-col items-center justify-center py-8 text-text-secondary ${textSize}`}>
                <p>No CLAUDE.md files found</p>
              </div>
            )}

            {!loading && !error && activeConfig && (
              <div className={`font-mono ${compact ? 'text-[10px]' : 'text-sm'}`}>
                <pre className="whitespace-pre-wrap text-text-primary leading-relaxed">
                  {activeConfig.content}
                </pre>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {!compact && (
        <div className="px-4 py-2 border-t border-border text-xs text-text-secondary flex items-center justify-between">
          <span className="truncate">{activeTab === 'settings' ? 'UI Settings' : activeConfig?.path}</span>
          <span className="flex items-center gap-1.5">
            <span className="text-accent-green">●</span>
            {activeTab === 'settings' ? 'EDITABLE' : 'READ-ONLY'}
          </span>
        </div>
      )}
    </div>
  );
});

// ============ Modal Wrapper Component ============

interface ConfigViewerProps {
  isOpen: boolean;
  onClose: () => void;
  workDir: string;
}

export function ConfigViewer({ isOpen, onClose, workDir }: ConfigViewerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

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

        <ConfigViewerContent workDir={workDir} compact={false} />
      </div>
    </div>
  );
}
