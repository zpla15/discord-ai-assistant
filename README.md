# discord-ai-assistant

Discord로 자연어 명령을 보내면 Claude Code CLI(구독 로그인)를 비대화형으로 실행해 결과를 돌려주는 개인용 서버 비서.

## 설정

```bash
cp .env.example .env   # 값 채운 뒤 chmod 600 .env
npm install
```

## 실행

```bash
npm run dev     # 개발 모드 (자동 재시작)
npm run build && npm start   # 프로덕션
npm test        # 단위 테스트
```

## 구조

- `src/adapters/discord` — Discord 어댑터 (discord.js)
- `src/core` — 접근 제어, 작업 큐, 라우팅 (플랫폼 비종속)
- `src/providers` — Claude Code CLI 실행기 및 권한 정책
