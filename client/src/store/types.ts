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

// Tab state from server (minimal - no messages)
export type TabState = {
  id: string;
  sessionId: string;  // empty string = new session
  isLoading: boolean;
  processId: number | null;
};

// Server state (in-memory, no persistence)
export type ServerState = {
  tabs: TabState[];
  activeTabId: string;
  version: number;
};

// Active process info
export type ActiveProcess = {
  processId: number;
  sessionId: string;
  workDir: string;
  startTime: number;
};

// Local tab state (extends server state with client-side data)
export type LocalTabState = TabState & {
  messages: Message[];        // Loaded from CLI session on-demand
  messagesLoaded: boolean;    // Whether messages have been loaded
  workDir: string;            // From session metadata
};
