import { useState, useCallback, useMemo, useEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { FolderOpen, X } from 'lucide-react';
import { ChatContainer, ChatInput } from '@/components/chat';
import { FileExplorer, FileViewer, SessionList, ConfigViewer, PluginsViewer, MCPViewer } from '@/components/sidebar';
import { Terminal } from '@/components/terminal';
import { useChatStore, serverApi, localStorageApi } from '@/store/chat-store';
import type { Message, ContentBlock } from '@/store/types';

// Simple URL-based routing for tabs
function useTabRoute() {
  // Get tab index from URL hash (e.g., #tab/0, #tab/1)
  const getTabIndexFromUrl = () => {
    const hash = window.location.hash;
    const match = hash.match(/^#tab\/(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  };

  // Subscribe to hash changes
  const subscribe = (callback: () => void) => {
    window.addEventListener('hashchange', callback);
    return () => window.removeEventListener('hashchange', callback);
  };

  const tabIndex = useSyncExternalStore(
    subscribe,
    getTabIndexFromUrl,
    getTabIndexFromUrl
  );

  const setTabIndex = useCallback((index: number, replace = false) => {
    const newHash = `#tab/${index}`;
    if (replace) {
      window.history.replaceState(null, '', newHash);
    } else {
      window.history.pushState(null, '', newHash);
    }
  }, []);

  return { tabIndex, setTabIndex };
}

const DEFAULT_WORK_DIR = '/home/seo';

export default function App() {
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    createTab,
    deleteTab,
    setTabSession,
    serverState,
    setServerState,
    messageCache,
    setMessages,
    sessionMetadata,
    setSessionMetadata,
    getSessionState,
    isSessionOpen,
    findTabBySession,
  } = useChatStore();

  // URL-based tab routing
  const { tabIndex: urlTabIndex, setTabIndex: setUrlTabIndex } = useTabRoute();

  // Message queue - React state for UI + ref for latest value access
  const [queueByTab, setQueueByTab] = useState<Map<string, string[]>>(new Map());
  const queueByTabRef = useRef<Map<string, string[]>>(new Map());

  // Keep ref in sync with state
  useEffect(() => {
    queueByTabRef.current = queueByTab;
  }, [queueByTab]);

  const addToQueue = useCallback((tabId: string, message: string) => {
    setQueueByTab(prev => {
      const next = new Map(prev);
      const existing = next.get(tabId) || [];
      next.set(tabId, [...existing, message]);
      return next;
    });
  }, []);

  const clearQueue = useCallback((tabId: string) => {
    setQueueByTab(prev => {
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
  }, []);

  // Get queue from ref for latest value (avoids closure issues)
  const getQueueLatest = useCallback((tabId: string) => {
    return queueByTabRef.current.get(tabId) || [];
  }, []);

  // Derive values from store
  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId), [tabs, activeTabId]);

  // Get session state from server (for loading/processId)
  const sessionId = activeTab?.sessionId || '';
  const sessionState = getSessionState(sessionId);
  const isLoading = sessionState?.isLoading || false;

  // Get messages from cache
  const cachedMessages = useMemo(() => messageCache.get(sessionId) || [], [messageCache, sessionId]);

  // Ref for isLoading to avoid closure issues in handleSendMessage
  const isLoadingRef = useRef(false);
  isLoadingRef.current = isLoading;

  // Streaming state - temporary display during streaming (NOT stored in cache)
  // These are per-tab, so we store them in a Map keyed by tabId
  const [streamingStateByTab, setStreamingStateByTab] = useState<Map<string, {
    pendingUserMessage: string | null;
    streamingContent: ContentBlock[];
  }>>(new Map());

  // Ref for streaming state (to avoid closure issues) - must be declared before callbacks that use it
  const streamingStateByTabRef = useRef<Map<string, { pendingUserMessage: string | null; streamingContent: ContentBlock[] }>>(new Map());

  // Get current tab's streaming state
  const currentStreamingState = activeTabId ? streamingStateByTab.get(activeTabId) : undefined;
  const pendingUserMessage = currentStreamingState?.pendingUserMessage ?? null;
  const streamingContent = currentStreamingState?.streamingContent ?? [];

  // Helpers to update streaming state for a specific tab
  const setPendingUserMessage = useCallback((tabId: string, message: string | null) => {
    setStreamingStateByTab(prev => {
      const next = new Map(prev);
      const current = next.get(tabId) || { pendingUserMessage: null, streamingContent: [] };
      next.set(tabId, { ...current, pendingUserMessage: message });
      // Update ref immediately for synchronous access
      streamingStateByTabRef.current = next;
      return next;
    });
  }, []);

  const setStreamingContent = useCallback((tabId: string, content: ContentBlock[]) => {
    setStreamingStateByTab(prev => {
      const next = new Map(prev);
      const current = next.get(tabId) || { pendingUserMessage: null, streamingContent: [] };
      next.set(tabId, { ...current, streamingContent: content });
      return next;
    });
  }, []);

  const clearStreamingState = useCallback((tabId: string) => {
    setStreamingStateByTab(prev => {
      const next = new Map(prev);
      next.delete(tabId);
      // Update ref immediately for synchronous access
      streamingStateByTabRef.current = next;
      return next;
    });
  }, []);

  const hasPendingMessage = useCallback((tabId: string) => {
    return streamingStateByTabRef.current.get(tabId)?.pendingUserMessage != null;
  }, []);

  // Get message queue for active tab (must be before messages calculation)
  const queuedMessages = activeTabId ? (queueByTab.get(activeTabId) || []) : [];

  // Combine cached messages with streaming content for display
  // Order: cached → pending user → queued users → streaming response
  const messages: Message[] = (() => {
    const result = [...cachedMessages];
    // Add pending user message if exists
    if (pendingUserMessage) {
      result.push({ type: 'user', content: pendingUserMessage });
    }
    // Add queued messages (after pending, before streaming response)
    for (const queuedMsg of queuedMessages) {
      result.push({ type: 'user', content: `⏳ ${queuedMsg}` });
    }
    // Add streaming assistant content if exists (last, as it's the response)
    if (streamingContent.length > 0) {
      result.push({ type: 'assistant', content: streamingContent });
    }
    return result;
  })();

  // WorkDir for new sessions (stored in localStorage)
  const [newSessionWorkDir, setNewSessionWorkDir] = useState<string>(() => {
    return localStorageApi.loadLastWorkDir() || DEFAULT_WORK_DIR;
  });

  // Get workDir - from session metadata if session exists, otherwise from newSessionWorkDir
  const workDir = useMemo(() => {
    if (sessionId) {
      return sessionMetadata.get(sessionId)?.workDir || newSessionWorkDir;
    }
    return newSessionWorkDir;
  }, [sessionId, sessionMetadata, newSessionWorkDir]);

  // Local UI state
  const [showSessionList, setShowSessionList] = useState(false);
  const [showDirectoryPicker, setShowDirectoryPicker] = useState(false);
  const [showFileExplorer, setShowFileExplorer] = useState(false);
  const [showFileViewer, setShowFileViewer] = useState(false);
  const [showConfigViewer, setShowConfigViewer] = useState(false);
  const [showPluginsViewer, setShowPluginsViewer] = useState(false);
  const [showMCPViewer, setShowMCPViewer] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [viewingFile, setViewingFile] = useState<{ path: string; name: string } | null>(null);
  const [showWelcome, setShowWelcome] = useState(!sessionId && messages.length === 0);
  const [tabToClose, setTabToClose] = useState<string | null>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [planMode, setPlanMode] = useState(false);
  const [serverHealth, setServerHealth] = useState<'healthy' | 'unhealthy' | 'checking'>('checking');
  const containerRef = useRef<HTMLDivElement>(null);
  const loadingSessionsRef = useRef<Set<string>>(new Set());
  const sessionMtimeRef = useRef<Map<string, number>>(new Map());

  // Track if initial sync is done
  const initialSyncDoneRef = useRef(false);

  // Subscribe to server state on mount (session processing status)
  useEffect(() => {
    const initState = async () => {
      try {
        // Get current server state
        const state = await serverApi.getState();
        setServerState(state);
        console.log('[App] Initial state loaded');
        initialSyncDoneRef.current = true;
      } catch (error) {
        console.error('[App] Failed to initialize state:', error);
        initialSyncDoneRef.current = true;
      }
    };

    initState();

    const unsubscribe = serverApi.subscribe(
      (state) => {
        setServerState(state);
      },
      (err) => console.error('State subscription error:', err)
    );
    return unsubscribe;
  }, [setServerState]);

  // Sync URL with active tab (URL -> Tab)
  useEffect(() => {
    if (!initialSyncDoneRef.current || tabs.length === 0) return;

    // If URL has a valid tab index, switch to that tab
    if (urlTabIndex !== null && urlTabIndex >= 0 && urlTabIndex < tabs.length) {
      const targetTab = tabs[urlTabIndex];
      if (targetTab && targetTab.id !== activeTabId) {
        setActiveTabId(targetTab.id);
      }
    }
  }, [urlTabIndex, tabs, activeTabId, setActiveTabId]);

  // Sync active tab with URL (Tab -> URL)
  useEffect(() => {
    if (!initialSyncDoneRef.current || tabs.length === 0) return;

    const currentIndex = tabs.findIndex(t => t.id === activeTabId);
    if (currentIndex >= 0 && currentIndex !== urlTabIndex) {
      // Use replace for initial sync, push for user actions
      const isInitialSync = urlTabIndex === null;
      setUrlTabIndex(currentIndex, isInitialSync);
    }
  }, [activeTabId, tabs, urlTabIndex, setUrlTabIndex]);

  // Health check - periodic check every 30 seconds
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('/health');
        if (res.ok) {
          setServerHealth('healthy');
        } else {
          setServerHealth('unhealthy');
        }
      } catch {
        setServerHealth('unhealthy');
      }
    };

    // Initial check
    checkHealth();

    // Periodic check every 30 seconds
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  // Load session metadata for all tabs (for tab titles)
  useEffect(() => {
    const loadAllSessionMetadata = async () => {
      for (const tab of tabs) {
        if (!tab.sessionId) continue;
        if (sessionMetadata.has(tab.sessionId)) continue;

        try {
          const info = await serverApi.getSessionInfo(tab.sessionId);
          if (info) {
            setSessionMetadata(tab.sessionId, {
              workDir: info.projectPath,
              firstPrompt: info.firstPrompt,
            });
          }
        } catch (error) {
          console.error('Failed to load session info:', error);
        }
      }
    };

    loadAllSessionMetadata();
  }, [tabs, sessionMetadata, setSessionMetadata]);

  // Lazy load messages when active tab changes (and has a session)
  useEffect(() => {
    const loadMessages = async () => {
      if (!activeTab?.sessionId) return;
      if (messageCache.has(activeTab.sessionId)) return;
      if (loadingSessionsRef.current.has(activeTab.sessionId)) return;

      loadingSessionsRef.current.add(activeTab.sessionId);

      try {
        const loadedMessages = await serverApi.loadSessionHistory(activeTab.sessionId, 50);
        setMessages(activeTab.sessionId, loadedMessages);

        // Get and store mtime after loading
        const mtimeInfo = await serverApi.getSessionMtime(activeTab.sessionId);
        if (mtimeInfo) {
          sessionMtimeRef.current.set(activeTab.sessionId, mtimeInfo.mtime);
        }
      } catch (error) {
        console.error('Failed to load session:', error);
      } finally {
        loadingSessionsRef.current.delete(activeTab.sessionId);
      }
    };

    loadMessages();
  }, [activeTab?.sessionId, messageCache, setMessages]);

  // Dirty check polling for inactive tabs (check every 10 seconds)
  useEffect(() => {
    const checkDirtyTabs = async () => {
      // Get all inactive tabs with sessions
      const inactiveTabs = tabs.filter(t => {
        if (t.id === activeTabId || !t.sessionId) return false;
        const sessionState = getSessionState(t.sessionId);
        return !sessionState?.isLoading && sessionMtimeRef.current.has(t.sessionId);
      });

      if (inactiveTabs.length === 0) return;

      // Prepare sessions to check
      const sessionsToCheck = inactiveTabs.map(t => ({
        sessionId: t.sessionId,
        lastMtime: sessionMtimeRef.current.get(t.sessionId) || 0,
      }));

      try {
        const dirtySessions = await serverApi.checkSessionsDirty(sessionsToCheck);

        // Reload dirty sessions
        for (const dirty of dirtySessions) {
          console.log('[DirtyCheck] Session changed:', dirty.sessionId);

          // Update mtime
          sessionMtimeRef.current.set(dirty.sessionId, dirty.newMtime);

          // Reload messages
          const loadedMessages = await serverApi.loadSessionHistory(dirty.sessionId, 100);
          if (loadedMessages.length > 0) {
            setMessages(dirty.sessionId, loadedMessages);
          }
        }
      } catch (error) {
        console.error('[DirtyCheck] Failed:', error);
      }
    };

    // Check every 10 seconds
    const interval = setInterval(checkDirtyTabs, 10000);
    return () => clearInterval(interval);
  }, [tabs, activeTabId, setMessages, getSessionState]);

  // Update showWelcome when tab changes
  useEffect(() => {
    setShowWelcome(!sessionId && messages.length === 0);
  }, [sessionId, messages.length]);

  // Handle mobile keyboard
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const handleResize = () => {
      setViewportHeight(viewport.height);
      if (containerRef.current) {
        containerRef.current.style.transform = `translateY(${viewport.offsetTop}px)`;
      }
    };

    viewport.addEventListener('resize', handleResize);
    viewport.addEventListener('scroll', handleResize);
    handleResize();

    return () => {
      viewport.removeEventListener('resize', handleResize);
      viewport.removeEventListener('scroll', handleResize);
      if (containerRef.current) {
        containerRef.current.style.transform = '';
      }
    };
  }, []);

  // Send message handler - with queue support
  // Source of truth: Claude CLI session files on server
  const handleSendMessage = useCallback(async (text: string) => {
    if (!activeTab) return;

    const targetTabId = activeTab.id;
    const targetSessionId = activeTab.sessionId;

    // Check if there's already a pending message or loading - add to queue
    // Use refs to get latest values (avoids closure issues)
    const currentIsLoading = isLoadingRef.current;
    const pending = hasPendingMessage(targetTabId);
    console.log('[handleSendMessage] isLoading:', currentIsLoading, 'hasPending:', pending);
    if (currentIsLoading || pending) {
      console.log('[handleSendMessage] -> going to queue');
      flushSync(() => {
        addToQueue(targetTabId, text);
      });
      return;
    }
    console.log('[handleSendMessage] -> going to pending');

    // Force synchronous render so user sees their message immediately
    flushSync(() => {
      setShowWelcome(false);
      setPendingUserMessage(targetTabId, text);
      setStreamingContent(targetTabId, []);
    });

    // Track the current session ID (may change for new sessions)
    let currentSessionId = targetSessionId;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          sessionId: targetSessionId || undefined,
          workDir: targetSessionId ? undefined : workDir,
        }),
      });

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let assistantContent: ContentBlock[] = [];
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(line.slice(6));

            // Handle session init (new session)
            if (data.type === 'system' && data.subtype === 'init' && !targetSessionId) {
              currentSessionId = data.session_id;
              if (currentSessionId) {
                // Update tab with new session ID
                setTabSession(targetTabId, currentSessionId);
                // Set metadata for new session and save workDir to localStorage
                setSessionMetadata(currentSessionId, { workDir });
                localStorageApi.saveLastWorkDir(workDir);
              }
            }

            // Accumulate assistant content for streaming display
            if (data.type === 'assistant' && data.message?.content) {
              for (const block of data.message.content) {
                assistantContent.push(block as ContentBlock);
              }
              // Update streaming content for real-time display
              setStreamingContent(targetTabId, [...assistantContent]);
            }

            // Handle tool results
            if (data.type === 'user' && data.message?.content) {
              for (const block of data.message.content) {
                if (block.type === 'tool_result') {
                  assistantContent.push(block as ContentBlock);
                  setStreamingContent(targetTabId, [...assistantContent]);
                }
              }
            }

            if (data.type === 'error') {
              assistantContent.push({ type: 'text', text: `Error: ${data.message}` });
              setStreamingContent(targetTabId, [...assistantContent]);
            }

            // Handle result type
            if (data.type === 'result') {
              if (data.is_error && data.errors?.length > 0) {
                const errorMsg = data.errors.join(', ');
                assistantContent.push({ type: 'text', text: `Error: ${errorMsg}` });
                setStreamingContent(targetTabId, [...assistantContent]);
              }
            }
          } catch {
            // JSON parse error, skip
          }
        }
      }

      // Streaming complete - reload history from server (source of truth)
      if (currentSessionId) {
        try {
          const loadedMessages = await serverApi.loadSessionHistory(currentSessionId, 100);
          // Only update if we got messages - don't wipe existing on empty response
          if (loadedMessages.length > 0) {
            setMessages(currentSessionId, loadedMessages);
          }

          // Update mtime after streaming completes
          const mtimeInfo = await serverApi.getSessionMtime(currentSessionId);
          if (mtimeInfo) {
            sessionMtimeRef.current.set(currentSessionId, mtimeInfo.mtime);
          }
        } catch (historyError) {
          console.error('Failed to reload history:', historyError);
          // Keep existing cached messages on error
        }
      }

      // Clear streaming state
      clearStreamingState(targetTabId);

      // After streaming completes, process queue if any
      const queued = getQueueLatest(targetTabId);
      if (queued.length > 0) {
        clearQueue(targetTabId);
        const combinedMessage = queued.join('\n\n---\n\n');
        setTimeout(() => handleSendMessage(combinedMessage), 100);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      // Clear streaming state on error
      clearStreamingState(targetTabId);
    }
  }, [activeTab, workDir, setMessages, addToQueue, getQueueLatest, clearQueue, setSessionMetadata, setTabSession, setPendingUserMessage, setStreamingContent, clearStreamingState, hasPendingMessage]);

  // Clear queue handler
  const handleClearQueue = useCallback(() => {
    if (activeTabId) {
      clearQueue(activeTabId);
    }
  }, [activeTabId, clearQueue]);

  // Tab handlers
  const handleAddTab = useCallback(() => {
    const newTab = createTab();
    // New tab will be at the end, update URL to point to it
    const newIndex = tabs.length; // Current length = new index after adding
    setUrlTabIndex(newIndex, false);
    setShowWelcome(true);
  }, [tabs.length, setUrlTabIndex, createTab]);

  const handleCloseTab = useCallback((tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab && messageCache.has(tab.sessionId)) {
      setTabToClose(tabId);
    } else {
      deleteTab(tabId);
    }
  }, [tabs, messageCache, deleteTab]);

  const confirmCloseTab = useCallback(() => {
    if (tabToClose) {
      deleteTab(tabToClose);
      setTabToClose(null);
    }
  }, [tabToClose, deleteTab]);

  const handleTabClick = useCallback((tabId: string) => {
    // Find the index of the clicked tab
    const index = tabs.findIndex(t => t.id === tabId);
    if (index >= 0) {
      // Update URL first (this will push to history)
      setUrlTabIndex(index, false);
    }
    // Also set active tab directly for immediate response
    setActiveTabId(tabId);
  }, [tabs, setUrlTabIndex, setActiveTabId]);

  const handleInterrupt = useCallback(async () => {
    if (activeTab?.sessionId) {
      await serverApi.interruptProcess(activeTab.sessionId);
    }
  }, [activeTab]);

  const handleNewSession = useCallback(() => {
    if (activeTab) {
      // Clear session from tab
      setTabSession(activeTab.id, '');
    }
    setShowWelcome(true);
  }, [activeTab, setTabSession]);

  // Session selection with 1:1 constraint
  const handleSessionSelect = useCallback((selectedSessionId: string, projectPath: string, firstPrompt?: string) => {
    if (!activeTab) return;

    // Check if session is already open in another tab
    const existingTab = findTabBySession(selectedSessionId);
    if (existingTab && existingTab.id !== activeTab.id) {
      // Session already open - switch to that tab
      setActiveTabId(existingTab.id);
      setShowSessionList(false);
      return;
    }

    // Set session on current tab
    setTabSession(activeTab.id, selectedSessionId);

    // Set workDir and firstPrompt metadata
    setSessionMetadata(selectedSessionId, { workDir: projectPath, firstPrompt });

    setShowWelcome(false);
    setShowSessionList(false);
  }, [activeTab, setTabSession, setSessionMetadata, setActiveTabId, findTabBySession]);

  const handleDirectorySelect = useCallback((path: string) => {
    // Update workDir for new sessions and save to localStorage
    setNewSessionWorkDir(path);
    localStorageApi.saveLastWorkDir(path);
    setShowDirectoryPicker(false);
  }, []);

  const handleFileSelect = useCallback((path: string, name: string) => {
    setViewingFile({ path, name });
    setShowFileViewer(true);
  }, []);

  const displayPath = workDir.replace(/^\/home\/[^/]+/, '~');

  // Show loading if no tabs yet
  if (tabs.length === 0) {
    return (
      <div className="bg-bg-primary h-screen flex items-center justify-center">
        <div className="text-text-secondary">Loading...</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="bg-bg-primary flex flex-col overflow-hidden"
      style={{ height: viewportHeight ? `${viewportHeight}px` : '100dvh' }}
    >
      {/* Header */}
      <header className="shrink-0 bg-bg-secondary border-b border-border">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-secondary">
          <div className="flex items-center gap-3">
            {/* Apple-style window buttons */}
            <div className="flex items-center gap-1.5" title={`Server: ${serverHealth}`}>
              <span className={`text-xs ${serverHealth === 'unhealthy' ? 'opacity-50' : ''}`} style={{ color: '#ff5f57' }}>●</span>
              <span className={`text-xs ${serverHealth === 'checking' ? 'animate-pulse' : ''}`} style={{ color: '#febc2e' }}>●</span>
              <span className={`text-xs ${serverHealth !== 'healthy' ? 'opacity-50' : ''}`} style={{ color: '#28c840' }}>●</span>
            </div>
            <span className="text-accent-claude font-bold tracking-wider text-sm">CLAUDE</span>
            <span className="text-text-secondary text-xs">v2.0</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFileExplorer(true)}
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-text-secondary hover:text-accent-claude border border-border hover:border-accent-claude transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>FILES</span>
            </button>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex items-center gap-0 px-2 py-1 overflow-x-auto scrollbar-hide bg-bg-primary border-b border-border">
          {tabs.map((tab, index) => {
            const tabMessages = messageCache.get(tab.sessionId) || [];
            const firstUserMsg = tabMessages.find((m) => m.type === 'user');
            const metadata = tab.sessionId ? sessionMetadata.get(tab.sessionId) : undefined;
            const tabSessionState = tab.sessionId ? getSessionState(tab.sessionId) : undefined;
            let tabTitle = firstUserMsg
              ? (firstUserMsg.content as string).slice(0, 25) + ((firstUserMsg.content as string).length > 25 ? '...' : '')
              : metadata?.firstPrompt
                ? metadata.firstPrompt.slice(0, 25) + (metadata.firstPrompt.length > 25 ? '...' : '')
                : tab.sessionId
                  ? 'session'
                  : 'new';

            const isActive = tab.id === activeTabId;
            const tabIsLoading = tabSessionState?.isLoading || false;
            return (
              <div
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs whitespace-nowrap shrink-0 border-r border-border transition-all ${
                  isActive
                    ? 'bg-bg-tertiary text-accent-claude border-b-2 border-b-accent-claude -mb-px'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary'
                }`}
              >
                <span className="text-text-secondary">[{index}]</span>
                <span className="max-w-40 truncate">
                  {tabIsLoading && '⏳ '}
                  {tabTitle}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}
                  className={`transition-all ${
                    isActive
                      ? 'text-accent-red/70 hover:text-accent-red'
                      : 'opacity-0 group-hover:opacity-100 text-text-secondary hover:text-accent-red'
                  }`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
          <button
            onClick={handleAddTab}
            className="flex items-center justify-center px-3 py-1.5 text-text-secondary hover:text-accent-green transition-all shrink-0 text-xs"
          >
            [+]
          </button>
        </div>
      </header>

      {showWelcome ? (
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
          <div className="w-full max-w-lg border border-border bg-bg-secondary">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-tertiary">
              <span className="text-accent-red text-xs">●</span>
              <span className="text-accent-orange text-xs">●</span>
              <span className="text-accent-green text-xs">●</span>
              <span className="text-text-secondary text-xs ml-2">claude-code — bash</span>
            </div>
            <div className="p-4 space-y-4">
              <div className="text-text-secondary text-sm">
                <span className="text-accent-green">$</span> claude --version
              </div>
              <div className="text-text-primary">
                <span className="text-accent-claude font-bold">CLAUDE CODE</span> <span className="text-text-secondary">v2.0.0</span>
              </div>
              <div className="text-text-secondary text-sm">
                <span className="text-accent-green">$</span> pwd
              </div>
              <div className="text-accent-green text-sm">{displayPath}</div>
              <div className="text-text-secondary text-sm mt-6">
                <span className="text-accent-green">$</span> Select an action:
              </div>
              <div className="space-y-2 mt-2">
                <button
                  onClick={() => setShowWelcome(false)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm border border-accent-claude text-accent-claude hover:bg-accent-claude hover:text-bg-primary transition-colors text-left"
                >
                  <span className="text-text-secondary">[1]</span>
                  <span>NEW_SESSION</span>
                </button>
                <button
                  onClick={() => setShowSessionList(true)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm border border-border text-text-primary hover:border-accent-claude transition-colors text-left"
                >
                  <span className="text-text-secondary">[2]</span>
                  <span>OPEN_SESSION</span>
                </button>
                <button
                  onClick={() => setShowDirectoryPicker(true)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm border border-border text-text-primary hover:border-accent-claude transition-colors text-left"
                >
                  <span className="text-text-secondary">[3]</span>
                  <span>CHANGE_DIR</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <ChatContainer messages={messages} isLoading={isLoading} />
          <ChatInput
            onSend={handleSendMessage}
            onInterrupt={handleInterrupt}
            isLoading={isLoading}
            workDir={workDir}
            queueCount={queuedMessages.length}
            queuedMessages={queuedMessages}
            planMode={planMode}
            onTogglePlanMode={() => setPlanMode(!planMode)}
            onOpenConfig={() => setShowConfigViewer(true)}
            onOpenPlugins={() => setShowPluginsViewer(true)}
            onOpenMCP={() => setShowMCPViewer(true)}
            onOpenTerminal={() => setShowTerminal(true)}
            onOpenHistory={() => setShowSessionList(true)}
            onClearQueue={handleClearQueue}
          />
        </div>
      )}

      <SessionList
        isOpen={showSessionList}
        onClose={() => setShowSessionList(false)}
        onSessionSelect={handleSessionSelect}
        onNewSession={handleNewSession}
        openSessionIds={tabs.filter(t => t.sessionId).map(t => t.sessionId)}
      />

      <FileExplorer
        isOpen={showDirectoryPicker}
        onClose={() => setShowDirectoryPicker(false)}
        onDirectorySelect={handleDirectorySelect}
        initialPath={workDir}
        mode="selectDirectory"
      />

      <FileExplorer
        isOpen={showFileExplorer}
        onClose={() => setShowFileExplorer(false)}
        onFileSelect={handleFileSelect}
        onDirectorySelect={handleDirectorySelect}
        initialPath={workDir}
      />

      <FileViewer
        isOpen={showFileViewer}
        onClose={() => { setShowFileViewer(false); setViewingFile(null); }}
        filePath={viewingFile?.path || ''}
        fileName={viewingFile?.name || ''}
      />

      <ConfigViewer isOpen={showConfigViewer} onClose={() => setShowConfigViewer(false)} workDir={workDir} />
      <PluginsViewer isOpen={showPluginsViewer} onClose={() => setShowPluginsViewer(false)} />
      <MCPViewer isOpen={showMCPViewer} onClose={() => setShowMCPViewer(false)} workDir={workDir} />
      <Terminal isOpen={showTerminal} onClose={() => setShowTerminal(false)} />

      {tabToClose && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100]">
          <div className="bg-bg-secondary border border-border max-w-sm mx-4">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-tertiary">
              <span className="text-accent-red text-xs">●</span>
              <span className="text-text-secondary text-xs">confirm</span>
            </div>
            <div className="p-4">
              <div className="text-sm text-text-secondary mb-2">
                <span className="text-accent-orange">WARNING:</span> Close this tab?
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setTabToClose(null)}
                  className="flex-1 px-4 py-2 border border-border hover:border-accent-claude text-text-primary transition-colors text-sm"
                >
                  [N] CANCEL
                </button>
                <button
                  onClick={confirmCloseTab}
                  className="flex-1 px-4 py-2 border border-accent-red bg-accent-red/20 hover:bg-accent-red text-accent-red hover:text-bg-primary transition-colors text-sm"
                >
                  [Y] CLOSE
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
