# discord-ai-assistant

Discord 자연어 명령 → Claude Code CLI 비대화형 실행 → 결과 회신. 개인용 서버 비서.

## 구조

- `src/adapters/discord` — Discord 어댑터 (discord.js)
- `src/core` — 접근 제어, 작업 큐, 라우팅 (플랫폼 비종속)
- `src/providers` — Claude Code CLI 실행기, 권한 정책
- `src/config.ts` / `src/logging` — 설정·로깅
- `test/` — vitest 단위 테스트 (파일당 모듈 하나)

## 실행

```bash
npm run dev                  # tsx watch
npm run build && npm start   # 프로덕션
```

## 검증

```bash
npm test          # vitest run
npm run build     # tsc 타입 검사 겸용
```

수정한 모듈에 대응하는 `test/*.test.ts`가 있으면 그것부터 돌린다.

## 주의

- 이 저장소는 systemd 서비스(`discord-ai-assistant.service`)로 돌지만 **현재 중지·비활성 상태**다. OpenClaw 게이트웨이와 **같은 Discord 봇 토큰**을 쓰기 때문에 둘을 동시에 켜면 충돌한다. 되살리려면 먼저 OpenClaw 쪽 Discord 채널을 끈다
- `.env`에 봇 토큰이 있다. 읽지도 쓰지도 않는다
- 프론트엔드가 없다. `frontend-design` / `web-design-guidelines` / Playwright는 이 저장소에서 쓸 일이 없다
- 포매터 설정이 없어 자동 포맷 훅은 이 저장소에서 아무 것도 하지 않는다
- GitHub 조회는 `github-personal` MCP를 쓴다 (계정 `zpla15`)
