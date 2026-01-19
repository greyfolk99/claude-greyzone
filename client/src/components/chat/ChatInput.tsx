import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { Send, Square, Mic, MicOff, Radio, Terminal as TerminalIcon, Menu, FileText, Puzzle, Server, Image as ImageIcon, X, History, Compass } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  onInterrupt: () => void;
  isLoading: boolean;
  workDir?: string;
  queueCount?: number;
  queuedMessages?: string[];
  planMode?: boolean;
  onOpenConfig?: () => void;
  onOpenPlugins?: () => void;
  onOpenMCP?: () => void;
  onOpenTerminal?: () => void;
  onOpenHistory?: () => void;
  onTogglePlanMode?: () => void;
  onClearQueue?: () => void;
}

interface SlashCommand {
  name: string;
  description: string;
  argumentHint: string;
  source: 'global' | 'project' | 'plugin';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionType = any;

// Wake words and commands
const WAKE_WORDS = ['클로드', 'claude', '클라우드'];
const SEND_COMMANDS = ['전송', '보내', '엔터', '보내줘', 'send'];
const CANCEL_COMMANDS = ['취소', '취소해', 'cancel'];

export function ChatInput({
  onSend, onInterrupt, isLoading, workDir,
  queueCount = 0, queuedMessages = [], planMode = false,
  onOpenConfig, onOpenPlugins, onOpenMCP, onOpenTerminal,
  onOpenHistory, onTogglePlanMode, onClearQueue
}: ChatInputProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [message, setMessage] = useState('');
  const [alwaysListenMode, setAlwaysListenMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [slashPrefix, setSlashPrefix] = useState('');
  const [attachedImages, setAttachedImages] = useState<{path: string, name: string, preview: string}[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionType>(null);
  const pendingMessageRef = useRef('');
  const autocompleteRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Check speech recognition support
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSpeechSupported(!!SR);
  }, []);

  // Fetch available slash commands
  useEffect(() => {
    const fetchCommands = async () => {
      try {
        const url = workDir
          ? `/api/commands?work_dir=${encodeURIComponent(workDir)}`
          : '/api/commands';
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          setCommands(data.commands || []);
        }
      } catch (error) {
        console.error('Failed to fetch commands:', error);
      }
    };
    fetchCommands();
  }, [workDir]);

  // Filter commands based on input
  const filteredCommands = useCallback(() => {
    if (!slashPrefix) return commands;
    const search = slashPrefix.toLowerCase();
    return commands.filter(cmd =>
      cmd.name.toLowerCase().includes(search) ||
      cmd.description.toLowerCase().includes(search)
    );
  }, [commands, slashPrefix]);

  // Handle message change and detect slash commands
  const handleMessageChange = useCallback((value: string) => {
    setMessage(value);

    // Check if typing a slash command at the start
    if (value.startsWith('/')) {
      const match = value.match(/^\/(\S*)$/);
      if (match) {
        setSlashPrefix(match[1]);
        setShowAutocomplete(true);
        setSelectedIndex(0);
      } else {
        setShowAutocomplete(false);
      }
    } else {
      setShowAutocomplete(false);
      setSlashPrefix('');
    }
  }, []);

  // Select a command from autocomplete
  const selectCommand = useCallback((cmd: SlashCommand) => {
    const newMessage = `/${cmd.name} `;
    setMessage(newMessage);
    setShowAutocomplete(false);
    textareaRef.current?.focus();
  }, []);

  // Auto-scroll to selected item in autocomplete
  useEffect(() => {
    if (showAutocomplete && selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, showAutocomplete]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showSettings && menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowSettings(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSettings]);

  // Handle image upload
  const handleImageUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    for (const file of imageFiles) {
      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          const data = await response.json();
          const preview = URL.createObjectURL(file);
          setAttachedImages(prev => [...prev, {
            path: data.filePath,
            name: file.name,
            preview
          }]);
        }
      } catch (error) {
        console.error('Failed to upload image:', error);
      }
    }
  }, []);

  // Handle paste event for images
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        const dt = new DataTransfer();
        imageFiles.forEach(f => dt.items.add(f));
        handleImageUpload(dt.files);
      }
    };

    const textarea = textareaRef.current;
    if (textarea) {
      textarea.addEventListener('paste', handlePaste as EventListener);
      return () => textarea.removeEventListener('paste', handlePaste as EventListener);
    }
  }, [handleImageUpload]);

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleImageUpload(e.dataTransfer.files);
  }, [handleImageUpload]);

  // Remove image
  const removeImage = useCallback((index: number) => {
    setAttachedImages(prev => {
      const newImages = [...prev];
      URL.revokeObjectURL(newImages[index].preview);
      newImages.splice(index, 1);
      return newImages;
    });
  }, []);

  // Handle sending message
  const handleSend = useCallback(() => {
    const msg = message.trim();
    let finalMessage = '';

    // Add image paths to message
    if (attachedImages.length > 0) {
      const imagePaths = attachedImages.map(img => `[Image: ${img.path}]`).join('\n');
      finalMessage = msg ? `${imagePaths}\n${msg}` : imagePaths;
      // Clean up image previews
      attachedImages.forEach(img => URL.revokeObjectURL(img.preview));
      setAttachedImages([]);
    } else {
      finalMessage = msg;
    }

    if (finalMessage) {
      onSend(finalMessage);
      setMessage('');
      pendingMessageRef.current = '';
    }
  }, [message, attachedImages, onSend]);

  // Process transcript for commands
  const processTranscript = useCallback((transcript: string, isFinal: boolean) => {
    const lowerTranscript = transcript.toLowerCase().trim();

    // Check for wake word
    const hasWakeWord = WAKE_WORDS.some(word => lowerTranscript.includes(word));
    if (hasWakeWord && isFinal) {
      // Toggle recording mode
      setIsRecording(prev => !prev);
      // Remove wake word from transcript
      let cleanTranscript = transcript;
      WAKE_WORDS.forEach(word => {
        cleanTranscript = cleanTranscript.replace(new RegExp(word, 'gi'), '').trim();
      });
      if (cleanTranscript) {
        pendingMessageRef.current = cleanTranscript;
        setMessage(cleanTranscript);
      }
      return;
    }

    // Only process commands and text when recording
    if (!isRecording) return;

    // Check for send command
    const hasSendCommand = SEND_COMMANDS.some(cmd => lowerTranscript.includes(cmd));
    if (hasSendCommand && isFinal) {
      // Remove send command and send
      let cleanMessage = pendingMessageRef.current;
      SEND_COMMANDS.forEach(cmd => {
        cleanMessage = cleanMessage.replace(new RegExp(cmd, 'gi'), '').trim();
      });
      if (cleanMessage) {
        setMessage(cleanMessage);
        setTimeout(() => {
          onSend(cleanMessage);
          setMessage('');
          pendingMessageRef.current = '';
          setIsRecording(false);
        }, 100);
      }
      return;
    }

    // Check for cancel command
    const hasCancelCommand = CANCEL_COMMANDS.some(cmd => lowerTranscript.includes(cmd));
    if (hasCancelCommand && isFinal) {
      setMessage('');
      pendingMessageRef.current = '';
      setIsRecording(false);
      return;
    }

    // Regular transcription
    if (isFinal) {
      pendingMessageRef.current = (pendingMessageRef.current + ' ' + transcript).trim();
      setMessage(pendingMessageRef.current);
    } else {
      setMessage(pendingMessageRef.current + ' ' + transcript);
    }
  }, [isRecording, onSend]);

  // Start always-listen mode
  const startAlwaysListen = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'ko-KR';

    recognition.onresult = (event: SpeechRecognitionType) => {
      const lastResult = event.results[event.results.length - 1];
      const transcript = lastResult[0].transcript;
      const isFinal = lastResult.isFinal;
      processTranscript(transcript, isFinal);
    };

    recognition.onerror = (event: SpeechRecognitionType) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        setAlwaysListenMode(false);
      }
    };

    recognition.onend = () => {
      // Restart if still in always-listen mode
      if (alwaysListenMode && recognitionRef.current) {
        try {
          recognition.start();
        } catch (e) {
          console.error('Failed to restart recognition:', e);
        }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setAlwaysListenMode(true);
  }, [alwaysListenMode, processTranscript]);

  // Stop always-listen mode
  const stopAlwaysListen = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setAlwaysListenMode(false);
    setIsRecording(false);
  }, []);

  // Toggle always-listen mode
  const toggleAlwaysListen = useCallback(() => {
    if (alwaysListenMode) {
      stopAlwaysListen();
    } else {
      startAlwaysListen();
    }
  }, [alwaysListenMode, startAlwaysListen, stopAlwaysListen]);

  // Auto-resize textarea disabled for consistent height
  // useEffect(() => {
  //   if (textareaRef.current) {
  //     textareaRef.current.style.height = '34px';
  //     if (textareaRef.current.scrollHeight > 34) {
  //       textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
  //     }
  //   }
  // }, [message]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const filtered = filteredCommands();

    // Handle autocomplete navigation
    if (showAutocomplete && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % filtered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectCommand(filtered[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowAutocomplete(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape' && isLoading) {
      onInterrupt();
    }
  };

  return (
    <div className="shrink-0 border-t border-border bg-bg-secondary p-3">
      <div className="max-w-4xl mx-auto">
        {/* Queued messages preview */}
        {queuedMessages.length > 0 && (
          <div className="mb-2 border border-accent-orange/30 bg-accent-orange/5">
            <div className="flex items-center justify-between px-2 py-1 border-b border-accent-orange/30 text-xs">
              <span className="text-accent-orange">[QUEUE: {queuedMessages.length}]</span>
              <button
                onClick={onClearQueue}
                className="text-accent-red hover:underline"
              >
                clear
              </button>
            </div>
            <div className="max-h-24 overflow-y-auto">
              {queuedMessages.map((msg, i) => (
                <div key={i} className="px-2 py-1 text-xs text-text-secondary border-b border-accent-orange/10 last:border-0 truncate">
                  <span className="text-text-secondary mr-1">[{i + 1}]</span>
                  <span className="text-text-primary">{msg.length > 80 ? msg.slice(0, 80) + '...' : msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Image previews */}
        {attachedImages.length > 0 && (
          <div className="mb-2 flex gap-2 flex-wrap">
            {attachedImages.map((img, index) => (
              <div key={index} className="relative group">
                <img
                  src={img.preview}
                  alt={img.name}
                  className="h-16 w-16 object-cover border border-border"
                />
                <button
                  onClick={() => removeImage(index)}
                  className="absolute -top-1 -right-1 bg-accent-red text-bg-primary border border-accent-red opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ width: '18px', height: '18px', padding: '0' }}
                  aria-label="Remove image"
                >
                  <X className="w-3 h-3" />
                </button>
                <div className="absolute bottom-0 left-0 right-0 bg-bg-primary/80 text-text-secondary text-xs truncate px-1">
                  {img.name}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-center">
          {/* Prompt prefix */}
          <div className="flex items-center text-accent-green text-sm shrink-0" style={{ height: '34px' }}>
            $
          </div>
          <div
            className="flex-1 relative flex items-center"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => handleMessageChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => setTimeout(() => setShowAutocomplete(false), 200)}
              placeholder={
                isRecording
                  ? 'listening...'
                  : 'Enter command or message... (/ for commands)'
              }
              className={`w-full bg-bg-primary border text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent-green resize-none appearance-none text-sm ${
                isRecording ? 'border-accent-red' : isDragging ? 'border-accent-green' : 'border-border'
              }`}
              style={{ height: '34px', padding: '7px 12px', boxSizing: 'border-box' }}
              rows={1}
            />

          {/* Slash Command Autocomplete Dropdown */}
          {showAutocomplete && filteredCommands().length > 0 && (
            <div
              ref={autocompleteRef}
              className="absolute bottom-full left-0 right-0 mb-1 bg-bg-secondary border border-border max-h-48 overflow-y-auto z-50"
            >
              {filteredCommands().map((cmd, index) => (
                <button
                  key={cmd.name}
                  ref={index === selectedIndex ? selectedItemRef : null}
                  onClick={() => selectCommand(cmd)}
                  className={`w-full px-3 py-2 text-left flex items-center gap-3 transition-colors text-sm ${
                    index === selectedIndex
                      ? 'bg-accent-claude/20 text-accent-claude'
                      : 'hover:bg-bg-tertiary'
                  }`}
                >
                  <span className="text-accent-green">$</span>
                  <span className="text-text-primary">/{cmd.name}</span>
                  {cmd.description && (
                    <span className="text-text-secondary truncate flex-1 text-xs">
                      {cmd.description}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Buttons container */}
        <div className="flex gap-1 relative">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleImageUpload(e.target.files)}
            className="hidden"
          />

          {/* Menu button */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="transition-colors flex items-center justify-center shrink-0 border border-border hover:border-accent-claude text-text-secondary hover:text-accent-claude"
              style={{ width: '34px', height: '34px' }}
              aria-label="Menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            {showSettings && (
              <div className="absolute bottom-full right-0 mb-1 bg-bg-secondary border border-border min-w-44 animate-fadeIn z-50">
                {/* Queue section - only show when has queued messages */}
                {queueCount > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-xs text-text-secondary border-b border-border">
                      Queue ({queueCount})
                    </div>
                    <button
                      onClick={() => { onClearQueue?.(); setShowSettings(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-tertiary transition-colors text-sm border-b border-border"
                    >
                      <X className="w-3.5 h-3.5 text-accent-red" />
                      <span className="text-text-primary">clear queue</span>
                    </button>
                  </>
                )}
                {/* Actions */}
                <button
                  onClick={() => { onOpenHistory?.(); setShowSettings(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-tertiary transition-colors text-sm"
                >
                  <History className="w-3.5 h-3.5 text-accent-orange" />
                  <span className="text-text-primary">history</span>
                </button>
                <button
                  onClick={() => { onOpenTerminal?.(); setShowSettings(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-tertiary transition-colors text-sm"
                >
                  <TerminalIcon className="w-3.5 h-3.5 text-accent-green" />
                  <span className="text-text-primary">terminal</span>
                </button>
                <button
                  onClick={() => { fileInputRef.current?.click(); setShowSettings(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-tertiary transition-colors text-sm"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-accent-purple" />
                  <span className="text-text-primary">image</span>
                </button>
                {speechSupported && (
                  <button
                    onClick={() => { toggleAlwaysListen(); setShowSettings(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-tertiary transition-colors text-sm"
                  >
                    <Mic className={`w-3.5 h-3.5 ${alwaysListenMode ? 'text-accent-green' : 'text-text-secondary'}`} />
                    <span className="text-text-primary">voice {alwaysListenMode ? '(on)' : ''}</span>
                  </button>
                )}
                {/* Divider */}
                <div className="border-t border-border" />
                {/* Settings */}
                <button
                  onClick={() => { onOpenConfig?.(); setShowSettings(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-tertiary transition-colors text-sm"
                >
                  <FileText className="w-3.5 h-3.5 text-text-secondary" />
                  <span className="text-text-primary">config</span>
                </button>
                <button
                  onClick={() => { onOpenPlugins?.(); setShowSettings(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-tertiary transition-colors text-sm"
                >
                  <Puzzle className="w-3.5 h-3.5 text-text-secondary" />
                  <span className="text-text-primary">plugins</span>
                </button>
                <button
                  onClick={() => { onOpenMCP?.(); setShowSettings(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-tertiary transition-colors text-sm"
                >
                  <Server className="w-3.5 h-3.5 text-text-secondary" />
                  <span className="text-text-primary">mcp</span>
                </button>
              </div>
            )}
          </div>

          {/* Plan mode toggle */}
          <button
            onClick={onTogglePlanMode}
            className={`transition-colors flex items-center justify-center shrink-0 border ${
              planMode
                ? 'bg-accent-purple/20 text-accent-purple border-accent-purple'
                : 'border-border hover:border-accent-purple text-text-secondary hover:text-accent-purple'
            }`}
            style={{ width: '34px', height: '34px' }}
            aria-label={planMode ? 'Exit plan mode' : 'Enter plan mode'}
            title={planMode ? 'Plan mode ON' : 'Plan mode'}
          >
            <Compass className="w-4 h-4" />
          </button>

          {/* Voice indicator - compact, only when active */}
          {alwaysListenMode && (
            <button
              onClick={toggleAlwaysListen}
              className={`transition-colors flex items-center justify-center shrink-0 border ${
                isRecording
                  ? 'bg-accent-red/20 text-accent-red border-accent-red animate-pulse'
                  : 'bg-accent-green/20 text-accent-green border-accent-green'
              }`}
              style={{ width: '34px', height: '34px' }}
              aria-label="Stop voice mode"
            >
              {isRecording ? <MicOff className="w-4 h-4" /> : <Radio className="w-4 h-4" />}
            </button>
          )}

          {/* Stop button - only when loading */}
          {isLoading && (
            <button
              onClick={onInterrupt}
              className="bg-accent-red/20 hover:bg-accent-red text-accent-red hover:text-bg-primary border border-accent-red transition-colors flex items-center justify-center shrink-0"
              style={{ width: '34px', height: '34px' }}
              aria-label="Cancel"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          )}

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!message.trim() && attachedImages.length === 0}
            className={`${isLoading ? 'bg-accent-orange hover:bg-accent-orange/80' : 'bg-accent-green hover:bg-transparent'} disabled:bg-bg-tertiary disabled:text-text-secondary disabled:border-border disabled:cursor-not-allowed text-bg-primary hover:text-${isLoading ? 'bg-primary' : 'accent-green'} border ${isLoading ? 'border-accent-orange' : 'border-accent-green'} transition-colors flex items-center justify-center shrink-0`}
            style={{ width: '34px', height: '34px' }}
            aria-label={isLoading ? 'Queue message' : 'Send message'}
            title={isLoading ? `Add to queue (${queueCount})` : 'Send message'}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
