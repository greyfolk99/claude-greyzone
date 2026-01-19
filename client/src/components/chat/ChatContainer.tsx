import { useEffect, useRef, useLayoutEffect, useImperativeHandle, forwardRef, useState } from 'react';
import type { Message } from '@/store/types';
import { ChatMessage } from './ChatMessage';

// Helper to escape HTML
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Settings key
const AUTO_EXPAND_TOOLS_KEY = 'claude-web-ui-auto-expand-tools';

interface ChatContainerProps {
  messages: Message[];
  isLoading: boolean;
}

export interface ChatContainerHandle {
  addPendingMessage: (text: string) => void;
  clearPendingMessages: () => void;
}

export const ChatContainer = forwardRef<ChatContainerHandle, ChatContainerProps>(function ChatContainer({ messages, isLoading }, ref) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingContainerRef = useRef<HTMLDivElement>(null);
  const shouldScrollRef = useRef(true);

  // Auto-expand tools setting (default true)
  const [autoExpandTools] = useState(() => {
    try {
      const saved = localStorage.getItem(AUTO_EXPAND_TOOLS_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  // Imperative handle for direct DOM manipulation (bypasses React state)
  useImperativeHandle(ref, () => ({
    addPendingMessage: (text: string) => {
      if (!pendingContainerRef.current) return;
      const div = document.createElement('div');
      div.className = 'mb-4 pending-message';
      div.innerHTML = `
        <div class="flex items-start gap-2">
          <span class="text-accent-green text-sm shrink-0 mt-0.5">$</span>
          <div class="prose prose-invert max-w-none text-sm text-text-primary whitespace-pre-wrap break-words">
            <span class="text-text-secondary">⏳ </span>${escapeHtml(text)}
          </div>
        </div>
      `;
      pendingContainerRef.current.appendChild(div);
      // Scroll to bottom
      if (containerRef.current && shouldScrollRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    },
    clearPendingMessages: () => {
      if (!pendingContainerRef.current) return;
      pendingContainerRef.current.innerHTML = '';
    },
  }), []);

  // Track if user is near bottom (auto-scroll only if they are)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Consider "near bottom" if within 100px of the bottom
      shouldScrollRef.current = scrollHeight - scrollTop - clientHeight < 100;
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll to bottom when new messages arrive (only if near bottom)
  useLayoutEffect(() => {
    if (shouldScrollRef.current && containerRef.current) {
      // Use scrollTop instead of scrollIntoView for more reliable behavior
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Handle viewport resize (mobile keyboard) - maintain scroll position
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const handleResize = () => {
      // When keyboard opens/closes, keep the scroll at the bottom if we were there
      if (shouldScrollRef.current && containerRef.current) {
        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
          }
        });
      }
    };

    viewport.addEventListener('resize', handleResize);
    return () => viewport.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-bg-primary px-4 py-4"
    >
      <div className="max-w-4xl mx-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
            {isLoading ? (
              <div className="text-text-secondary text-sm space-y-2">
                <div><span className="text-accent-orange animate-pulse">$</span> loading session...</div>
                <div className="mt-4 text-xs text-text-secondary animate-pulse">
                  Fetching conversation history
                </div>
              </div>
            ) : (
              <div className="text-text-secondary text-sm space-y-2">
                <div><span className="text-accent-green">$</span> claude --help</div>
                <div className="text-text-primary mt-4">
                  <span className="text-accent-claude font-bold">CLAUDE CODE</span> - AI-powered coding assistant
                </div>
                <div className="mt-4 text-xs text-text-secondary">
                  Type a message to start a conversation.
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {messages.map((message, index) => {
              // Check if this is the last assistant message and we're streaming
              const isLastMessage = index === messages.length - 1;
              const isStreamingMessage = isLoading && isLastMessage && message.type === 'assistant';
              return (
                <ChatMessage
                  key={index}
                  message={message}
                  autoExpandTools={autoExpandTools}
                  isStreaming={isStreamingMessage}
                />
              );
            })}

            {isLoading && (
              <div className="mb-4">
                <div className="flex items-start gap-2">
                  <span className="text-accent-orange text-sm shrink-0 mt-0.5 animate-pulse">{'>'}</span>
                  <div className="text-sm text-text-secondary">
                    processing<span className="animate-pulse">...</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
});
