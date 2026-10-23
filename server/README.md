# PokeTokenBar 실시간 배틀 중계 서버

Cloudflare Workers + Durable Objects. 같은 방(6자리 코드)에 들어온 두 앱에게
서로의 팀 코드와 "언제 시작할지"를 전달만 합니다. 결투 계산은 두 앱이 각자 하고,
서버는 **아무것도 저장하지 않습니다.** 앱 설치 파일에는 들어가지 않습니다.

## 로컬에서 돌리기

```bash
cd server
npm install
npm run dev        # ws://127.0.0.1:8787
```

앱 설정 › 온라인 기능 › 중계 서버에 `ws://127.0.0.1:8787` 을 넣으면 로컬 서버에 붙습니다.

## 배포

```bash
cd server
npx wrangler login   # 브라우저에서 Cloudflare 로그인
npm run deploy       # https://poketokenbar-relay.<계정>.workers.dev
```

지금 배포된 주소는 `https://poketokenbar-relay.yezandi.workers.dev` 이고, 앱의 기본 서버
(`src/main/index.js` 의 `DEFAULT_RELAY`)가 `wss://poketokenbar-relay.yezandi.workers.dev` 입니다.
다른 서버를 쓰려면 앱 설정 › 온라인 기능 › 중계 서버에 `wss://…` 주소를 넣으세요.

## 프로토콜 (JSON, 웹소켓)

| 방향 | 메시지 | |
|---|---|---|
| 접속 | `/room/123456?role=host\|guest` | 방 만들기 / 참가 |
| 서버 → 앱 | `{t:"joined", role}` | 들어왔다 |
| 앱 → 서버 | `{t:"hello", name, team}` | 내 팀 코드(PTB1-…)와 이름. 방 안에서 다시 보내면 포켓몬을 바꾼 것 |
| 서버 → 앱 | `{t:"peer", name, team, changed}` | 상대 팀 코드. changed 면 상대가 바꿨다 — 이때 양쪽 준비가 풀린다 |
| 앱 → 서버 | `{t:"ready"}` | 준비 |
| 서버 → 앱 | `{t:"peerReady"}` · `{t:"start", at}` | 상대 준비 · 둘 다 준비 — 서버 시각 at 에 시작 |
| 서버 → 앱 | `{t:"left"}` · `{t:"error", reason}` | 상대 나감 · 거절 |

서버가 보내는 모든 메시지에 `now`(서버 시각)가 실립니다. 앱은 이걸로 시계 차이를 재서
두 화면이 같은 순간에 시작하게 합니다.
