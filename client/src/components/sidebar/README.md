# Sidebar Components

Retro-futuristic terminal-inspired sidebar components for Claude Code UI.

## Components

### FileExplorer
Slide-in file browser panel with terminal aesthetics.

```tsx
import { FileExplorer } from '@/components/sidebar';

function MyComponent() {
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState({ path: '', name: '' });

  const handleFileSelect = (path: string, name: string) => {
    setSelectedFile({ path, name });
    setViewerOpen(true);
  };

  return (
    <>
      <button onClick={() => setExplorerOpen(true)}>Open Files</button>

      <FileExplorer
        isOpen={explorerOpen}
        onClose={() => setExplorerOpen(false)}
        onFileSelect={handleFileSelect}
        initialPath="/home/user/projects"
      />
    </>
  );
}
```

### FileViewer
Full-screen file viewer with syntax highlighting via highlight.js.

```tsx
import { FileViewer } from '@/components/sidebar';

function MyComponent() {
  const [viewerOpen, setViewerOpen] = useState(false);

  return (
    <FileViewer
      isOpen={viewerOpen}
      onClose={() => setViewerOpen(false)}
      filePath="/path/to/file.tsx"
      fileName="file.tsx"
    />
  );
}
```

### SessionList
Modal for selecting and loading previous chat sessions.

```tsx
import { SessionList } from '@/components/sidebar';

function MyComponent() {
  const [sessionListOpen, setSessionListOpen] = useState(false);

  const handleSessionSelect = (sessionId: string, project: string) => {
    console.log('Loading session:', sessionId, 'from project:', project);
    // Load session logic here
  };

  return (
    <SessionList
      isOpen={sessionListOpen}
      onClose={() => setSessionListOpen(false)}
      onSessionSelect={handleSessionSelect}
      currentWorkDir="/home/user/projects/my-app"
    />
  );
}
```

### DirectoryPicker
Modal for navigating and selecting a directory.

```tsx
import { DirectoryPicker } from '@/components/sidebar';

function MyComponent() {
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleSelectDirectory = (path: string) => {
    console.log('Selected directory:', path);
    // Update working directory logic here
  };

  return (
    <DirectoryPicker
      isOpen={pickerOpen}
      onClose={() => setPickerOpen(false)}
      onSelectDirectory={handleSelectDirectory}
      initialPath="/home/user"
    />
  );
}
```

## Design Philosophy

These components follow a **retro-futuristic terminal aesthetic**:

- **Typography**: Monospace fonts for that terminal feel
- **Colors**: Dark backgrounds with neon accent colors (green, orange, purple, red)
- **Borders**: Sharp, 2px borders with primary accent color
- **Animations**: Smooth slides, fades, and scales with cubic-bezier easing
- **Details**: Pulse animations, glowing shadows, status indicators
- **Layout**: Fixed positioning with overlays, geometric precision

## API Endpoints Used

- `POST /api/files` - List files and directories
- `POST /api/file/read` - Read file content with language detection
- `GET /api/sessions` - Get session history
- `POST /api/directories` - List directories only

## Dependencies

- React 19
- lucide-react (icons)
- highlight.js (syntax highlighting)
- Tailwind CSS 4
- Claude Code theme variables
