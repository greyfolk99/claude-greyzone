import { useState, useEffect, memo, useCallback } from 'react';
import { X, File, ChevronRight, Home, FolderOpen, Check, FolderSync, Plus } from 'lucide-react';

interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: number;
}

// ============ Shared Content Component ============

interface FileExplorerContentProps {
  initialPath?: string;
  mode?: 'browse' | 'selectDirectory';
  onFileSelect?: (path: string, name: string) => void;
  onDirectorySelect?: (path: string) => void;
  onNewSession?: (path: string) => void;
  onSelectComplete?: () => void;
  compact?: boolean;
}

export const FileExplorerContent = memo(function FileExplorerContent({
  initialPath = '/home/seo',
  mode = 'browse',
  onFileSelect,
  onDirectorySelect,
  onNewSession,
  onSelectComplete,
  compact = false,
}: FileExplorerContentProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });

      if (!response.ok) {
        throw new Error('Failed to load directory');
      }

      const data = await response.json();
      setItems(data.items || []);
      if (data.current && data.current !== path) {
        setCurrentPath(data.current);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  useEffect(() => {
    setCurrentPath(initialPath);
  }, [initialPath]);

  const handleItemClick = useCallback((item: FileItem) => {
    if (item.type === 'directory') {
      setCurrentPath(item.path);
    } else if (onFileSelect) {
      onFileSelect(item.path, item.name);
      onSelectComplete?.();
    }
  }, [onFileSelect, onSelectComplete]);

  const handleGoUp = useCallback(() => {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length > 0) {
      parts.pop();
      setCurrentPath('/' + parts.join('/') || '/');
    }
  }, [currentPath]);

  const handleGoHome = useCallback(() => {
    setCurrentPath(initialPath);
  }, [initialPath]);

  const handleSelectDirectory = useCallback(() => {
    if (onDirectorySelect) {
      onDirectorySelect(currentPath);
    }
    onSelectComplete?.();
  }, [onDirectorySelect, currentPath, onSelectComplete]);

  const directories = items.filter(i => i.type === 'directory');
  const files = items.filter(i => i.type === 'file');
  const displayItems = mode === 'selectDirectory' ? directories : items;

  const textSize = compact ? 'text-xs' : 'text-sm';
  const py = compact ? 'py-1.5' : 'py-2';
  const px = compact ? 'px-2' : 'px-4';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      {compact && (
        <div className="flex items-center justify-between px-4 h-10 border-b border-border bg-bg-secondary">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-accent-green" />
            <span className="text-accent-green text-sm">Files</span>
          </div>
          {onNewSession && (
            <button
              onClick={() => { onNewSession(currentPath); onSelectComplete?.(); }}
              className="p-1 text-text-secondary hover:text-accent-green"
              title="New Session in this directory"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Path Display & Navigation */}
      <div className={`${compact ? 'px-2 py-1.5' : 'px-4 py-2'} border-b border-border`}>
        <div className={`flex items-center gap-1`}>
          <button
            onClick={handleGoHome}
            className={`p-1 border border-border hover:border-accent-claude hover:text-accent-claude transition-colors ${compact ? 'text-xs' : 'text-sm'}`}
            title="Go to home directory"
          >
            <Home className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          </button>
          {mode === 'selectDirectory' ? (
            <button
              onClick={handleSelectDirectory}
              className={`ml-auto px-2 py-1 border border-accent-claude text-accent-claude hover:bg-accent-claude hover:text-bg-primary transition-colors ${compact ? 'text-xs' : 'text-sm'} flex items-center gap-1`}
            >
              <Check className="w-3 h-3" />
              {!compact && 'SELECT'}
            </button>
          ) : onDirectorySelect && (
            <button
              onClick={handleSelectDirectory}
              className={`ml-auto px-2 py-1 border border-accent-orange text-accent-orange hover:bg-accent-orange hover:text-bg-primary transition-colors ${compact ? 'text-xs' : 'text-sm'} flex items-center gap-1`}
              title="Set as working directory"
            >
              <FolderSync className="w-3 h-3" />
              {!compact && 'SET'}
            </button>
          )}
        </div>
        <div className={`text-text-secondary break-all ${compact ? 'text-[10px] mt-1' : 'text-xs mt-2'} flex items-center gap-1`}>
          <span className="text-accent-green">$</span>
          <span className="truncate">{currentPath.replace(/^\/home\/[^/]+/, '~')}</span>
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto">
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

        {!loading && !error && (
          <div>
            {/* Parent directory (..) - always show except at root */}
            {currentPath !== '/' && (
              <button
                onClick={handleGoUp}
                className={`w-full flex items-center gap-2 ${px} ${py} hover:bg-bg-tertiary transition-colors ${textSize} border-l-2 border-transparent hover:border-accent-claude`}
              >
                {!compact && <span className="text-text-secondary text-xs w-5">[..]</span>}
                <FolderOpen className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-accent-green flex-shrink-0`} />
                <span className="flex-1 text-left text-text-primary truncate">
                  ..
                </span>
                <ChevronRight className="w-3 h-3 text-text-secondary" />
              </button>
            )}
            {displayItems.length === 0 && currentPath === '/' && (
              <div className={`flex items-center justify-center py-8 text-text-secondary ${textSize}`}>
                Empty directory
              </div>
            )}
            {displayItems.map((item, index) => (
              <button
                key={item.path}
                onClick={() => handleItemClick(item)}
                className={`w-full flex items-center gap-2 ${px} ${py} hover:bg-bg-tertiary transition-colors ${textSize} border-l-2 border-transparent hover:border-accent-claude`}
              >
                {!compact && <span className="text-text-secondary text-xs w-5">[{index}]</span>}
                {item.type === 'directory' ? (
                  <FolderOpen className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-accent-green flex-shrink-0`} />
                ) : (
                  <File className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-accent-orange flex-shrink-0`} />
                )}
                <span className="flex-1 text-left text-text-primary truncate">
                  {item.name}
                </span>
                {item.type === 'directory' && (
                  <ChevronRight className="w-3 h-3 text-text-secondary" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={`${px} py-1.5 border-t border-border ${compact ? 'text-[10px]' : 'text-xs'} text-text-secondary`}>
        {mode === 'selectDirectory'
          ? `${directories.length} folders`
          : `${directories.length} folders, ${files.length} files`}
      </div>
    </div>
  );
});

// ============ Modal Wrapper Component ============

interface FileExplorerProps {
  isOpen: boolean;
  onClose: () => void;
  onFileSelect?: (path: string, name: string) => void;
  onDirectorySelect?: (path: string) => void;
  initialPath?: string;
  mode?: 'browse' | 'selectDirectory';
}

export const FileExplorer = memo(function FileExplorer({
  isOpen,
  onClose,
  onFileSelect,
  onDirectorySelect,
  initialPath = '/home/seo',
  mode = 'browse'
}: FileExplorerProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/80 z-40 animate-fadeIn" onClick={onClose} />

      {/* Terminal-style slide-in panel */}
      <div className="fixed left-0 top-0 bottom-0 w-full max-w-md bg-bg-secondary border-r border-border z-50 flex flex-col animate-slideInLeft">
        {/* Terminal header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-tertiary">
          <span className="text-accent-red text-xs">●</span>
          <span className="text-accent-orange text-xs">●</span>
          <span className="text-accent-green text-xs">●</span>
          <span className="text-text-secondary text-xs ml-2">
            {mode === 'selectDirectory' ? 'select-dir' : 'files'} — bash
          </span>
          <button onClick={onClose} className="ml-auto text-text-secondary hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <FileExplorerContent
          initialPath={initialPath}
          mode={mode}
          onFileSelect={onFileSelect}
          onDirectorySelect={onDirectorySelect}
          onSelectComplete={onClose}
          compact={false}
        />
      </div>
    </>
  );
});
