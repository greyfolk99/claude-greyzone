import { useState } from 'react';
import {
  Wrench, ChevronRight, ChevronDown,
  FileText, FolderOpen, Terminal, Search,
  CheckSquare, Square, Check, Edit3, X,
  Play, FileCode, List
} from 'lucide-react';
import type { ToolUseContent, ToolResultContent } from '@/store/types';

interface ToolBlockProps {
  toolUse: ToolUseContent;
  toolResult?: ToolResultContent;
  autoExpand?: boolean;
}

// Tool-specific icons
const toolIcons: Record<string, React.ElementType> = {
  Read: FileText,
  Write: Edit3,
  Edit: Edit3,
  Bash: Terminal,
  Glob: FolderOpen,
  Grep: Search,
  TodoWrite: CheckSquare,
  Task: Play,
  WebFetch: Search,
  WebSearch: Search,
};

// Unified orange style for all tools (AI response color)
const toolStyle = {
  border: 'border-accent-orange/30',
  bg: 'bg-accent-orange/5',
  hover: 'hover:bg-accent-orange/10',
  text: 'text-accent-orange',
};

export function ToolBlock({ toolUse, toolResult, autoExpand = true }: ToolBlockProps) {
  const [isExpanded, setIsExpanded] = useState(autoExpand);

  const isRunning = !toolResult;
  const Icon = toolIcons[toolUse.name] || Wrench;
  const style = toolStyle;

  // Render specialized content based on tool type
  const renderToolContent = () => {
    switch (toolUse.name) {
      case 'TodoWrite':
        return <TodoWriteBlock input={toolUse.input} />;
      case 'Read':
        return <ReadBlock input={toolUse.input} result={toolResult} />;
      case 'Write':
      case 'Edit':
        return <WriteEditBlock name={toolUse.name} input={toolUse.input} result={toolResult} />;
      case 'Bash':
        return <BashBlock input={toolUse.input} result={toolResult} />;
      case 'Glob':
      case 'Grep':
        return <SearchBlock name={toolUse.name} input={toolUse.input} result={toolResult} />;
      case 'Task':
        return <TaskBlock input={toolUse.input} result={toolResult} />;
      default:
        return <GenericBlock input={toolUse.input} result={toolResult} />;
    }
  };

  const getSummary = () => {
    switch (toolUse.name) {
      case 'Read':
        return toolUse.input.file_path || '';
      case 'Write':
      case 'Edit':
        return toolUse.input.file_path || '';
      case 'Bash':
        const cmd = toolUse.input.command || '';
        return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
      case 'Glob':
        return toolUse.input.pattern || '';
      case 'Grep':
        return toolUse.input.pattern || '';
      case 'TodoWrite':
        const todos = toolUse.input.todos || [];
        return `${todos.length} tasks`;
      case 'Task':
        return toolUse.input.description || '';
      default:
        const keys = Object.keys(toolUse.input);
        if (keys.length === 0) return '';
        const firstVal = toolUse.input[keys[0]];
        if (typeof firstVal === 'string') {
          return firstVal.length > 50 ? firstVal.slice(0, 50) + '...' : firstVal;
        }
        return '';
    }
  };

  return (
    <div className={`my-2 border ${style.border} ${style.bg} overflow-hidden tool-block-enter`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full px-3 py-2 flex items-center gap-2 ${style.hover} transition-colors text-sm`}
      >
        <div className={style.text}>
          {isExpanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </div>
        <Icon className={`w-3 h-3 ${style.text}`} />
        <span className={`${style.text}`}>[{toolUse.name}]</span>
        <span className="text-xs text-text-secondary truncate flex-1 text-left font-mono">
          {getSummary()}
        </span>
        {isRunning ? (
          <span className="text-xs text-accent-orange animate-pulse">...</span>
        ) : (
          <span className="text-xs text-accent-orange">[OK]</span>
        )}
      </button>

      {isExpanded && (
        <div className={`border-t ${style.border} bg-bg-primary/50 tool-block-content`}>
          {renderToolContent()}
        </div>
      )}
    </div>
  );
}

// TodoWrite specialized block
function TodoWriteBlock({ input }: { input: Record<string, unknown> }) {
  const todos = (input.todos as Array<{ content: string; status: string; activeForm?: string }>) || [];

  return (
    <div className="px-3 py-2">
      <div className="space-y-1">
        {todos.map((todo, i) => (
          <div key={i} className="flex items-start gap-2 py-1 text-sm">
            {todo.status === 'completed' ? (
              <span className="text-accent-orange shrink-0">[x]</span>
            ) : todo.status === 'in_progress' ? (
              <span className="text-accent-orange shrink-0 animate-pulse">[~]</span>
            ) : (
              <span className="text-text-secondary shrink-0">[ ]</span>
            )}
            <span className={
              todo.status === 'completed' ? 'text-text-secondary line-through' :
              todo.status === 'in_progress' ? 'text-accent-orange' : 'text-text-primary'
            }>
              {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Read file block with modal viewer
function ReadBlock({ input, result }: { input: Record<string, unknown>; result?: ToolResultContent }) {
  const [showModal, setShowModal] = useState(false);
  const filePath = (input.file_path as string) || '';
  const fileName = filePath.split('/').pop() || filePath;
  const fileContent = result && typeof result.content === 'string' ? result.content : '';
  const lineCount = fileContent ? fileContent.split('\n').length : 0;

  // Detect file extension for syntax highlighting
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    cpp: 'cpp', c: 'c', h: 'c', hpp: 'cpp', cs: 'csharp',
    json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown',
    html: 'html', css: 'css', scss: 'scss', sql: 'sql',
    sh: 'bash', bash: 'bash', zsh: 'bash',
  };
  const lang = langMap[ext] || 'plaintext';

  return (
    <>
      <div className="px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <FileCode className="w-3 h-3 text-accent-orange" />
          <span className="font-mono text-text-primary">{fileName}</span>
          <span className="text-text-secondary text-xs truncate">{filePath}</span>
        </div>
        {result && (
          <div className="mt-1 text-xs text-text-secondary">
            {lineCount} lines
          </div>
        )}
        {fileContent && (
          <button
            onClick={() => setShowModal(true)}
            className="mt-2 text-xs text-accent-orange hover:underline"
          >
            [view file]
          </button>
        )}
      </div>

      {/* File viewer modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4" onClick={() => setShowModal(false)}>
          <div className="bg-bg-secondary border border-border max-w-4xl w-full max-h-[80vh] overflow-hidden animate-scaleIn" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-tertiary">
              <span className="text-accent-red text-xs">●</span>
              <span className="text-accent-orange text-xs">●</span>
              <span className="text-accent-green text-xs">●</span>
              <span className="text-text-secondary text-xs ml-2">cat — {fileName}</span>
              <span className="text-text-secondary text-xs ml-auto mr-2">{lineCount} lines</span>
              <button onClick={() => setShowModal(false)} className="text-text-secondary hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-2 border-b border-border text-sm">
              <span className="text-accent-orange">$</span> cat {filePath}
            </div>
            <div className="overflow-auto max-h-[calc(80vh-80px)] bg-bg-primary">
              <pre className="font-mono text-xs text-text-primary p-4 whitespace-pre overflow-x-auto"><code className={`language-${lang}`}>{fileContent}</code></pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Compute unified diff between old and new strings
function computeUnifiedDiff(oldStr: string, newStr: string): { type: 'context' | 'removed' | 'added'; line: string }[] {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const result: { type: 'context' | 'removed' | 'added'; line: string }[] = [];

  // Simple line-by-line diff using LCS-like approach
  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (oldIdx >= oldLines.length) {
      // Remaining new lines are additions
      result.push({ type: 'added', line: newLines[newIdx] });
      newIdx++;
    } else if (newIdx >= newLines.length) {
      // Remaining old lines are deletions
      result.push({ type: 'removed', line: oldLines[oldIdx] });
      oldIdx++;
    } else if (oldLines[oldIdx] === newLines[newIdx]) {
      // Context line (matching)
      result.push({ type: 'context', line: oldLines[oldIdx] });
      oldIdx++;
      newIdx++;
    } else {
      // Find if the old line appears later in new (was moved/kept)
      const oldInNew = newLines.slice(newIdx).indexOf(oldLines[oldIdx]);
      // Find if the new line appears later in old (was moved/kept)
      const newInOld = oldLines.slice(oldIdx).indexOf(newLines[newIdx]);

      if (oldInNew === -1 && newInOld === -1) {
        // Both lines are unique - show as removal then addition
        result.push({ type: 'removed', line: oldLines[oldIdx] });
        result.push({ type: 'added', line: newLines[newIdx] });
        oldIdx++;
        newIdx++;
      } else if (oldInNew !== -1 && (newInOld === -1 || oldInNew <= newInOld)) {
        // New lines were added before the old line appears
        result.push({ type: 'added', line: newLines[newIdx] });
        newIdx++;
      } else {
        // Old line was removed
        result.push({ type: 'removed', line: oldLines[oldIdx] });
        oldIdx++;
      }
    }
  }

  return result;
}

// Write/Edit file block
function WriteEditBlock({ name, input, result }: { name: string; input: Record<string, unknown>; result?: ToolResultContent }) {
  const [showModal, setShowModal] = useState(false);
  const filePath = (input.file_path as string) || '';
  const fileName = filePath.split('/').pop() || filePath;
  const isEdit = name === 'Edit';
  const oldString = String(input.old_string || '');
  const newString = String(input.new_string || '');
  const content = String(input.content || '');

  // Compute diff for display
  const diffLines = isEdit ? computeUnifiedDiff(oldString, newString) : [];
  const addedCount = diffLines.filter(d => d.type === 'added').length;
  const removedCount = diffLines.filter(d => d.type === 'removed').length;

  return (
    <>
      <div className="px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <Edit3 className="w-3 h-3 text-accent-orange" />
          <span className="font-mono text-text-primary">{fileName}</span>
          <span className="text-xs text-accent-orange">
            [{isEdit ? 'EDIT' : 'NEW'}]
          </span>
          {isEdit && (
            <span className="text-xs">
              <span className="text-accent-green">+{addedCount}</span>
              {' '}
              <span className="text-accent-red">-{removedCount}</span>
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-text-secondary truncate">{filePath}</div>
        {isEdit && diffLines.length > 0 && (
          <div className="mt-2 font-mono text-xs max-h-32 overflow-y-auto">
            {diffLines.slice(0, 8).map((d, i) => (
              <div
                key={i}
                className={`px-2 whitespace-pre overflow-hidden text-ellipsis ${
                  d.type === 'removed' ? 'text-accent-red bg-accent-red/10' :
                  d.type === 'added' ? 'text-accent-green bg-accent-green/10' :
                  'text-text-secondary'
                }`}
              >
                {d.type === 'removed' ? '-' : d.type === 'added' ? '+' : ' '} {d.line}
              </div>
            ))}
            {diffLines.length > 8 && (
              <div className="text-text-secondary px-2">... {diffLines.length - 8} more lines</div>
            )}
          </div>
        )}
        {!isEdit && content && (
          <div className="mt-1 text-xs text-text-secondary">
            {content.split('\n').length} lines
          </div>
        )}
        <button
          onClick={() => setShowModal(true)}
          className="mt-2 text-xs text-accent-claude hover:underline"
        >
          [view full diff]
        </button>
      </div>

      {/* Terminal-style Diff Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4" onClick={() => setShowModal(false)}>
          <div className="bg-bg-secondary border border-border max-w-4xl w-full max-h-[80vh] overflow-hidden animate-scaleIn" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-tertiary">
              <span className="text-accent-red text-xs">●</span>
              <span className="text-accent-orange text-xs">●</span>
              <span className="text-accent-green text-xs">●</span>
              <span className="text-text-secondary text-xs ml-2">diff — {fileName}</span>
              {isEdit && (
                <span className="text-xs ml-2">
                  <span className="text-accent-green">+{addedCount}</span>
                  {' '}
                  <span className="text-accent-red">-{removedCount}</span>
                </span>
              )}
              <button onClick={() => setShowModal(false)} className="ml-auto text-text-secondary hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-2 border-b border-border text-sm">
              <span className="text-accent-orange">$</span> git diff {filePath}
            </div>
            <div className="overflow-auto max-h-[calc(80vh-80px)] bg-bg-primary">
              {isEdit ? (
                <div className="font-mono text-xs">
                  {/* Diff header */}
                  <div className="px-4 py-1 text-text-secondary border-b border-border">
                    <div>--- a/{fileName}</div>
                    <div>+++ b/{fileName}</div>
                  </div>
                  {/* Diff content */}
                  <div className="divide-y divide-border/30">
                    {diffLines.map((d, i) => (
                      <div
                        key={i}
                        className={`px-4 py-0.5 whitespace-pre overflow-x-auto ${
                          d.type === 'removed' ? 'text-accent-red bg-accent-red/10' :
                          d.type === 'added' ? 'text-accent-green bg-accent-green/10' :
                          'text-text-primary'
                        }`}
                      >
                        <span className="select-none mr-2 text-text-secondary">{
                          d.type === 'removed' ? '-' : d.type === 'added' ? '+' : ' '
                        }</span>
                        {d.line}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <pre className="font-mono text-xs text-text-primary p-4 whitespace-pre">
                    {content}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Bash command block with expandable output
function BashBlock({ input, result }: { input: Record<string, unknown>; result?: ToolResultContent }) {
  const [showModal, setShowModal] = useState(false);
  const command = (input.command as string) || '';
  const description = (input.description as string) || '';
  const output = result && typeof result.content === 'string' ? result.content : '';
  const hasLongOutput = output.length > 500 || output.split('\n').length > 10;

  return (
    <>
      <div className="px-3 py-2 text-sm">
        {description && (
          <div className="text-xs text-text-secondary mb-1">{description}</div>
        )}
        <div className="font-mono bg-bg-tertiary px-2 py-1.5 text-accent-orange overflow-x-auto whitespace-pre">
          <span className="text-accent-orange">$</span> {command}
        </div>
        {output.trim() && (
          <div className="mt-2 font-mono text-xs text-text-secondary bg-bg-tertiary px-2 py-1.5 max-h-32 overflow-y-auto whitespace-pre overflow-x-auto">
            {hasLongOutput ? output.slice(0, 500) + '...' : output}
          </div>
        )}
        {hasLongOutput && (
          <button
            onClick={() => setShowModal(true)}
            className="mt-2 text-xs text-accent-orange hover:underline"
          >
            [view full output]
          </button>
        )}
      </div>

      {/* Output modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4" onClick={() => setShowModal(false)}>
          <div className="bg-bg-secondary border border-border max-w-4xl w-full max-h-[80vh] overflow-hidden animate-scaleIn" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-tertiary">
              <span className="text-accent-red text-xs">●</span>
              <span className="text-accent-orange text-xs">●</span>
              <span className="text-accent-green text-xs">●</span>
              <span className="text-text-secondary text-xs ml-2">bash output</span>
              <button onClick={() => setShowModal(false)} className="ml-auto text-text-secondary hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-2 border-b border-border text-sm font-mono text-accent-orange">
              <span className="text-accent-orange">$</span> {command}
            </div>
            <div className="overflow-auto max-h-[calc(80vh-80px)] bg-bg-primary">
              <pre className="font-mono text-xs text-text-primary p-4 whitespace-pre">{output}</pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Search (Glob/Grep) block with expandable results
function SearchBlock({ name, input, result }: { name: string; input: Record<string, unknown>; result?: ToolResultContent }) {
  const [showModal, setShowModal] = useState(false);
  const pattern = (input.pattern as string) || '';
  const path = (input.path as string) || '.';
  const output = result && typeof result.content === 'string' ? result.content : '';
  const matches = output.split('\n').filter(l => l.trim());
  const matchCount = matches.length;

  return (
    <>
      <div className="px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <Search className="w-3 h-3 text-accent-orange" />
          <span className="font-mono text-accent-orange">{pattern}</span>
          <span className="text-text-secondary text-xs">in {path}</span>
        </div>
        {result && (
          <div className="mt-1 text-xs text-text-secondary">
            {matchCount} {matchCount === 1 ? 'match' : 'matches'}
          </div>
        )}
        {matchCount > 0 && (
          <>
            <div className="mt-2 text-xs text-text-secondary max-h-24 overflow-y-auto font-mono">
              {matches.slice(0, 5).map((m, i) => (
                <div key={i} className="truncate text-text-primary">{m}</div>
              ))}
              {matchCount > 5 && <div className="text-text-secondary">...and {matchCount - 5} more</div>}
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="mt-2 text-xs text-accent-orange hover:underline"
            >
              [view all matches]
            </button>
          </>
        )}
      </div>

      {/* Results modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4" onClick={() => setShowModal(false)}>
          <div className="bg-bg-secondary border border-border max-w-4xl w-full max-h-[80vh] overflow-hidden animate-scaleIn" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-tertiary">
              <span className="text-accent-red text-xs">●</span>
              <span className="text-accent-orange text-xs">●</span>
              <span className="text-accent-green text-xs">●</span>
              <span className="text-text-secondary text-xs ml-2">{name.toLowerCase()} results</span>
              <span className="text-text-secondary text-xs ml-auto mr-2">{matchCount} matches</span>
              <button onClick={() => setShowModal(false)} className="text-text-secondary hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-2 border-b border-border text-sm">
              <span className="text-accent-orange">$</span> {name.toLowerCase()} <span className="text-accent-orange">{pattern}</span> {path}
            </div>
            <div className="overflow-auto max-h-[calc(80vh-80px)] bg-bg-primary">
              <div className="p-4 font-mono text-xs">
                {matches.map((m, i) => (
                  <div key={i} className="py-0.5 text-text-primary hover:bg-bg-tertiary whitespace-pre overflow-x-auto">
                    {m}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Task (subagent) block with expandable result
function TaskBlock({ input, result }: { input: Record<string, unknown>; result?: ToolResultContent }) {
  const [showModal, setShowModal] = useState(false);
  const description = (input.description as string) || '';
  const agentType = (input.subagent_type as string) || '';
  const prompt = (input.prompt as string) || '';
  const output = result && typeof result.content === 'string' ? result.content : '';
  const hasLongOutput = output.length > 300;

  return (
    <>
      <div className="px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <Play className="w-3 h-3 text-accent-orange" />
          <span className="text-text-primary">{description}</span>
        </div>
        {agentType && (
          <div className="mt-1">
            <span className="text-xs text-accent-orange">[{agentType}]</span>
          </div>
        )}
        {output && (
          <div className="mt-2 text-xs text-text-secondary max-h-24 overflow-y-auto whitespace-pre-wrap">
            {hasLongOutput ? output.slice(0, 300) + '...' : output}
          </div>
        )}
        {(hasLongOutput || prompt) && (
          <button
            onClick={() => setShowModal(true)}
            className="mt-2 text-xs text-accent-orange hover:underline"
          >
            [view details]
          </button>
        )}
      </div>

      {/* Task details modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4" onClick={() => setShowModal(false)}>
          <div className="bg-bg-secondary border border-border max-w-4xl w-full max-h-[80vh] overflow-hidden animate-scaleIn" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-tertiary">
              <span className="text-accent-red text-xs">●</span>
              <span className="text-accent-orange text-xs">●</span>
              <span className="text-accent-green text-xs">●</span>
              <span className="text-text-secondary text-xs ml-2">subagent — {agentType}</span>
              <button onClick={() => setShowModal(false)} className="ml-auto text-text-secondary hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-2 border-b border-border">
              <div className="text-sm text-accent-orange">{description}</div>
            </div>
            <div className="overflow-auto max-h-[calc(80vh-100px)] bg-bg-primary p-4">
              {prompt && (
                <div className="mb-4">
                  <div className="text-xs text-text-secondary mb-1">PROMPT:</div>
                  <div className="text-sm text-text-primary bg-bg-tertiary border border-border p-3 whitespace-pre-wrap">
                    {prompt}
                  </div>
                </div>
              )}
              {output && (
                <div>
                  <div className="text-xs text-text-secondary mb-1">RESULT:</div>
                  <div className="text-sm text-text-primary bg-bg-tertiary border border-border p-3 whitespace-pre-wrap">
                    {output}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Generic fallback block with modal
function GenericBlock({ input, result }: { input: Record<string, unknown>; result?: ToolResultContent }) {
  const [showModal, setShowModal] = useState(false);
  const inputStr = JSON.stringify(input, null, 2);
  const outputStr = result
    ? (typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2))
    : '';
  const hasLongContent = inputStr.length > 300 || outputStr.length > 500;

  return (
    <>
      <div className="px-3 py-2 text-sm">
        <div className="text-xs text-text-secondary mb-1">INPUT:</div>
        <pre className="text-xs text-text-primary whitespace-pre font-mono overflow-x-auto bg-bg-tertiary px-2 py-1 max-h-24 overflow-y-auto">
          {inputStr.length > 300 ? inputStr.slice(0, 300) + '...' : inputStr}
        </pre>
        {result && (
          <>
            <div className="text-xs text-text-secondary mt-2 mb-1">OUTPUT:</div>
            <pre className="text-xs text-text-primary whitespace-pre font-mono overflow-x-auto bg-bg-tertiary px-2 py-1 max-h-24 overflow-y-auto">
              {outputStr.length > 500 ? outputStr.slice(0, 500) + '...' : outputStr}
            </pre>
          </>
        )}
        {hasLongContent && (
          <button
            onClick={() => setShowModal(true)}
            className="mt-2 text-xs text-accent-orange hover:underline"
          >
            [view details]
          </button>
        )}
      </div>

      {/* Details modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4" onClick={() => setShowModal(false)}>
          <div className="bg-bg-secondary border border-border max-w-4xl w-full max-h-[80vh] overflow-hidden animate-scaleIn" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-tertiary">
              <span className="text-accent-red text-xs">●</span>
              <span className="text-accent-orange text-xs">●</span>
              <span className="text-accent-green text-xs">●</span>
              <span className="text-text-secondary text-xs ml-2">tool details</span>
              <button onClick={() => setShowModal(false)} className="ml-auto text-text-secondary hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-auto max-h-[calc(80vh-50px)] bg-bg-primary p-4">
              <div className="mb-4">
                <div className="text-xs text-text-secondary mb-1">INPUT:</div>
                <pre className="text-sm text-text-primary bg-bg-tertiary border border-border p-3 whitespace-pre overflow-x-auto">
                  {inputStr}
                </pre>
              </div>
              {outputStr && (
                <div>
                  <div className="text-xs text-text-secondary mb-1">OUTPUT:</div>
                  <pre className="text-sm text-text-primary bg-bg-tertiary border border-border p-3 whitespace-pre overflow-x-auto">
                    {outputStr}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
