# Claude Web UI

개인 개발용 Claude CLI 웹 인터페이스.

## 경고

**VPN + 샌드박스 환경에서만 사용을 권장합니다.**

이 프로젝트는 Claude CLI 프로세스를 웹을 통해 제어하므로, 외부 노출 시 심각한 보안 위험이 있습니다:
- Claude CLI는 시스템 명령 실행 권한을 가짐
- 웹 인터페이스가 노출되면 원격 코드 실행(RCE) 가능
- 인증 없이 파일 시스템 접근 가능

## 기능

- 멀티탭 채팅 인터페이스
- SSE 기반 실시간 메시지 스트리밍
- 세션 관리 (Claude CLI 연동)
- 터미널 스타일 다크 테마
- 도구 블록 표시 (Edit 작업 시 git diff 뷰)
- 파일 탐색기 및 세션 목록 사이드바
- MCP 플러그인 뷰어

## 스택

- **Backend**: Go (net/http, SSE)
- **Frontend**: React, TypeScript, Tailwind CSS, Vite

## 실행

```bash
# 클라이언트 빌드
cd client
bun install
bun run build

# 서버 실행
cd ..
go build -o server
./server
```

## 라이선스

개인 사용 목적.
