import { useState, useEffect, memo } from 'react';
import { X, File, ChevronRight, Home, FolderOpen, Check, FolderSync } from 'lucide-react';

interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: number;
}

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
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCurrentPath(initialPath);
    }
  }, [isOpen, initialPath]);

  useEffect(() => {
    if (isOpen) {
      loadDirectory(currentPath);
    }
  }, [isOpen, currentPath]);

  const loadDirectory = async (path: string) => {
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
      // Only update path if it's different to avoid infinite loop
      if (data.current && data.current !== path) {
        setCurrentPath(data.current);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleItemClick = (item: FileItem) => {
    if (item.type === 'directory') {
      setCurrentPath(item.path);
    } else if (onFileSelect) {
      onFileSelect(item.path, item.name);
      onClose();
    }
  };

  const handleGoUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length > 0) {
      parts.pop();
      setCurrentPath('/' + parts.join('/') || '/');
    }
  };

  const handleGoHome = () => {
    setCurrentPath(initialPath);
  };

  const handleSelectDirectory = () => {
    if (onDirectorySelect) {
      onDirectorySelect(currentPath);
    }
    onClose();
  };

  if (!isOpen) return null;

  const title = mode === 'selectDirectory' ? 'Select Directory' : 'File Explorer';
  const directories = items.filter(i => i.type === 'directory');
  const files = items.filter(i => i.type === 'file');
  const displayItems = mode === 'selectDirectory' ? directories : items;

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

        {/* Path Display */}
        <div className="px-4 py-2 border-b border-border text-sm">
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={handleGoHome}
              className="px-2 py-1 border border-border hover:border-accent-claude hover:text-accent-claude transition-colors text-xs"
              title="Go to home directory"
            >
              <Home className="w-3 h-3" />
            </button>
            <button
              onClick={handleGoUp}
              disabled={currentPath === '/'}
              className="px-2 py-1 border border-border hover:border-accent-claude hover:text-accent-claude transition-colors text-xs disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ../
            </button>
            {mode === 'selectDirectory' ? (
              <button
                onClick={handleSelectDirectory}
                className="ml-auto px-3 py-1 border border-accent-claude text-accent-claude hover:bg-accent-claude hover:text-bg-primary transition-colors text-xs flex items-center gap-1.5"
              >
                <Check className="w-3 h-3" />
                SELECT
              </button>
            ) : onDirectorySelect && (
              <button
                onClick={handleSelectDirectory}
                className="ml-auto px-3 py-1 border border-accent-orange text-accent-orange hover:bg-accent-orange hover:text-bg-primary transition-colors text-xs flex items-center gap-1.5"
                title="Set as working directory"
              >
                <FolderSync className="w-3 h-3" />
                SET WORKDIR
              </button>
            )}
          </div>
          <div className="text-text-secondary break-all text-xs">
            <span className="text-accent-green">$</span> cd {currentPath}
          </div>
        </div>

        {/* File List */}
        <div className="flex-1 overflow-y-auto">
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

          {!loading && !error && displayItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-text-secondary text-sm">
              <p>Empty directory</p>
            </div>
          )}

          {!loading && !error && displayItems.length > 0 && (
            <div>
              {displayItems.map((item, index) => (
                <button
                  key={item.path}
                  onClick={() => handleItemClick(item)}
                  className="w-full flex items-center gap-3 px-4 py-2 hover:bg-bg-tertiary transition-colors text-sm border-l-2 border-transparent hover:border-accent-claude"
                >
                  <span className="text-text-secondary text-xs">[{index}]</span>
                  {item.type === 'directory' ? (
                    <FolderOpen className="w-3.5 h-3.5 text-accent-green flex-shrink-0" />
                  ) : (
                    <File className="w-3.5 h-3.5 text-accent-orange flex-shrink-0" />
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
        <div className="px-4 py-2 border-t border-border text-xs text-text-secondary flex items-center justify-between">
          <span>
            {mode === 'selectDirectory'
              ? `${directories.length} folders`
              : `${directories.length} folders, ${files.length} files`}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-accent-green">●</span>
            ONLINE
          </span>
        </div>
      </div>
    </>
  );
});
