// Content block types from Claude API
export type TextContent = {
  type: 'text';
  text: string;
};

export type ThinkingContent = {
  type: 'thinking';
  thinking: string;
};

export type ToolUseContent = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResultContent = {
  type: 'tool_result';
  tool_use_id: string;
  content: string | unknown[];
};

export type ContentBlock =
  | TextContent
  | ThinkingContent
  | ToolUseContent
  | ToolResultContent;

// Message types
export type UserMessage = {
  type: 'user';
  content: string;
};

export type AssistantMessage = {
  type: 'assistant';
  content: ContentBlock[];
};

export type Message = UserMessage | AssistantMessage;

// Session metadata from Claude CLI
export type SessionMetadata = {
  sessionId: string;
  firstPrompt: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  isSidechain: boolean;
};

// Tab state (client-side only, stored in localStorage)
export type TabState = {
  id: string;
  sessionId: string;  // empty string = new session
};

// Session state from server (per-session processing status)
export type SessionState = {
  sessionId: string;
  isLoading: boolean;
  processId: number | null;
};

// Server state (session processing status only - no tabs)
export type ServerState = {
  sessions: Record<string, SessionState>;  // sessionId -> state
  version: number;
};

// Active process info
export type ActiveProcess = {
  processId: number;
  sessionId: string;
  workDir: string;
  startTime: number;
};

// Local tab state (tab + messages + metadata)
export type LocalTabState = TabState & {
  messages: Message[];        // Loaded from CLI session on-demand
  messagesLoaded: boolean;    // Whether messages have been loaded
  workDir: string;            // From session metadata
  isLoading: boolean;         // From server session state
  processId: number | null;   // From server session state
};
