import { useState, useEffect, useMemo, memo, useCallback } from 'react';
import { X, Clock, FolderOpen, Folder, ChevronDown, ChevronRight, Search, History, FolderTree, FileText, Trash2 } from 'lucide-react';

interface Session {
  sessionId: string;
  firstPrompt: string;
  projectPath: string;
  messageCount: number;
  created: string;
  modified: string;
}

interface SessionListProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionSelect: (sessionId: string, project: string, firstPrompt?: string) => void;
  onNewSession?: () => void;
  openSessionIds?: string[];  // Sessions already open in tabs
}

interface TreeNode {
  name: string;
  path: string;
  sessions: Session[];
  children: Map<string, TreeNode>;
}

type ViewMode = 'recent' | 'tree';

export const SessionList = memo(function SessionList({ isOpen, onClose, onSessionSelect, onNewSession, openSessionIds = [] }: SessionListProps) {
  const isSessionOpen = useCallback((sessionId: string) => openSessionIds.includes(sessionId), [openSessionIds]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('recent');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['/']));

  useEffect(() => {
    if (isOpen) {
      loadSessions();
      setSearchQuery('');
    }
  }, [isOpen]);

  const loadSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/sessions');
      if (!response.ok) {
        throw new Error('Failed to load sessions');
      }
      const data = await response.json();
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // Filter sessions by search query
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const query = searchQuery.toLowerCase();
    return sessions.filter(s =>
      s.firstPrompt.toLowerCase().includes(query) ||
      s.projectPath.toLowerCase().includes(query)
    );
  }, [sessions, searchQuery]);

  // Recent sessions (top 10 by modified date)
  const recentSessions = useMemo(() => {
    return [...filteredSessions]
      .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
      .slice(0, 10);
  }, [filteredSessions]);

  // Build folder tree from sessions using absolute paths
  const folderTree = useMemo(() => {
    const root: TreeNode = {
      name: '/',
      path: '/',
      sessions: [],
      children: new Map()
    };

    // Sort sessions by path first
    const sortedSessions = [...filteredSessions].sort((a, b) =>
      (a.projectPath || '/').localeCompare(b.projectPath || '/')
    );

    for (const session of sortedSessions) {
      const path = session.projectPath || '/';

      // Split path into parts (filter empty strings)
      const parts = path.split('/').filter(Boolean);

      let current = root;
      let currentPath = '';

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        currentPath = `/${currentPath ? currentPath + '/' : ''}${part}`;

        if (!current.children.has(part)) {
          current.children.set(part, {
            name: part,
            path: currentPath,
            sessions: [],
            children: new Map()
          });
        }
        current = current.children.get(part)!;
      }

      // Add session to the final node
      current.sessions.push(session);
    }

    return root;
  }, [filteredSessions]);

  const handleOpenSession = (session: Session) => {
    onSessionSelect(session.sessionId, session.projectPath, session.firstPrompt);
    onClose();
  };

  const handleDeleteSession = async (e: React.MouseEvent, session: Session) => {
    e.stopPropagation(); // Prevent opening the session

    if (!confirm(`Delete session "${session.firstPrompt || '(empty)'}"?`)) {
      return;
    }

    try {
      const url = session.projectPath
        ? `/api/session/${session.sessionId}?project=${encodeURIComponent(session.projectPath)}`
        : `/api/session/${session.sessionId}`;

      const response = await fetch(url, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Failed to delete session');
      }

      // Reload sessions
      loadSessions();
    } catch (err) {
      console.error('Failed to delete session:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete session');
    }
  };

  const togglePath = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
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

  const shortenPath = (path: string): string => {
    return path.replace(/^\/home\/[^/]+/, '~');
  };

  // Render tree node recursively
  const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedPaths.has(node.path);
    const hasChildren = node.children.size > 0;
    const hasSessions = node.sessions.length > 0;
    const hasContent = hasChildren || hasSessions;

    if (!hasContent && depth > 0) return null;

    const indent = depth * 16;
    const totalSessions = countSessions(node);

    return (
      <div key={node.path}>
        {/* Folder row */}
        {depth >= 0 && (
          <button
            onClick={() => togglePath(node.path)}
            className="w-full flex items-center gap-2 px-4 py-1.5 hover:bg-bg-tertiary transition-colors text-sm"
            style={{ paddingLeft: `${16 + indent}px` }}
          >
            {hasContent ? (
              isExpanded ? (
                <ChevronDown className="w-3 h-3 text-text-secondary shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-text-secondary shrink-0" />
              )
            ) : (
              <span className="w-3" />
            )}
            {isExpanded && hasContent ? (
              <FolderOpen className="w-3.5 h-3.5 text-accent-orange shrink-0" />
            ) : (
              <Folder className="w-3.5 h-3.5 text-accent-orange shrink-0" />
            )}
            <span className="text-text-primary truncate flex-1 text-left">
              {node.name}{hasChildren ? '/' : ''}
            </span>
            {totalSessions > 0 && (
              <span className="text-text-secondary text-xs">
                {totalSessions}
              </span>
            )}
          </button>
        )}

        {/* Children and sessions when expanded */}
        {isExpanded && (
          <>
            {/* Child folders first */}
            {Array.from(node.children.values())
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(child => renderTreeNode(child, depth + 1))}

            {/* Sessions in this folder */}
            {node.sessions
              .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
              .map(session => {
                const sessionOpen = isSessionOpen(session.sessionId);
                return (
                  <div
                    key={session.sessionId}
                    className={`w-full flex items-center gap-2 px-4 py-1.5 hover:bg-bg-tertiary transition-colors text-sm group ${sessionOpen ? 'bg-accent-green/5' : ''}`}
                    style={{ paddingLeft: `${16 + indent + 20}px` }}
                  >
                    <button
                      onClick={() => handleOpenSession(session)}
                      className="flex-1 flex items-center gap-2 text-left min-w-0"
                    >
                      <FileText className={`w-3.5 h-3.5 shrink-0 ${sessionOpen ? 'text-accent-green' : 'text-accent-green'}`} />
                      <span className={`flex-1 truncate group-hover:text-accent-claude ${sessionOpen ? 'text-accent-green' : 'text-text-primary'}`}>
                        {session.firstPrompt || '(empty)'}
                      </span>
                    </button>
                    {sessionOpen && (
                      <span className="text-accent-green text-xs shrink-0">[OPEN]</span>
                    )}
                    <span className="text-text-secondary text-xs flex items-center gap-1 shrink-0">
                      <Clock className="w-3 h-3" />
                      {formatDate(session.modified)}
                    </span>
                    {!sessionOpen && (
                      <button
                        onClick={(e) => handleDeleteSession(e, session)}
                        className="opacity-0 group-hover:opacity-100 text-text-secondary hover:text-accent-red transition-all p-0.5 shrink-0"
                        title="Delete session"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
          </>
        )}
      </div>
    );
  };

  // Count total sessions in a node and its children
  const countSessions = (node: TreeNode): number => {
    let count = node.sessions.length;
    for (const child of node.children.values()) {
      count += countSessions(child);
    }
    return count;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

      {/* Terminal-style modal */}
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

        {/* New Session Option */}
        {onNewSession && (
          <button
            onClick={() => { onNewSession(); onClose(); }}
            className="flex items-center gap-3 px-4 py-2 border-b border-border text-sm hover:bg-bg-tertiary transition-colors"
          >
            <span className="text-accent-green">[+]</span>
            <span className="text-accent-claude">NEW_SESSION</span>
            <span className="text-text-secondary ml-auto text-xs">Create new</span>
          </button>
        )}

        {/* Search + View Toggle */}
        <div className="px-4 py-2 border-b border-border flex flex-col sm:flex-row gap-2 sm:items-center">
          {/* Search input */}
          <div className="flex-1 flex items-center gap-2 px-2 py-1.5 bg-bg-primary border border-border focus-within:border-accent-claude">
            <Search className="w-3.5 h-3.5 text-text-secondary shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title or path..."
              className="flex-1 min-w-0 bg-transparent text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-text-secondary hover:text-text-primary text-xs shrink-0"
              >
                [x]
              </button>
            )}
          </div>

          {/* View toggle */}
          <div className="flex items-center border border-border shrink-0 self-end sm:self-auto">
            <button
              onClick={() => setViewMode('recent')}
              className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${
                viewMode === 'recent'
                  ? 'bg-accent-claude/20 text-accent-claude'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <History className="w-3 h-3" />
              Recent
            </button>
            <button
              onClick={() => setViewMode('tree')}
              className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors border-l border-border ${
                viewMode === 'tree'
                  ? 'bg-accent-claude/20 text-accent-claude'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <FolderTree className="w-3 h-3" />
              Tree
            </button>
          </div>
        </div>

        {/* Session List */}
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

          {!loading && !error && filteredSessions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-text-secondary text-sm">
              <p>{searchQuery ? 'No matching sessions' : 'No sessions found'}</p>
            </div>
          )}

          {/* Recent View */}
          {!loading && !error && viewMode === 'recent' && recentSessions.length > 0 && (
            <div>
              <div className="px-4 py-2 text-xs text-text-secondary border-b border-border bg-bg-primary">
                <span className="text-accent-green">$</span> history | head -10
              </div>
              {recentSessions.map((session, idx) => {
                const sessionOpen = isSessionOpen(session.sessionId);
                return (
                  <div
                    key={session.sessionId}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-bg-tertiary border-b border-border/50 last:border-0 group ${sessionOpen ? 'bg-accent-green/5' : ''}`}
                  >
                    <span className="text-text-secondary w-6">[{idx}]</span>
                    <button
                      onClick={() => handleOpenSession(session)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className={`truncate ${sessionOpen ? 'text-accent-green' : 'text-text-primary'}`}>
                        {session.firstPrompt || '(empty)'}
                        {sessionOpen && <span className="ml-2 text-accent-green text-xs">[OPEN]</span>}
                      </div>
                      <div className="text-xs text-text-secondary truncate mt-0.5">
                        <FolderOpen className="w-3 h-3 inline mr-1" />
                        {shortenPath(session.projectPath)}
                      </div>
                    </button>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-text-secondary flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(session.modified)}
                      </div>
                      <div className="text-xs text-text-secondary mt-0.5">
                        {session.messageCount} msg
                      </div>
                    </div>
                    {!sessionOpen && (
                      <button
                        onClick={(e) => handleDeleteSession(e, session)}
                        className="opacity-0 group-hover:opacity-100 text-text-secondary hover:text-accent-red transition-all p-1 shrink-0"
                        title="Delete session"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Tree View */}
          {!loading && !error && viewMode === 'tree' && filteredSessions.length > 0 && (
            <div>
              <div className="px-4 py-2 text-xs text-text-secondary border-b border-border bg-bg-primary">
                <span className="text-accent-green">$</span> tree /
              </div>
              <div className="py-1">
                {renderTreeNode(folderTree, 0)}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border flex items-center justify-between text-xs text-text-secondary">
          <span>
            {searchQuery
              ? `${filteredSessions.length} matches`
              : `${sessions.length} sessions`
            }
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-accent-green">●</span>
            {viewMode === 'recent' ? 'RECENT' : 'TREE'}
          </span>
        </div>
      </div>
    </div>
  );
});
