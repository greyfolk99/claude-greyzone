# Chat Components

React components for the Claude Web UI chat interface.

## Components

### ChatContainer
Main chat area that displays messages and loading state.

**Props:**
- `messages: Message[]` - Array of chat messages
- `isLoading: boolean` - Whether Claude is currently thinking

**Features:**
- Auto-scroll to bottom on new messages
- Empty state with welcome message
- Loading indicator
- Responsive layout with max-width constraint

### ChatInput
Text input area for sending messages to Claude.

**Props:**
- `onSend: (message: string) => void` - Callback when user sends a message
- `isLoading: boolean` - Whether Claude is currently thinking (disables input)

**Features:**
- Auto-expanding textarea
- Enter to send, Shift+Enter for newline
- Send button with lucide-react arrow icon
- Disabled state while loading
- Character limit visual feedback

### ChatMessage
Renders a single message (user or assistant).

**Props:**
- `message: Message` - Message object from store

**Features:**
- User messages: right-aligned with bg-tertiary
- Assistant messages: left-aligned with bg-secondary
- Markdown rendering with syntax highlighting (marked + highlight.js)
- Renders content blocks: text, thinking, tool_use, tool_result
- Prose styling for markdown content

### ThinkingBlock
Collapsible block showing Claude's thinking process.

**Props:**
- `content: ThinkingContent` - Thinking content block

**Features:**
- Purple theme with brain icon
- Collapsible with chevron indicator
- Shows character count
- Monospace font for thinking text

### ToolBlock
Collapsible block showing tool usage and results.

**Props:**
- `toolUse: ToolUseContent` - Tool use content block
- `toolResult?: ToolResultContent` - Optional tool result (if complete)

**Features:**
- Orange theme with wrench icon
- Status badge: "Running" (orange) or "Complete" (green)
- Shows tool name and input summary
- Collapsible with input JSON and result
- Syntax highlighting for JSON

## Usage Example

```tsx
import { ChatContainer, ChatInput } from '@/components/chat';
import { useChatStore } from '@/store/chatStore';

function ChatPage() {
  const { messages, isLoading, addMessage } = useChatStore();

  const handleSend = (message: string) => {
    addMessage({ type: 'user', content: message });
    // Call API to get assistant response
  };

  return (
    <div className="flex flex-col h-screen">
      <ChatContainer messages={messages} isLoading={isLoading} />
      <ChatInput onSend={handleSend} isLoading={isLoading} />
    </div>
  );
}
```

## Styling

Components use Tailwind CSS with Claude Code theme variables:

### Color Variables
- `--bg-primary`: #1a1a1a (main background)
- `--bg-secondary`: #232323 (assistant messages)
- `--bg-tertiary`: #2d2d2d (user messages)
- `--border-color`: #3d3d3d
- `--text-primary`: #e8e8e8
- `--text-secondary`: #a0a0a0
- `--accent-claude`: #da7756 (primary accent)
- `--accent-green`: #5bb98c (success/complete)
- `--accent-orange`: #e5a84b (tools/warning)
- `--accent-purple`: #a78bfa (thinking)

### Typography
- Uses Geist Sans and Geist Mono fonts
- Markdown prose styling with syntax highlighting
- Monospace for code and technical content

## Dependencies

- `marked` - Markdown parsing
- `highlight.js` - Syntax highlighting
- `lucide-react` - Icons (Brain, Wrench, Send, ChevronRight, ChevronDown, Loader2)
- `@/store/types` - TypeScript types
