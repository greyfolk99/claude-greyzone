import { useState, useEffect } from 'react';
import { X, FileCode, Download } from 'lucide-react';
import hljs from 'highlight.js';
import 'highlight.js/styles/tokyo-night-dark.css';

interface FileViewerProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  fileName: string;
}

interface FileData {
  content: string;
  language: string;
  path: string;
  name: string;
  size: number;
}

export function FileViewer({ isOpen, onClose, filePath, fileName }: FileViewerProps) {
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightedCode, setHighlightedCode] = useState('');

  useEffect(() => {
    if (isOpen && filePath) {
      loadFile();
    }
  }, [isOpen, filePath]);

  useEffect(() => {
    if (fileData) {
      try {
        const highlighted = hljs.highlight(fileData.content, {
          language: fileData.language,
        }).value;
        setHighlightedCode(highlighted);
      } catch {
        // Fallback to plain text if highlighting fails
        setHighlightedCode(fileData.content);
      }
    }
  }, [fileData]);

  const loadFile = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/file/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load file');
      }

      const data = await response.json();
      setFileData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!fileData) return;
    const blob = new Blob([fileData.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileData.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

      {/* Terminal-style modal */}
      <div className="relative w-full max-w-6xl h-[90vh] bg-bg-secondary border border-border flex flex-col animate-scaleIn">
        {/* Terminal header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-tertiary">
          <span className="text-accent-red text-xs">●</span>
          <span className="text-accent-orange text-xs">●</span>
          <span className="text-accent-green text-xs">●</span>
          <span className="text-text-secondary text-xs ml-2">cat — {fileName}</span>
          <button onClick={onClose} className="ml-auto text-text-secondary hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Command output header */}
        <div className="px-4 py-2 border-b border-border text-sm flex items-center justify-between">
          <div>
            <span className="text-accent-green">$</span> cat {filePath}
          </div>
          {fileData && (
            <div className="flex items-center gap-3 text-xs text-text-secondary">
              <span>{fileData.language.toUpperCase()}</span>
              <span>{formatFileSize(fileData.size)}</span>
              <button
                onClick={handleDownload}
                disabled={!fileData}
                className="px-2 py-1 border border-border hover:border-accent-green hover:text-accent-green transition-colors disabled:opacity-30"
              >
                <Download className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-auto bg-bg-primary p-4">
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

          {!loading && !error && fileData && (
            <div className="font-mono text-sm">
              <pre className="overflow-x-auto">
                <code
                  className={`hljs language-${fileData.language}`}
                  dangerouslySetInnerHTML={{ __html: highlightedCode }}
                />
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border text-xs text-text-secondary flex items-center justify-between">
          <span className="truncate">{filePath}</span>
          <span className="flex items-center gap-1.5">
            <span className="text-accent-green">●</span>
            READ-ONLY
          </span>
        </div>
      </div>
    </div>
  );
}
