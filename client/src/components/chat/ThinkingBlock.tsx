import { useState } from 'react';
import { Brain, ChevronRight, ChevronDown } from 'lucide-react';
import type { ThinkingContent } from '@/store/types';

interface ThinkingBlockProps {
  content: ThinkingContent;
}

export function ThinkingBlock({ content }: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const charCount = content.thinking.length;

  return (
    <div className="my-2 border border-accent-purple/30 bg-accent-purple/5 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-accent-purple/10 transition-colors text-sm"
      >
        <div className="text-accent-purple">
          {isExpanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </div>
        <Brain className="w-3 h-3 text-accent-purple" />
        <span className="text-accent-purple">[thinking]</span>
        <span className="ml-auto text-xs text-text-secondary">
          {charCount.toLocaleString()} chars
        </span>
      </button>

      {isExpanded && (
        <div className="px-3 py-2 border-t border-accent-purple/30 bg-bg-primary/50">
          <pre className="text-sm text-text-primary whitespace-pre-wrap font-mono">
            {content.thinking}
          </pre>
        </div>
      )}
    </div>
  );
}
