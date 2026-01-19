# Claude Web UI

개인 개발용 Claude CLI 웹 인터페이스.

## 경고

**VPN + 샌드박스 환경에서만 사용을 권장합니다.**

이 프로젝트는 Claude CLI 프로세스를 웹을 통해 제어하므로, 외부 노출 시 심각한 보안 위험이 있습니다:
- Claude CLI는 시스템 명령 실행 권한을 가짐
- 웹 인터페이스가 노출되면 원격 코드 실행(RCE) 가능
- 인증 없이 파일 시스템 접근 가능

## 기능

### 채팅
- 멀티탭 채팅 인터페이스
- WebSocket 기반 실시간 메시지 스트리밍
- 세션 관리 (Claude CLI 연동)
- 터미널 스타일 다크 테마
- 도구 블록 표시 (Edit 작업 시 git diff 뷰)
- Plan 모드 토글

### 멀티 디바이스 지원
- 세션 브로드캐스트: 다른 기기에서 같은 세션의 실시간 스트리밍 확인 가능
- 서버 상태 SSE 구독: 모든 클라이언트에 세션 상태 동기화
- 실행 중인 세션 표시 (사이드바에 컬러 펄스 애니메이션)

### 사이드바
- 파일 탐색기: 디렉토리 탐색, 작업 디렉토리 변경, 새 세션 생성
- 세션 목록: 최근/트리 뷰, 검색, 새 탭에서 열기, 삭제
- MCP 플러그인 뷰어
- 설정 뷰어 (CLAUDE.md, .clauderc)

### 기타
- Interrupt 기능: 실행 중인 프로세스 중단
- 메시지 큐: 여러 메시지 연속 입력 지원

## 스택

- **Backend**: Go (Gin, gorilla/websocket, SSE)
- **Frontend**: React, TypeScript, Tailwind CSS, Vite, Zustand

## 실행

```bash
# 클라이언트 빌드
cd client
bun install
bun run build

# 서버 빌드 및 실행
cd ..
go build -o server
./server --port=43210
```

## 라이선스

개인 사용 목적.
