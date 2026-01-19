import { useState, useEffect, useMemo, memo, useCallback } from 'react';
import { X, Clock, FolderOpen, Folder, ChevronDown, ChevronRight, Search, History, FolderTree, FileText, Trash2, RefreshCw, Plus } from 'lucide-react';

interface Session {
  sessionId: string;
  firstPrompt: string;
  projectPath: string;
  messageCount: number;
  created: string;
  modified: string;
}

interface TreeNode {
  name: string;
  path: string;
  sessions: Session[];
  children: Map<string, TreeNode>;
}

type ViewMode = 'recent' | 'tree';

// ============ Shared Content Component ============

interface SessionListContentProps {
  onSessionSelect: (sessionId: string, project: string, firstPrompt?: string) => void;
  onOpenInNewTab?: (sessionId: string, project: string, firstPrompt?: string) => void;
  onNewSession?: () => void;
  openSessionIds?: string[];
  runningSessionIds?: string[];  // Sessions currently processing
  compact?: boolean;  // For sidebar (smaller text, denser layout)
  onSelectComplete?: () => void;  // Called after selection (e.g., to close modal)
}

export const SessionListContent = memo(function SessionListContent({
  onSessionSelect,
  onOpenInNewTab,
  onNewSession,
  openSessionIds = [],
  runningSessionIds = [],
  compact = false,
  onSelectComplete,
}: SessionListContentProps) {
  const isSessionOpen = useCallback((sessionId: string) => openSessionIds.includes(sessionId), [openSessionIds]);
  const isSessionRunning = useCallback((sessionId: string) => runningSessionIds.includes(sessionId), [runningSessionIds]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('recent');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['/']));

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/sessions');
      if (!response.ok) throw new Error('Failed to load sessions');
      const data = await response.json();
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const query = searchQuery.toLowerCase();
    return sessions.filter(s =>
      s.firstPrompt.toLowerCase().includes(query) ||
      s.projectPath.toLowerCase().includes(query)
    );
  }, [sessions, searchQuery]);

  const recentSessions = useMemo(() => {
    return [...filteredSessions]
      .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
      .slice(0, compact ? 20 : 10);
  }, [filteredSessions, compact]);

  const folderTree = useMemo(() => {
    const root: TreeNode = { name: '/', path: '/', sessions: [], children: new Map() };
    const sortedSessions = [...filteredSessions].sort((a, b) =>
      (a.projectPath || '/').localeCompare(b.projectPath || '/')
    );

    for (const session of sortedSessions) {
      const path = session.projectPath || '/';
      const parts = path.split('/').filter(Boolean);
      let current = root;
      let currentPath = '';

      for (const part of parts) {
        currentPath = `/${currentPath ? currentPath + '/' : ''}${part}`;
        if (!current.children.has(part)) {
          current.children.set(part, { name: part, path: currentPath, sessions: [], children: new Map() });
        }
        current = current.children.get(part)!;
      }
      current.sessions.push(session);
    }
    return root;
  }, [filteredSessions]);

  const handleOpenSession = useCallback((session: Session) => {
    onSessionSelect(session.sessionId, session.projectPath, session.firstPrompt);
    onSelectComplete?.();
  }, [onSessionSelect, onSelectComplete]);

  const handleDeleteSession = useCallback(async (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    if (!confirm(`Delete session "${session.firstPrompt || '(empty)'}"?`)) return;

    try {
      const url = session.projectPath
        ? `/api/session/${session.sessionId}?project=${encodeURIComponent(session.projectPath)}`
        : `/api/session/${session.sessionId}`;
      const response = await fetch(url, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete session');
      loadSessions();
    } catch (err) {
      console.error('Failed to delete session:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete session');
    }
  }, [loadSessions]);

  const togglePath = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) newSet.delete(path);
      else newSet.add(path);
      return newSet;
    });
  }, []);

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return '?';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString();
  };

  const shortenPath = (path: string): string => path.replace(/^\/home\/[^/]+/, '~');

  const countSessions = (node: TreeNode): number => {
    let count = node.sessions.length;
    for (const child of node.children.values()) count += countSessions(child);
    return count;
  };

  const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedPaths.has(node.path);
    const hasChildren = node.children.size > 0;
    const hasSessions = node.sessions.length > 0;
    const hasContent = hasChildren || hasSessions;
    if (!hasContent && depth > 0) return null;

    const indent = depth * (compact ? 12 : 16);
    const totalSessions = countSessions(node);
    const textSize = compact ? 'text-xs' : 'text-sm';
    const py = compact ? 'py-1' : 'py-1.5';

    return (
      <div key={node.path}>
        {depth >= 0 && (
          <button
            onClick={() => togglePath(node.path)}
            className={`w-full flex items-center gap-2 px-4 ${py} transition-colors ${textSize}`}
            style={{ paddingLeft: `${(compact ? 8 : 16) + indent}px` }}
          >
            {hasContent ? (
              isExpanded ? <ChevronDown className="w-3 h-3 text-text-secondary shrink-0" /> : <ChevronRight className="w-3 h-3 text-text-secondary shrink-0" />
            ) : <span className="w-3" />}
            {isExpanded && hasContent ? <FolderOpen className="w-3.5 h-3.5 text-accent-orange shrink-0" /> : <Folder className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
            <span className="text-text-primary truncate flex-1 text-left">{node.name}{hasChildren ? '/' : ''}</span>
            {totalSessions > 0 && <span className="text-text-secondary text-xs">{totalSessions}</span>}
          </button>
        )}

        {isExpanded && (
          <>
            {Array.from(node.children.values())
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(child => renderTreeNode(child, depth + 1))}

            {node.sessions
              .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
              .map(session => {
                const sessionOpen = isSessionOpen(session.sessionId);
                const sessionRunning = isSessionRunning(session.sessionId);
                return (
                  <div
                    key={session.sessionId}
                    onClick={() => handleOpenSession(session)}
                    className={`w-full flex items-center gap-2 px-4 ${py} transition-colors ${textSize} group cursor-pointer ${sessionOpen ? 'bg-accent-green/5' : ''}`}
                    style={{ paddingLeft: `${(compact ? 8 : 16) + indent}px` }}
                  >
                    <span className="w-3 shrink-0" />
                    <FileText className={`w-3.5 h-3.5 shrink-0 ${sessionRunning ? 'animate-color-pulse' : sessionOpen ? 'text-accent-green' : 'text-text-secondary'}`} />
                    <span className={`flex-1 truncate ${sessionRunning ? 'animate-color-pulse' : sessionOpen ? 'text-accent-green' : 'text-text-primary group-hover:text-accent-claude'}`}>
                      {session.firstPrompt || '(empty)'}
                    </span>
                    {/* Time */}
                    <span className={`text-text-secondary ${compact ? 'text-[10px]' : 'text-xs'} flex items-center gap-1 shrink-0`}>
                      <Clock className={`${compact ? 'w-2.5 h-2.5' : 'w-3 h-3'}`} />
                      {formatDate(session.modified)}
                    </span>
                    {/* Actions */}
                    <div className="opacity-0 group-hover:opacity-100 flex items-center shrink-0">
                      {onOpenInNewTab && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onOpenInNewTab(session.sessionId, session.projectPath, session.firstPrompt); onSelectComplete?.(); }}
                          className="text-text-secondary hover:text-accent-green transition-all p-0.5"
                          title="Open in new tab"
                        >
                          <Plus className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />
                        </button>
                      )}
                      {!sessionRunning && (
                        <button
                          onClick={(e) => handleDeleteSession(e, session)}
                          className="text-text-secondary hover:text-accent-red transition-all p-0.5"
                          title="Delete session"
                        >
                          <Trash2 className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </>
        )}
      </div>
    );
  };

  const textSize = compact ? 'text-xs' : 'text-sm';
  const py = compact ? 'py-1.5' : 'py-2';

  return (
    <div className="flex flex-col h-full">
      {/* Header with new session + refresh */}
      {compact && (
        <div className="flex items-center justify-between px-4 h-10 border-b border-border bg-bg-secondary">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-accent-claude" />
            <span className="text-accent-claude text-sm">Sessions</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={loadSessions} className="p-1 text-text-secondary hover:text-text-primary" title="Refresh">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {onNewSession && (
              <button onClick={() => { onNewSession(); onSelectComplete?.(); }} className="p-1 text-text-secondary hover:text-accent-green" title="New Session">
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* New Session (modal only) */}
      {!compact && onNewSession && (
        <button
          onClick={() => { onNewSession(); onSelectComplete?.(); }}
          className={`flex items-center gap-3 px-4 ${py} border-b border-border ${textSize} transition-colors`}
        >
          <span className="text-accent-green">[+]</span>
          <span className="text-accent-claude">NEW_SESSION</span>
          <span className="text-text-secondary ml-auto text-xs">Create new</span>
        </button>
      )}

      {/* Search + View Toggle */}
      <div className={`px-${compact ? '2' : '4'} ${py} border-b border-border flex flex-col sm:flex-row gap-2 sm:items-center`}>
        <div className={`flex-1 flex items-center gap-2 px-2 py-1${compact ? '' : '.5'} bg-bg-primary border border-border focus-within:border-accent-claude`}>
          <Search className={`w-3${compact ? '' : '.5'} h-3${compact ? '' : '.5'} text-text-secondary shrink-0`} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={compact ? 'Search...' : 'Search title or path...'}
            className={`flex-1 min-w-0 bg-transparent ${textSize} text-text-primary placeholder:text-text-secondary focus:outline-none`}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-text-secondary hover:text-text-primary text-xs shrink-0">[x]</button>
          )}
        </div>

        <div className={`flex items-center border border-border shrink-0 ${compact ? '' : 'self-end sm:self-auto'}`}>
          <button
            onClick={() => setViewMode('recent')}
            className={`px-${compact ? '2' : '3'} py-1${compact ? '' : '.5'} text-xs flex items-center gap-1${compact ? '' : '.5'} transition-colors ${
              viewMode === 'recent' ? 'bg-accent-claude/20 text-accent-claude' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <History className="w-3 h-3" />
            {!compact && 'Recent'}
          </button>
          <button
            onClick={() => setViewMode('tree')}
            className={`px-${compact ? '2' : '3'} py-1${compact ? '' : '.5'} text-xs flex items-center gap-1${compact ? '' : '.5'} transition-colors border-l border-border ${
              viewMode === 'tree' ? 'bg-accent-claude/20 text-accent-claude' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <FolderTree className="w-3 h-3" />
            {!compact && 'Tree'}
          </button>
        </div>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className={`flex items-center justify-center py-${compact ? '8' : '12'} text-text-secondary ${textSize}`}>
            <span className="text-accent-orange animate-pulse">loading...</span>
          </div>
        )}

        {error && (
          <div className={`px-4 py-3 ${textSize}`}>
            <span className="text-accent-red">ERROR:</span> {error}
          </div>
        )}

        {!loading && !error && filteredSessions.length === 0 && (
          <div className={`flex flex-col items-center justify-center py-${compact ? '8' : '12'} text-text-secondary ${textSize}`}>
            <p>{searchQuery ? 'No matching sessions' : 'No sessions found'}</p>
          </div>
        )}

        {/* Recent View */}
        {!loading && !error && viewMode === 'recent' && recentSessions.length > 0 && (
          <div>
            {!compact && (
              <div className="px-4 py-2 text-xs text-text-secondary border-b border-border bg-bg-primary">
                <span className="text-accent-green">$</span> history | head -10
              </div>
            )}
            {recentSessions.map((session, idx) => {
              const sessionOpen = isSessionOpen(session.sessionId);
              const sessionRunning = isSessionRunning(session.sessionId);
              return (
                <div
                  key={session.sessionId}
                  onClick={() => handleOpenSession(session)}
                  className={`w-full flex items-center gap-${compact ? '2' : '3'} px-${compact ? '3' : '4'} py-${compact ? '1.5' : '2.5'} ${textSize} transition-colors border-b border-border/50 last:border-0 group cursor-pointer ${sessionOpen ? 'bg-accent-green/5' : ''}`}
                >
                  {!compact && <span className="text-text-secondary w-6">[{idx}]</span>}
                  <FileText className={`w-3.5 h-3.5 shrink-0 ${sessionRunning ? 'animate-color-pulse' : sessionOpen ? 'text-accent-green' : 'text-text-secondary'}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`truncate ${sessionRunning ? 'animate-color-pulse' : sessionOpen ? 'text-accent-green' : 'text-text-primary group-hover:text-accent-claude'}`}>
                      {session.firstPrompt || '(empty)'}
                    </div>
                    {compact && (
                      <div className="text-[10px] text-text-secondary truncate">{shortenPath(session.projectPath)}</div>
                    )}
                  </div>
                  {/* Time */}
                  <span className={`text-text-secondary ${compact ? 'text-[10px]' : 'text-xs'} flex items-center gap-1 shrink-0`}>
                    <Clock className={`${compact ? 'w-2.5 h-2.5' : 'w-3 h-3'}`} />
                    {formatDate(session.modified)}
                  </span>
                  {/* Actions */}
                  <div className="opacity-0 group-hover:opacity-100 flex items-center shrink-0">
                    {onOpenInNewTab && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onOpenInNewTab(session.sessionId, session.projectPath, session.firstPrompt); onSelectComplete?.(); }}
                        className="text-text-secondary hover:text-accent-green transition-all p-0.5"
                        title="Open in new tab"
                      >
                        <Plus className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />
                      </button>
                    )}
                    {!sessionRunning && (
                      <button
                        onClick={(e) => handleDeleteSession(e, session)}
                        className="text-text-secondary hover:text-accent-red transition-all p-0.5"
                        title="Delete"
                      >
                        <Trash2 className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Tree View */}
        {!loading && !error && viewMode === 'tree' && filteredSessions.length > 0 && (
          <div className={compact ? 'py-1' : ''}>
            {renderTreeNode(folderTree)}
          </div>
        )}
      </div>
    </div>
  );
});


// ============ Modal Wrapper Component ============

interface SessionListProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionSelect: (sessionId: string, project: string, firstPrompt?: string) => void;
  onOpenInNewTab?: (sessionId: string, project: string, firstPrompt?: string) => void;
  onNewSession?: () => void;
  openSessionIds?: string[];
  runningSessionIds?: string[];
}

export const SessionList = memo(function SessionList({ isOpen, onClose, onSessionSelect, onOpenInNewTab, onNewSession, openSessionIds = [], runningSessionIds = [] }: SessionListProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

      <div className="relative w-full max-w-3xl max-h-[85vh] bg-bg-secondary border border-border flex flex-col animate-scaleIn">
        {/* Terminal header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-tertiary">
          <span className="text-accent-red text-xs">●</span>
          <span className="text-accent-orange text-xs">●</span>
          <span className="text-accent-green text-xs">●</span>
          <span className="text-text-secondary text-xs ml-2">sessions — bash</span>
          <button onClick={onClose} className="ml-auto text-text-secondary hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <SessionListContent
          onSessionSelect={onSessionSelect}
          onOpenInNewTab={onOpenInNewTab}
          onNewSession={onNewSession}
          openSessionIds={openSessionIds}
          runningSessionIds={runningSessionIds}
          compact={false}
          onSelectComplete={onClose}
        />
      </div>
    </div>
  );
});
