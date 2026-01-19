import { useState, useCallback, useMemo, useEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { FolderOpen, X } from 'lucide-react';
import { ChatContainer, ChatInput } from '@/components/chat';
import { FileExplorer, FileExplorerContent, FileViewer, SessionList, SessionListContent, ConfigViewer, ConfigViewerContent, PluginsViewer, PluginsViewerContent, MCPViewer, MCPViewerContent, Sidebar } from '@/components/sidebar';
import { Terminal } from '@/components/terminal';
import { useChatStore, serverApi, localStorageApi, createChatWebSocket, subscribeToSession } from '@/store/chat-store';
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
    setServerState,
    serverState,
    messageCache,
    setMessages,
    sessionMetadata,
    setSessionMetadata,
    getSessionState,
    findTabBySession,
  } = useChatStore();

  // Get list of running session IDs from server state
  const runningSessionIds = useMemo(() => {
    return Object.entries(serverState.sessions)
      .filter(([_, state]) => state.isLoading)
      .map(([id]) => id);
  }, [serverState.sessions]);

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
  // These are per-session (keyed by sessionId), so switching tabs/sessions shows correct streaming
  // pendingUserMessage: message I sent (blocks queue)
  // broadcastedUserPrompt: message from another device (display only, doesn't block queue)
  const [streamingStateBySession, setStreamingStateBySession] = useState<Map<string, {
    pendingUserMessage: string | null;
    broadcastedUserPrompt: string | null;
    streamingContent: ContentBlock[];
  }>>(new Map());

  // Ref for streaming state (to avoid closure issues) - must be declared before callbacks that use it
  const streamingStateBySessionRef = useRef<Map<string, { pendingUserMessage: string | null; broadcastedUserPrompt: string | null; streamingContent: ContentBlock[] }>>(new Map());

  // Get current session's streaming state (use sessionId, fallback to tabId for new sessions)
  const streamingKey = sessionId || activeTabId || '';
  const currentStreamingState = streamingKey ? streamingStateBySession.get(streamingKey) : undefined;
  const pendingUserMessage = currentStreamingState?.pendingUserMessage ?? null;
  const broadcastedUserPrompt = currentStreamingState?.broadcastedUserPrompt ?? null;
  const streamingContent = currentStreamingState?.streamingContent ?? [];

  // Default streaming state
  const defaultStreamingState = { pendingUserMessage: null, broadcastedUserPrompt: null, streamingContent: [] as ContentBlock[] };

  // Helpers to update streaming state for a specific session (or tabId for new sessions)
  const setPendingUserMessage = useCallback((key: string, message: string | null) => {
    setStreamingStateBySession(prev => {
      const next = new Map(prev);
      const current = next.get(key) || defaultStreamingState;
      next.set(key, { ...current, pendingUserMessage: message });
      // Update ref immediately for synchronous access
      streamingStateBySessionRef.current = next;
      return next;
    });
  }, []);

  const setBroadcastedUserPrompt = useCallback((key: string, prompt: string | null) => {
    setStreamingStateBySession(prev => {
      const next = new Map(prev);
      const current = next.get(key) || defaultStreamingState;
      next.set(key, { ...current, broadcastedUserPrompt: prompt });
      return next;
    });
  }, []);

  const setStreamingContent = useCallback((key: string, content: ContentBlock[]) => {
    setStreamingStateBySession(prev => {
      const next = new Map(prev);
      const current = next.get(key) || defaultStreamingState;
      next.set(key, { ...current, streamingContent: content });
      return next;
    });
  }, []);

  const clearStreamingState = useCallback((key: string) => {
    setStreamingStateBySession(prev => {
      const next = new Map(prev);
      next.delete(key);
      // Update ref immediately for synchronous access
      streamingStateBySessionRef.current = next;
      return next;
    });
  }, []);

  const hasPendingMessage = useCallback((key: string) => {
    return streamingStateBySessionRef.current.get(key)?.pendingUserMessage != null;
  }, []);

  // Get message queue for active tab (must be before messages calculation)
  const queuedMessages = activeTabId ? (queueByTab.get(activeTabId) || []) : [];

  // Combine cached messages with streaming content for display
  // Order: cached → pending/broadcasted user → queued users → streaming response
  const messages: Message[] = (() => {
    const result = [...cachedMessages];
    // Add pending user message (local) OR broadcasted prompt (from another device)
    // Only one should exist at a time; local takes precedence
    if (pendingUserMessage) {
      result.push({ type: 'user', content: pendingUserMessage });
    } else if (broadcastedUserPrompt) {
      result.push({ type: 'user', content: broadcastedUserPrompt });
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

  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved ? JSON.parse(saved) : false;
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebar-width');
    return saved ? parseInt(saved, 10) : 280;
  });
  const [sidebarPanel, setSidebarPanel] = useState<'sessions' | 'files' | 'config' | 'plugins' | 'mcp' | null>('sessions');

  // Save sidebar state to localStorage
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', JSON.stringify(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem('sidebar-width', String(sidebarWidth));
  }, [sidebarWidth]);
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

  // WebSocket connection ref for interrupt
  const wsRef = useRef<{ sendInput: (input: string) => void; interrupt: () => void; close: () => void } | null>(null);

  // Subscribe to session broadcasts when session is loading (from another device)
  // This allows us to see real-time updates from other browsers
  // Also subscribes when switching tabs to a session that's already loading
  useEffect(() => {
    if (!sessionId || !isLoading) return;

    // Check if we already have a wsRef (meaning we initiated the request from this tab)
    if (wsRef.current) return;

    console.log('[Broadcast] Subscribing to session (late join):', sessionId);
    let assistantContent: ContentBlock[] = [];

    const sub = subscribeToSession(sessionId, {
      onUserPrompt: (sid, prompt) => {
        if (sid === sessionId) {
          console.log('[Broadcast] User prompt received:', prompt);
          // Use broadcastedUserPrompt instead of pendingUserMessage
          // This way it doesn't block the queue for local messages
          setBroadcastedUserPrompt(sessionId, prompt);
        }
      },
      onData: (dataStr) => {
        try {
          const data = JSON.parse(dataStr);
          if (data.type === 'assistant' && data.message?.content) {
            for (const block of data.message.content) {
              assistantContent.push(block as ContentBlock);
            }
            setStreamingContent(sessionId, [...assistantContent]);
          }
          if (data.type === 'user' && data.message?.content) {
            for (const block of data.message.content) {
              if (block.type === 'tool_result') {
                assistantContent.push(block as ContentBlock);
                setStreamingContent(sessionId, [...assistantContent]);
              }
            }
          }
        } catch {
          // ignore parse errors
        }
      },
      onDone: () => {
        console.log('[Broadcast] Done');
        clearStreamingState(sessionId);
        // Reload history to get final state
        serverApi.loadSessionHistory(sessionId).then(msgs => {
          setMessages(sessionId, msgs);
        });
      },
      onInterrupted: (message) => {
        console.log('[Broadcast] Interrupted:', message);
        clearStreamingState(sessionId);
        // Reload history to get final state
        serverApi.loadSessionHistory(sessionId).then(msgs => {
          setMessages(sessionId, msgs);
        });
      },
    });

    return () => {
      console.log('[Broadcast] Unsubscribing from session:', sessionId);
      sub.close();
    };
  }, [sessionId, isLoading, setBroadcastedUserPrompt, setStreamingContent, clearStreamingState, setMessages]);

  // Send message handler - with queue support (WebSocket based)
  // Source of truth: Claude CLI session files on server
  const handleSendMessage = useCallback((text: string) => {
    if (!activeTab) return;

    const targetTabId = activeTab.id;
    const targetSessionId = activeTab.sessionId;
    // Streaming key: use sessionId if exists, otherwise tabId (for new sessions)
    let streamingKey = targetSessionId || targetTabId;

    // Check if there's already a pending message or loading - add to queue
    const currentIsLoading = isLoadingRef.current;
    const pending = hasPendingMessage(streamingKey);
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
      setPendingUserMessage(streamingKey, text);
      setStreamingContent(streamingKey, []);
    });

    // Track the current session ID (may change for new sessions)
    let currentSessionId = targetSessionId;
    let assistantContent: ContentBlock[] = [];

    // Create WebSocket connection
    const ws = createChatWebSocket(
      {
        prompt: text,
        sessionId: targetSessionId || undefined,
        workDir: targetSessionId ? undefined : workDir,
      },
      {
        onData: (dataStr) => {
          try {
            const data = JSON.parse(dataStr);

            // Handle session init (new session)
            if (data.type === 'system' && data.subtype === 'init' && !targetSessionId) {
              currentSessionId = data.session_id;
              if (currentSessionId) {
                // Update tab with new session ID
                setTabSession(targetTabId, currentSessionId);
                // Set metadata for new session and save workDir to localStorage
                setSessionMetadata(currentSessionId, { workDir });
                localStorageApi.saveLastWorkDir(workDir);
                // Migrate streaming state from tabId to sessionId
                const oldState = streamingStateBySessionRef.current.get(streamingKey);
                if (oldState) {
                  clearStreamingState(streamingKey);
                  streamingKey = currentSessionId;
                  setPendingUserMessage(streamingKey, oldState.pendingUserMessage);
                  setStreamingContent(streamingKey, oldState.streamingContent);
                } else {
                  streamingKey = currentSessionId;
                }
              }
            }

            // Accumulate assistant content for streaming display
            if (data.type === 'assistant' && data.message?.content) {
              for (const block of data.message.content) {
                assistantContent.push(block as ContentBlock);
              }
              setStreamingContent(streamingKey, [...assistantContent]);
            }

            // Handle tool results
            if (data.type === 'user' && data.message?.content) {
              for (const block of data.message.content) {
                if (block.type === 'tool_result') {
                  assistantContent.push(block as ContentBlock);
                  setStreamingContent(streamingKey, [...assistantContent]);
                }
              }
            }

            if (data.type === 'error') {
              assistantContent.push({ type: 'text', text: `Error: ${data.message}` });
              setStreamingContent(streamingKey, [...assistantContent]);
            }

            // Handle result type
            if (data.type === 'result') {
              if (data.is_error && data.errors?.length > 0) {
                const errorMsg = data.errors.join(', ');
                assistantContent.push({ type: 'text', text: `Error: ${errorMsg}` });
                setStreamingContent(streamingKey, [...assistantContent]);
              }
            }
          } catch {
            // JSON parse error, skip
          }
        },
        onError: (message) => {
          console.error('[WS] Error:', message);
          assistantContent.push({ type: 'text', text: `Error: ${message}` });
          setStreamingContent(streamingKey, [...assistantContent]);
        },
        onDone: async () => {
          wsRef.current = null;

          // Streaming complete - reload history from server (source of truth)
          if (currentSessionId) {
            try {
              const loadedMessages = await serverApi.loadSessionHistory(currentSessionId, 100);
              if (loadedMessages.length > 0) {
                setMessages(currentSessionId, loadedMessages);
              }

              const mtimeInfo = await serverApi.getSessionMtime(currentSessionId);
              if (mtimeInfo) {
                sessionMtimeRef.current.set(currentSessionId, mtimeInfo.mtime);
              }
            } catch (historyError) {
              console.error('Failed to reload history:', historyError);
            }
          }

          // Clear streaming state (use current streamingKey which may have changed)
          clearStreamingState(streamingKey);

          // After streaming completes, process queue if any
          const queued = getQueueLatest(targetTabId);
          if (queued.length > 0) {
            clearQueue(targetTabId);
            const combinedMessage = queued.join('\n\n---\n\n');
            setTimeout(() => handleSendMessage(combinedMessage), 100);
          }
        },
      }
    );

    wsRef.current = ws;
  }, [activeTab, workDir, setMessages, addToQueue, getQueueLatest, clearQueue, setSessionMetadata, setTabSession, setPendingUserMessage, setStreamingContent, clearStreamingState, hasPendingMessage]);

  // Clear queue handler
  const handleClearQueue = useCallback(() => {
    if (activeTabId) {
      clearQueue(activeTabId);
    }
  }, [activeTabId, clearQueue]);

  // Tab handlers
  const handleAddTab = useCallback(() => {
    createTab();
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

  const handleInterrupt = useCallback(() => {
    console.log('[Interrupt] Called, wsRef:', !!wsRef.current, 'sessionId:', activeTab?.sessionId);
    if (wsRef.current) {
      console.log('[Interrupt] Using WebSocket interrupt');
      wsRef.current.interrupt();
    } else if (activeTab?.sessionId) {
      // Fallback to REST API if no active WebSocket (e.g., broadcast receiver)
      console.log('[Interrupt] Using REST API interrupt for session:', activeTab.sessionId);
      serverApi.interruptProcess(activeTab.sessionId);
    }
  }, [activeTab]);

  const handleNewSession = useCallback((path?: string) => {
    // If path provided, set it as the work directory for new sessions
    if (path) {
      setNewSessionWorkDir(path);
      localStorageApi.saveLastWorkDir(path);
    }
    // Create a new tab for the new session
    createTab();
    const newIndex = tabs.length;
    setUrlTabIndex(newIndex, false);
    setShowWelcome(true);
  }, [tabs.length, createTab, setUrlTabIndex]);

  // Session selection - switch to existing tab or set session on current tab
  const handleSessionSelect = useCallback((selectedSessionId: string, projectPath: string, firstPrompt?: string) => {
    if (!activeTab) return;

    // Check if session is already open in another tab
    const existingTab = findTabBySession(selectedSessionId);
    if (existingTab && existingTab.id !== activeTab.id) {
      // Session already open - switch to that tab
      setActiveTabId(existingTab.id);
      const existingTabIndex = tabs.findIndex(t => t.id === existingTab.id);
      if (existingTabIndex >= 0) {
        setUrlTabIndex(existingTabIndex, false);
      }
      setShowSessionList(false);
      return;
    }

    // Set session on current tab (messages loaded via sessionId-based cache)
    setTabSession(activeTab.id, selectedSessionId);
    setSessionMetadata(selectedSessionId, { workDir: projectPath, firstPrompt });

    setShowWelcome(false);
    setShowSessionList(false);
  }, [activeTab, tabs, setTabSession, setSessionMetadata, setActiveTabId, findTabBySession, setUrlTabIndex]);

  // Open session in a new tab (always creates new tab)
  const handleOpenInNewTab = useCallback((selectedSessionId: string, projectPath: string, firstPrompt?: string) => {
    // Check if session is already open
    const existingTab = findTabBySession(selectedSessionId);
    if (existingTab) {
      // Session already open - switch to that tab
      setActiveTabId(existingTab.id);
      const existingTabIndex = tabs.findIndex(t => t.id === existingTab.id);
      if (existingTabIndex >= 0) {
        setUrlTabIndex(existingTabIndex, false);
      }
      setShowSessionList(false);
      return;
    }

    // Create new tab with session
    const newTab = createTab();
    setTabSession(newTab.id, selectedSessionId);
    setSessionMetadata(selectedSessionId, { workDir: projectPath, firstPrompt });

    // Switch to the new tab
    const newTabIndex = tabs.length;
    setUrlTabIndex(newTabIndex, false);

    setShowWelcome(false);
    setShowSessionList(false);
  }, [tabs, createTab, setTabSession, setSessionMetadata, setActiveTabId, findTabBySession, setUrlTabIndex]);

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
      {/* Global Header */}
      <header className="shrink-0 bg-bg-secondary border-b border-border">
        <div className="flex items-center justify-between px-4 h-10 border-b border-border bg-bg-secondary">
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
          {/* FILES button - mobile only */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              onClick={() => setShowFileExplorer(true)}
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-text-secondary hover:text-accent-claude border border-border hover:border-accent-claude transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>FILES</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main area: Sidebar + Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - desktop only */}
        <Sidebar
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          activePanel={sidebarPanel}
          onPanelChange={setSidebarPanel}
        >
          {sidebarPanel === 'sessions' && (
            <SessionListContent
              onSessionSelect={handleSessionSelect}
              onOpenInNewTab={handleOpenInNewTab}
              onNewSession={handleNewSession}
              openSessionIds={tabs.filter(t => t.sessionId).map(t => t.sessionId)}
              runningSessionIds={runningSessionIds}
              compact={true}
            />
          )}
          {sidebarPanel === 'files' && (
            <FileExplorerContent
              initialPath={workDir}
              mode="browse"
              onFileSelect={handleFileSelect}
              onDirectorySelect={handleDirectorySelect}
              onNewSession={handleNewSession}
              compact={true}
            />
          )}
          {sidebarPanel === 'config' && (
            <ConfigViewerContent workDir={workDir} compact={true} />
          )}
          {sidebarPanel === 'plugins' && (
            <PluginsViewerContent compact={true} />
          )}
          {sidebarPanel === 'mcp' && (
            <MCPViewerContent workDir={workDir} compact={true} />
          )}
        </Sidebar>

        {/* Content area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Tabs */}
          <div className="flex items-center gap-0 px-2 py-1 overflow-x-auto scrollbar-hide bg-bg-primary border-b border-border shrink-0">
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
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm border border-border text-text-primary hover:border-accent-claude transition-colors text-left md:hidden"
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
        </div>
      </div>

      <SessionList
        isOpen={showSessionList}
        onClose={() => setShowSessionList(false)}
        onSessionSelect={handleSessionSelect}
        onOpenInNewTab={handleOpenInNewTab}
        onNewSession={handleNewSession}
        openSessionIds={tabs.filter(t => t.sessionId).map(t => t.sessionId)}
        runningSessionIds={runningSessionIds}
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
