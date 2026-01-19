import { useEffect, useRef, memo } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import './chat-styles.css';
import type { Message, ToolUseContent, ToolResultContent } from '@/store/types';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolBlock } from './ToolBlock';

interface ChatMessageProps {
  message: Message;
  autoExpandTools?: boolean;
  isStreaming?: boolean;
}

// Configure marked with markedHighlight for syntax highlighting
import { markedHighlight } from 'marked-highlight';

marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value;
        } catch (err) {
          console.error('Highlight error:', err);
        }
      }
      return hljs.highlightAuto(code).value;
    },
  })
);

marked.setOptions({
  breaks: true,
  gfm: true,
});

export const ChatMessage = memo(function ChatMessage({ message, autoExpandTools = true, isStreaming = false }: ChatMessageProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      // Apply syntax highlighting to any code blocks that weren't caught by marked
      contentRef.current.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block as HTMLElement);
      });

      // Add terminal header with colored dots to code blocks
      contentRef.current.querySelectorAll('pre').forEach((pre) => {
        // Skip if header already exists
        if (pre.querySelector('.code-header')) return;

        const header = document.createElement('div');
        header.className = 'code-header';
        header.innerHTML = '<span class="dot-red">●</span><span class="dot-yellow">●</span><span class="dot-green">●</span>';
        pre.insertBefore(header, pre.firstChild);
      });
    }
  }, [message]);

  if (message.type === 'user') {
    // Handle content that could be string or array
    let textContent = '';
    if (typeof message.content === 'string') {
      textContent = message.content;
    } else if (Array.isArray(message.content)) {
      // Extract text from content array
      textContent = message.content
        .filter((block): block is { type: 'text'; text: string } =>
          block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string'
        )
        .map(block => block.text)
        .join('\n');
    }

    return (
      <div className="mb-4">
        <div className="flex gap-2">
          <span className="text-accent-green text-sm shrink-0 leading-normal">$</span>
          <div className="flex-1 min-w-0 text-sm text-text-primary whitespace-pre-wrap border-l-2 border-accent-green/30 pl-3 leading-normal">
            {textContent}
          </div>
        </div>
      </div>
    );
  }

  // Assistant message
  const toolUses = new Map<string, ToolUseContent>();
  const toolResults = new Map<string, ToolResultContent>();

  // First pass: collect all tool uses and results
  message.content.forEach((block) => {
    if (block.type === 'tool_use') {
      toolUses.set(block.id, block);
    } else if (block.type === 'tool_result') {
      toolResults.set(block.tool_use_id, block);
    }
  });

  // Find the index of the last text block for cursor positioning
  const lastTextBlockIndex = message.content.reduce((lastIdx, block, idx) => {
    return block.type === 'text' ? idx : lastIdx;
  }, -1);

  return (
    <div className="mb-4">
      <div className="flex gap-2">
        <span className="text-accent-orange text-sm shrink-0 leading-normal">{'>'}</span>
        <div className="flex-1 min-w-0 border-l-2 border-accent-orange/30 pl-3">
          {message.content.map((block, index) => {
            if (block.type === 'text') {
              const isLastTextBlock = index === lastTextBlockIndex;
              const showCursor = isStreaming && isLastTextBlock;
              return (
                <div
                  key={index}
                  ref={contentRef}
                  className={`prose prose-invert max-w-none text-text-primary text-sm ${showCursor ? 'streaming-text' : ''}`}
                  dangerouslySetInnerHTML={{ __html: marked(block.text) }}
                />
              );
            }

            if (block.type === 'thinking') {
              return <ThinkingBlock key={index} content={block} />;
            }

            if (block.type === 'tool_use') {
              const toolResult = toolResults.get(block.id);
              return (
                <ToolBlock
                  key={index}
                  toolUse={block}
                  toolResult={toolResult}
                  autoExpand={autoExpandTools}
                />
              );
            }

            // Skip tool_result rendering since they're handled with tool_use
            if (block.type === 'tool_result') {
              return null;
            }

            return null;
          })}
        </div>
      </div>
    </div>
  );
});
