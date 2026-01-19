import { create } from 'zustand';
import type { ServerState, TabState, Message, LocalTabState, ActiveProcess, ContentBlock } from './types';

// Local storage keys
const TABS_STORAGE_KEY = 'claude-web-ui-tabs';
const LAST_WORKDIR_KEY = 'claude-web-ui-last-workdir';
const AUTO_EXPAND_TOOLS_KEY = 'claude-web-ui-auto-expand-tools';

interface ChatStore {
  // Server state (synced via SSE)
  serverState: ServerState;
  setServerState: (state: ServerState) => void;

  // Local message cache (per session)
  messageCache: Map<string, Message[]>;
  setMessages: (sessionId: string, messages: Message[]) => void;
  appendMessage: (sessionId: string, message: Message) => void;
  clearMessages: (sessionId: string) => void;

  // Message queue (per tab) - client-side only, for queuing while processing
  messageQueue: Map<string, string[]>;
  addToQueue: (tabId: string, message: string) => void;
  popFromQueue: (tabId: string) => string | undefined;
  clearQueue: (tabId: string) => void;
  getQueue: (tabId: string) => string[];

  // Session metadata cache (workDir, firstPrompt, etc.)
  sessionMetadata: Map<string, { workDir: string; firstPrompt?: string }>;
  setSessionMetadata: (sessionId: string, metadata: { workDir: string; firstPrompt?: string }) => void;

  // Helpers
  getActiveTab: () => TabState | undefined;
  getLocalTab: (tabId: string) => LocalTabState | undefined;
}

export const useChatStore = create<ChatStore>()((set, get) => ({
  serverState: {
    tabs: [],
    activeTabId: '',
    version: 0,
  },

  messageCache: new Map(),
  messageQueue: new Map(),
  sessionMetadata: new Map(),

  setServerState: (state) => set({ serverState: state }),

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

  // Message queue methods
  addToQueue: (tabId, message) => {
    const queue = new Map(get().messageQueue);
    const existing = queue.get(tabId) || [];
    queue.set(tabId, [...existing, message]);
    set({ messageQueue: queue });
  },

  popFromQueue: (tabId) => {
    const queue = new Map(get().messageQueue);
    const existing = queue.get(tabId) || [];
    if (existing.length === 0) return undefined;
    const [first, ...rest] = existing;
    queue.set(tabId, rest);
    set({ messageQueue: queue });
    return first;
  },

  clearQueue: (tabId) => {
    const queue = new Map(get().messageQueue);
    queue.delete(tabId);
    set({ messageQueue: queue });
  },

  getQueue: (tabId) => {
    return get().messageQueue.get(tabId) || [];
  },

  setSessionMetadata: (sessionId, metadata) => {
    const metadataCache = new Map(get().sessionMetadata);
    metadataCache.set(sessionId, metadata);
    set({ sessionMetadata: metadataCache });
  },

  getActiveTab: () => {
    const { serverState } = get();
    return serverState.tabs.find((t) => t.id === serverState.activeTabId);
  },

  getLocalTab: (tabId: string) => {
    const { serverState, messageCache, sessionMetadata } = get();
    const tab = serverState.tabs.find((t) => t.id === tabId);
    if (!tab) return undefined;

    const messages = tab.sessionId ? messageCache.get(tab.sessionId) || [] : [];
    const metadata = tab.sessionId ? sessionMetadata.get(tab.sessionId) : undefined;

    return {
      ...tab,
      messages,
      messagesLoaded: tab.sessionId ? messageCache.has(tab.sessionId) : true,
      workDir: metadata?.workDir || '',
    };
  },
}));


// ============ Server API ============

export const serverApi = {
  // SSE subscription for state updates
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

  // Get current state
  async getState(): Promise<ServerState> {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error(`Failed to get state: ${res.status}`);
    return res.json();
  },

  // Tab management
  async createTab(): Promise<TabState> {
    const res = await fetch('/api/state/tabs', { method: 'POST' });
    if (!res.ok) throw new Error(`Failed to create tab: ${res.status}`);
    return res.json();
  },

  async deleteTab(tabId: string): Promise<void> {
    const res = await fetch(`/api/state/tabs/${tabId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Failed to delete tab: ${res.status}`);
  },

  async setActiveTab(tabId: string): Promise<void> {
    const res = await fetch(`/api/state/tabs/${tabId}/active`, { method: 'POST' });
    if (!res.ok) throw new Error(`Failed to set active tab: ${res.status}`);
  },

  // Session management (with 1:1 constraint)
  async setTabSession(tabId: string, sessionId: string): Promise<{ success: boolean; existingTabId?: string }> {
    const res = await fetch(`/api/state/tabs/${tabId}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });

    if (res.status === 409) {
      // Session already open in another tab
      const data = await res.json();
      return { success: false, existingTabId: data.existingTabId };
    }

    if (!res.ok) throw new Error(`Failed to set session: ${res.status}`);
    return { success: true };
  },

  async getSessionTab(sessionId: string): Promise<string | null> {
    const res = await fetch(`/api/state/session/${sessionId}/tab`);
    if (!res.ok) throw new Error(`Failed to get session tab: ${res.status}`);
    const data = await res.json();
    return data.tabId;
  },

  // Get active processes (to check if session is processing)
  async getActiveProcesses(): Promise<ActiveProcess[]> {
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
  async interruptProcess(processId: number | null, tabId?: string): Promise<void> {
    const params = new URLSearchParams();
    if (processId) params.set('processId', String(processId));
    if (tabId) params.set('tabId', tabId);
    await fetch(`/api/chat?${params.toString()}`, { method: 'DELETE' });
  },
};

// ============ Local Storage Helpers ============

export const localStorageApi = {
  // Save open tabs info (just sessionIds)
  saveOpenTabs(tabs: Array<{ id: string; sessionId: string }>): void {
    try {
      localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs));
    } catch (e) {
      console.error('Failed to save tabs to localStorage:', e);
    }
  },

  // Load saved tabs info
  loadOpenTabs(): Array<{ id: string; sessionId: string }> {
    try {
      const data = localStorage.getItem(TABS_STORAGE_KEY);
      if (!data) return [];
      return JSON.parse(data);
    } catch (e) {
      console.error('Failed to load tabs from localStorage:', e);
      return [];
    }
  },

  // Clear saved tabs
  clearOpenTabs(): void {
    try {
      localStorage.removeItem(TABS_STORAGE_KEY);
    } catch (e) {
      console.error('Failed to clear tabs from localStorage:', e);
    }
  },

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
