import { create } from 'zustand';
import type { ServerState, TabState, Message, SessionState, ContentBlock } from './types';

// Local storage keys
const TABS_STORAGE_KEY = 'claude-web-ui-tabs';
const ACTIVE_TAB_KEY = 'claude-web-ui-active-tab';
const LAST_WORKDIR_KEY = 'claude-web-ui-last-workdir';
const AUTO_EXPAND_TOOLS_KEY = 'claude-web-ui-auto-expand-tools';

// Generate unique tab ID
function generateTabId(): string {
  return 'tab-' + Math.random().toString(36).substring(2, 10);
}

interface ChatStore {
  // Client-side tab management (localStorage backed)
  tabs: TabState[];
  activeTabId: string;
  setTabs: (tabs: TabState[]) => void;
  setActiveTabId: (tabId: string) => void;
  createTab: () => TabState;
  deleteTab: (tabId: string) => void;
  setTabSession: (tabId: string, sessionId: string) => void;

  // Server state (session processing status only)
  serverState: ServerState;
  setServerState: (state: ServerState) => void;

  // Get session state from server
  getSessionState: (sessionId: string) => SessionState | undefined;

  // Local message cache (per session)
  messageCache: Map<string, Message[]>;
  setMessages: (sessionId: string, messages: Message[]) => void;
  appendMessage: (sessionId: string, message: Message) => void;
  clearMessages: (sessionId: string) => void;

  // Session metadata cache (workDir, firstPrompt, etc.)
  sessionMetadata: Map<string, { workDir: string; firstPrompt?: string }>;
  setSessionMetadata: (sessionId: string, metadata: { workDir: string; firstPrompt?: string }) => void;

  // Helpers
  getActiveTab: () => TabState | undefined;
  isSessionOpen: (sessionId: string) => boolean;
  findTabBySession: (sessionId: string) => TabState | undefined;
}

// Load initial tabs from localStorage
function loadTabsFromStorage(): { tabs: TabState[], activeTabId: string } {
  try {
    const tabsJson = localStorage.getItem(TABS_STORAGE_KEY);
    const activeTabId = localStorage.getItem(ACTIVE_TAB_KEY) || '';

    if (tabsJson) {
      const tabs = JSON.parse(tabsJson) as TabState[];
      if (tabs.length > 0) {
        // Validate activeTabId
        const validActiveId = tabs.find(t => t.id === activeTabId) ? activeTabId : tabs[0].id;
        return { tabs, activeTabId: validActiveId };
      }
    }
  } catch (e) {
    console.error('Failed to load tabs from localStorage:', e);
  }

  // Default: one empty tab
  const defaultTab: TabState = { id: generateTabId(), sessionId: '' };
  return { tabs: [defaultTab], activeTabId: defaultTab.id };
}

// Save tabs to localStorage
function saveTabsToStorage(tabs: TabState[], activeTabId: string): void {
  try {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs));
    localStorage.setItem(ACTIVE_TAB_KEY, activeTabId);
  } catch (e) {
    console.error('Failed to save tabs to localStorage:', e);
  }
}

const initialState = loadTabsFromStorage();

export const useChatStore = create<ChatStore>()((set, get) => ({
  // Client-side tab state
  tabs: initialState.tabs,
  activeTabId: initialState.activeTabId,

  // Server state (sessions only)
  serverState: {
    sessions: {},
    version: 0,
  },

  messageCache: new Map(),
  sessionMetadata: new Map(),

  setTabs: (tabs) => {
    const { activeTabId } = get();
    set({ tabs });
    saveTabsToStorage(tabs, activeTabId);
  },

  setActiveTabId: (activeTabId) => {
    const { tabs } = get();
    set({ activeTabId });
    saveTabsToStorage(tabs, activeTabId);
  },

  createTab: () => {
    const { tabs, activeTabId } = get();
    const newTab: TabState = { id: generateTabId(), sessionId: '' };
    const newTabs = [...tabs, newTab];
    set({ tabs: newTabs, activeTabId: newTab.id });
    saveTabsToStorage(newTabs, newTab.id);
    return newTab;
  },

  deleteTab: (tabId) => {
    const { tabs, activeTabId } = get();
    let newTabs = tabs.filter(t => t.id !== tabId);

    // Ensure at least one tab exists
    if (newTabs.length === 0) {
      const newTab: TabState = { id: generateTabId(), sessionId: '' };
      newTabs = [newTab];
    }

    // Update active tab if needed
    let newActiveTabId = activeTabId;
    if (activeTabId === tabId) {
      newActiveTabId = newTabs[newTabs.length - 1].id;
    }

    set({ tabs: newTabs, activeTabId: newActiveTabId });
    saveTabsToStorage(newTabs, newActiveTabId);
  },

  setTabSession: (tabId, sessionId) => {
    const { tabs, activeTabId } = get();
    const newTabs = tabs.map(t =>
      t.id === tabId ? { ...t, sessionId } : t
    );
    set({ tabs: newTabs });
    saveTabsToStorage(newTabs, activeTabId);
  },

  setServerState: (state) => set({ serverState: state }),

  getSessionState: (sessionId) => {
    const { serverState } = get();
    return serverState.sessions[sessionId];
  },

  setMessages: (sessionId, messages) => {
    const cache = new Map(get().messageCache);
    cache.set(sessionId, messages);
    set({ messageCache: cache });
  },

  appendMessage: (sessionId, message) => {
    const cache = new Map(get().messageCache);
    const existing = cache.get(sessionId) || [];
    cache.set(sessionId, [...existing, message]);
    set({ messageCache: cache });
  },

  clearMessages: (sessionId) => {
    const cache = new Map(get().messageCache);
    cache.delete(sessionId);
    set({ messageCache: cache });
  },

  setSessionMetadata: (sessionId, metadata) => {
    const metadataCache = new Map(get().sessionMetadata);
    metadataCache.set(sessionId, metadata);
    set({ sessionMetadata: metadataCache });
  },

  getActiveTab: () => {
    const { tabs, activeTabId } = get();
    return tabs.find((t) => t.id === activeTabId);
  },

  isSessionOpen: (sessionId) => {
    const { tabs } = get();
    return tabs.some(t => t.sessionId === sessionId);
  },

  findTabBySession: (sessionId) => {
    const { tabs } = get();
    return tabs.find(t => t.sessionId === sessionId);
  },
}));


// ============ WebSocket Chat API ============

export type WSMessageHandler = {
  onData: (data: string) => void;
  onError: (message: string) => void;
  onDone: () => void;
  onInterrupted?: (message: string) => void;
  onInputRequest?: (data: unknown) => void;
  onProcessId?: (processId: number) => void;
};

export function createChatWebSocket(
  request: { prompt: string; sessionId?: string; workDir?: string },
  handlers: WSMessageHandler
): { sendInput: (input: string) => void; interrupt: () => void; close: () => void } {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}/api/chat/ws`);

  let sessionId = request.sessionId;

  ws.onopen = () => {
    // Send chat request
    ws.send(JSON.stringify({
      type: 'chat',
      payload: request,
    }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'data':
          handlers.onData(msg.data);
          break;
        case 'error':
          handlers.onError(msg.message);
          break;
        case 'done':
          handlers.onDone();
          break;
        case 'interrupted':
          handlers.onInterrupted?.(msg.message);
          break;
        case 'inputRequest':
          handlers.onInputRequest?.(msg.data);
          break;
        case 'processId':
          handlers.onProcessId?.(msg.processId);
          break;
        case 'stderr':
          // Log stderr but don't treat as error
          console.log('[WS stderr]', msg.message);
          break;
      }
    } catch (e) {
      console.error('[WS] Parse error:', e);
    }
  };

  ws.onerror = (err) => {
    console.error('[WS] Error:', err);
    handlers.onError('WebSocket connection error');
  };

  ws.onclose = () => {
    console.log('[WS] Connection closed');
  };

  return {
    sendInput: (input: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'input',
          payload: { input },
        }));
      }
    },
    interrupt: () => {
      if (ws.readyState === WebSocket.OPEN && sessionId) {
        ws.send(JSON.stringify({
          type: 'interrupt',
          payload: { sessionId },
        }));
      }
    },
    close: () => {
      ws.close();
    },
  };
}

// Session broadcast subscription handler types
type SessionBroadcastHandler = {
  onUserPrompt?: (sessionId: string, prompt: string) => void;
  onData?: (data: string) => void;
  onDone?: () => void;
  onInterrupted?: (message: string) => void;
  onError?: (message: string) => void;
};

// Subscribe to session broadcasts (for watching other users' activity)
export function subscribeToSession(
  sessionId: string,
  handlers: SessionBroadcastHandler
): { close: () => void } {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}/api/chat/ws`);

  ws.onopen = () => {
    // Subscribe to session
    ws.send(JSON.stringify({
      type: 'subscribe',
      payload: { sessionId },
    }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'userPrompt':
          handlers.onUserPrompt?.(msg.sessionId, msg.prompt);
          break;
        case 'data':
          handlers.onData?.(msg.data);
          break;
        case 'done':
          handlers.onDone?.();
          break;
        case 'interrupted':
          handlers.onInterrupted?.(msg.message);
          break;
        case 'error':
          handlers.onError?.(msg.message);
          break;
      }
    } catch (e) {
      console.error('[SessionWS] Parse error:', e);
    }
  };

  ws.onerror = (err) => {
    console.error('[SessionWS] Error:', err);
  };

  return {
    close: () => ws.close(),
  };
}

// ============ Server API ============

export const serverApi = {
  // SSE subscription for session state updates
  subscribe(onMessage: (state: ServerState) => void, onError?: (err: Error) => void) {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isClosing = false;

    const connect = () => {
      if (isClosing) return;

      eventSource = new EventSource('/api/state/subscribe');

      eventSource.onmessage = (event) => {
        try {
          const state = JSON.parse(event.data) as ServerState;
          onMessage(state);
        } catch (e) {
          console.error('Failed to parse state:', e);
        }
      };

      eventSource.onerror = () => {
        if (isClosing) return;
        console.log('SSE connection lost, reconnecting in 2s...');
        eventSource?.close();
        reconnectTimeout = setTimeout(connect, 2000);
      };

      eventSource.onopen = () => {
        console.log('SSE connected');
      };
    };

    connect();

    return () => {
      isClosing = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      eventSource?.close();
    };
  },

  // Get current session state
  async getState(): Promise<ServerState> {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error(`Failed to get state: ${res.status}`);
    return res.json();
  },

  // Get active processes (to check if session is processing)
  async getActiveProcesses(): Promise<Array<{
    processId: number;
    sessionId: string;
    workDir: string;
    startTime: number;
  }>> {
    const res = await fetch('/api/processes');
    if (!res.ok) throw new Error(`Failed to get processes: ${res.status}`);
    const data = await res.json();
    return data.processes || [];
  },

  // Load session history from Claude CLI
  async loadSessionHistory(sessionId: string, limit = 50): Promise<Message[]> {
    const res = await fetch(`/api/session/${sessionId}/history?limit=${limit}`);
    if (!res.ok) {
      console.error(`Failed to load session history: ${res.status}`);
      throw new Error(`Failed to load session history: ${res.status}`);
    }

    const data = await res.json();
    if (!data.messages) return [];

    // Convert to our Message format
    const messages: Message[] = [];
    for (const msg of data.messages) {
      if (msg.type === 'user' || msg.type === 'human') {
        const content = msg.message?.content;
        // User messages: extract text from content (string or array of blocks)
        let text = '';
        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          // Extract text blocks, preserve image references
          const parts: string[] = [];
          for (const block of content) {
            if (block && typeof block === 'object') {
              if (block.type === 'text' && typeof block.text === 'string') {
                parts.push(block.text);
              } else if (block.type === 'image' && block.source?.type === 'base64') {
                // Image block - represent as placeholder
                parts.push('[Image attached]');
              }
            }
          }
          text = parts.join('\n');
        }
        if (text) {
          messages.push({ type: 'user', content: text });
        }
      } else if (msg.type === 'assistant' && msg.message?.content) {
        messages.push({ type: 'assistant', content: msg.message.content as ContentBlock[] });
      }
    }

    return messages;
  },

  // Get session list
  async getSessions(workDir?: string): Promise<Array<{
    sessionId: string;
    firstPrompt: string;
    messageCount: number;
    modified: string;
    projectPath: string;
  }>> {
    const url = workDir
      ? `/api/sessions?work_dir=${encodeURIComponent(workDir)}`
      : '/api/sessions';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to get sessions: ${res.status}`);
    const data = await res.json();
    return data.sessions || [];
  },

  // Get single session info
  async getSessionInfo(sessionId: string): Promise<{
    sessionId: string;
    firstPrompt: string;
    messageCount: number;
    modified: string;
    projectPath: string;
  } | null> {
    const res = await fetch(`/api/session/${sessionId}/info`);
    if (!res.ok) return null;
    return res.json();
  },

  // Get session modification time
  async getSessionMtime(sessionId: string): Promise<{ sessionId: string; mtime: number } | null> {
    const res = await fetch(`/api/session/${sessionId}/mtime`);
    if (!res.ok) return null;
    return res.json();
  },

  // Check multiple sessions for changes (dirty check)
  async checkSessionsDirty(sessions: Array<{ sessionId: string; lastMtime: number }>): Promise<Array<{ sessionId: string; newMtime: number }>> {
    const res = await fetch('/api/sessions/dirty-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessions }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.dirtySessions || [];
  },

  // Interrupt process
  async interruptProcess(sessionId: string): Promise<void> {
    const params = new URLSearchParams();
    if (sessionId) params.set('sessionId', sessionId);
    await fetch(`/api/chat?${params.toString()}`, { method: 'DELETE' });
  },
};

// ============ Local Storage Helpers ============

export const localStorageApi = {
  // Save last used workDir
  saveLastWorkDir(workDir: string): void {
    try {
      localStorage.setItem(LAST_WORKDIR_KEY, workDir);
    } catch (e) {
      console.error('Failed to save workDir to localStorage:', e);
    }
  },

  // Load last used workDir
  loadLastWorkDir(): string | null {
    try {
      return localStorage.getItem(LAST_WORKDIR_KEY);
    } catch (e) {
      console.error('Failed to load workDir from localStorage:', e);
      return null;
    }
  },

  // Save auto-expand tools setting
  saveAutoExpandTools(enabled: boolean): void {
    try {
      localStorage.setItem(AUTO_EXPAND_TOOLS_KEY, String(enabled));
    } catch (e) {
      console.error('Failed to save autoExpandTools to localStorage:', e);
    }
  },

  // Load auto-expand tools setting (default true)
  loadAutoExpandTools(): boolean {
    try {
      const saved = localStorage.getItem(AUTO_EXPAND_TOOLS_KEY);
      return saved === null ? true : saved === 'true';
    } catch (e) {
      console.error('Failed to load autoExpandTools from localStorage:', e);
      return true;
    }
  },
};
