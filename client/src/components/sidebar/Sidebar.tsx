import { useState, useRef, useCallback, useEffect } from 'react';
import { History, FolderOpen, Settings, Puzzle, Server, ChevronLeft, ChevronRight } from 'lucide-react';

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  activePanel: 'sessions' | 'files' | 'config' | 'plugins' | 'mcp' | null;
  onPanelChange: (panel: 'sessions' | 'files' | 'config' | 'plugins' | 'mcp' | null) => void;
  children?: React.ReactNode;
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 500;
const COLLAPSED_WIDTH = 48;

export function Sidebar({
  isCollapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  activePanel,
  onPanelChange,
  children,
}: SidebarProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = e.clientX;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        onWidthChange(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, onWidthChange]);

  const iconButtons = [
    { id: 'sessions' as const, icon: History, label: 'Sessions' },
    { id: 'files' as const, icon: FolderOpen, label: 'Files' },
    { id: 'config' as const, icon: Settings, label: 'Config' },
    { id: 'plugins' as const, icon: Puzzle, label: 'Plugins' },
    { id: 'mcp' as const, icon: Server, label: 'MCP' },
  ];

  return (
    <div
      ref={sidebarRef}
      className="hidden md:flex flex-shrink-0 h-full bg-bg-secondary border-r border-border relative"
      style={{ width: isCollapsed ? COLLAPSED_WIDTH : width }}
    >
      {/* Icon bar - always visible */}
      <div className="w-12 flex flex-col border-r border-border bg-bg-tertiary">
        {iconButtons.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => {
              if (isCollapsed) {
                onToggleCollapse();
                onPanelChange(id);
              } else if (activePanel === id) {
                onToggleCollapse();
              } else {
                onPanelChange(id);
              }
            }}
            className={`w-12 h-12 flex items-center justify-center transition-colors ${
              activePanel === id && !isCollapsed
                ? 'text-accent-claude border-l-2 border-l-accent-claude bg-bg-secondary'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary'
            }`}
            title={label}
          >
            <Icon className="w-5 h-5" />
          </button>
        ))}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Collapse toggle */}
        <button
          onClick={onToggleCollapse}
          className="w-12 h-12 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-colors"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>

      {/* Panel content */}
      {!isCollapsed && (
        <div className="flex-1 overflow-hidden flex flex-col">
          {children}
        </div>
      )}

      {/* Resize handle */}
      {!isCollapsed && (
        <div
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent-claude/50 transition-colors"
          onMouseDown={handleMouseDown}
          style={{ backgroundColor: isResizing ? 'var(--accent-claude)' : undefined }}
        />
      )}
    </div>
  );
}

export default Sidebar;
