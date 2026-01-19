# Claude Web UI 리팩토링 계획

## 목표
- 터미널 여러 개 돌리는 느낌의 UX
- Claude CLI 세션을 단일 진실 소스로
- 상태 관리 단순화, 에러 제거

---

## 핵심 원칙

1. **서버는 Stateless Proxy** - 메시지 저장 안 함, 인메모리만
2. **Claude CLI = Source of Truth** - 모든 메시지는 세션 파일에서 lazy load
3. **Session:Tab = 1:1** - 하나의 세션은 하나의 탭에서만
4. **No Optimistic Updates** - 서버 응답 후에만 UI 업데이트

---

## Phase 1: 서버 상태 단순화 (`handlers/state.go`)

### 변경 사항

```go
// Before
type TabState struct {
    ID           string
    SessionID    *string
    Title        *string
    Messages     []interface{}  // ❌ 제거
    IsLoading    bool
    ProcessID    *int
    MessageQueue []string       // ❌ 제거
    WorkDir      *string        // ❌ 제거 (세션에서 가져옴)
}

// After
type TabState struct {
    ID        string  `json:"id"`
    SessionID *string `json:"sessionId"`
    IsLoading bool    `json:"isLoading"`
    ProcessID *int    `json:"processId"`
}
```

### 제거할 것
- `saveToFile()` / `loadFromFile()` - 영속화 제거
- `Messages` 관련 모든 함수
- `MessageQueue` 관련 모든 함수
- `WorkDir` 관련 함수 (세션 메타데이터에서 가져옴)

### 추가할 것
- `isSessionOpen(sessionID) bool` - 세션이 이미 열려있는지 확인
- `getTabBySession(sessionID) *TabState` - 세션으로 탭 찾기

---

## Phase 2: Session:Tab 1:1 제약 (`handlers/state.go`)

```go
func (sm *StateManager) setTabSession(tabID, sessionID string) error {
    sm.mu.Lock()
    defer sm.mu.Unlock()

    // 이미 열린 세션인지 확인
    for _, t := range sm.state.Tabs {
        if t.ID != tabID && t.SessionID != nil && *t.SessionID == sessionID {
            return fmt.Errorf("session already open in tab %s", t.ID)
        }
    }

    // 설정
    for i := range sm.state.Tabs {
        if sm.state.Tabs[i].ID == tabID {
            sm.state.Tabs[i].SessionID = &sessionID
            break
        }
    }

    sm.broadcast()
    return nil
}
```

### 새 API 엔드포인트
- `GET /api/state/session/:sessionId/tab` - 세션이 열린 탭 ID 반환 (없으면 null)

---

## Phase 3: 클라이언트 상태 단순화

### `store/chat-store.ts` 변경

```typescript
// Before - 서버 상태를 그대로 미러링
interface ServerState {
    tabs: TabState[];
    activeTabId: string;
}

// After - 탭 메타데이터만
interface TabMeta {
    id: string;
    sessionId: string | null;
    isLoading: boolean;
    processId: number | null;
}

interface AppState {
    tabs: TabMeta[];
    activeTabId: string;
}
```

### 새로운 메시지 캐시 (클라이언트 로컬)

```typescript
// 메시지는 별도 캐시로 관리 (React Query 또는 단순 Map)
const messagesCache = new Map<string, Message[]>();

// 탭 활성화 시 lazy load
const loadMessages = async (sessionId: string) => {
    if (messagesCache.has(sessionId)) return;

    const res = await fetch(`/api/session/${sessionId}/history`);
    const data = await res.json();
    messagesCache.set(sessionId, data.messages);
};
```

---

## Phase 4: App.tsx 단순화

### 제거할 것
- `handleSendMessage`의 optimistic update
- `messageQueue` 관련 모든 로직
- 복잡한 세션 히스토리 로딩 useEffect
- `retryWithoutSession` 로직

### 변경할 흐름

```typescript
// Before (복잡)
const handleSendMessage = async (text) => {
    // 1. Optimistic update
    // 2. 서버 전송
    // 3. SSE 스트림 처리
    // 4. 큐 처리
    // 5. 에러 시 세션 제거...
};

// After (단순)
const handleSendMessage = async (text: string) => {
    if (!activeTab || activeTab.isLoading) return;

    // 로컬 UI에 사용자 메시지 추가 (캐시에)
    const userMsg: Message = { type: 'user', content: text };
    appendToCache(activeTab.sessionId, userMsg);

    // 서버로 전송
    const response = await fetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
            tabId: activeTab.id,
            prompt: text,
            sessionId: activeTab.sessionId,
        }),
    });

    // SSE 스트림 처리 - 서버 응답을 캐시에 추가
    // isLoading 상태는 서버가 SSE로 관리
};
```

---

## Phase 5: SessionList 개선

```typescript
const SessionList = ({ tabs, onSelectSession, onFocusTab }) => {
    const [sessions, setSessions] = useState([]);

    // 세션이 이미 열려있는지 확인
    const getOpenTab = (sessionId: string) =>
        tabs.find(t => t.sessionId === sessionId);

    return (
        <div>
            {sessions.map(session => {
                const openTab = getOpenTab(session.sessionId);

                return (
                    <button
                        key={session.sessionId}
                        onClick={() => openTab
                            ? onFocusTab(openTab.id)  // 이미 열림 → 포커스
                            : onSelectSession(session.sessionId)  // 새로 열기
                        }
                    >
                        {session.title}
                        {openTab && <span className="text-green-500"> [OPEN]</span>}
                    </button>
                );
            })}
        </div>
    );
};
```

---

## Phase 6: chat.go 단순화

### 제거할 것
- `SetTabMessages` 호출
- `messageQueue` 관련 로직

### WorkDir 처리 변경

```go
// Before: 탭 상태에서 workDir 가져옴
workDir := GetTabWorkDir(req.TabID)

// After: 세션 메타데이터에서 가져옴
func getWorkDirFromSession(sessionID string) string {
    // ~/.claude/projects 에서 세션 찾아서 projectPath 반환
    sessions := listAllSessions()
    for _, s := range sessions {
        if s.SessionID == sessionID {
            return s.ProjectPath
        }
    }
    return os.Getenv("HOME")
}
```

---

## 파일별 변경 요약

| 파일 | 변경 내용 |
|------|----------|
| `handlers/state.go` | Messages/Queue/WorkDir 제거, 1:1 제약 추가, 영속화 제거 |
| `handlers/chat.go` | 메시지 저장 로직 제거, workDir 세션에서 가져오기 |
| `client/src/store/chat-store.ts` | 상태 단순화, 메시지 캐시 분리 |
| `client/src/store/types.ts` | Tab 타입에서 messages/queue 제거 |
| `client/src/App.tsx` | 메시지 로딩 lazy화, optimistic update 제거 |
| `client/src/components/sidebar/SessionList.tsx` | 열린 세션 표시, 포커스 기능 |

---

## 마이그레이션 순서

1. **서버 먼저** - state.go 단순화 (Breaking change)
2. **타입 정의** - types.ts 업데이트
3. **스토어** - chat-store.ts 리팩토링
4. **App.tsx** - 새 구조에 맞게 수정
5. **컴포넌트** - SessionList 등 업데이트
6. **테스트** - 전체 플로우 확인

---

## 예상 결과

- 코드 라인 수: ~30% 감소
- 상태 관련 버그: 대부분 해결
- 새로고침 동작: 세션 목록 → 선택 → lazy load (단순)
- 메모리 사용: 활성 탭 메시지만 캐시
