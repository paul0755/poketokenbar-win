# PokeTokenBar 실시간 배틀 중계 · 길드 서버

Cloudflare Workers + Durable Objects. 같은 방(6자리 코드)에 들어온 두 앱에게
서로의 팀 코드와 "언제 시작할지"를 전달만 합니다. 결투 계산은 두 앱이 각자 하고,
실시간 배틀 방은 **아무것도 저장하지 않습니다.** 앱 설치 파일에는 들어가지 않습니다.

**길드**(`src/guild.js`)는 따로 저장합니다 — 길드원이 꺼져 있어도 방을 구경하고 결투할 수 있어야 해서,
길드원마다 앱이 올린 "방 사진"을 Durable Object 저장소에 둡니다. 토큰 기록은 오지 않습니다.

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

## 길드 (HTTP, JSON)

| 요청 | 본문 | 돌려주는 것 |
|---|---|---|
| `POST /guild` | `{ name, member }` | `{ code, memberId, key }` — 만든 사람이 길드장 |
| `GET /guild/ABCD2345` | | `{ name, leader, max, members: [{ id, snap, joined, updated }] }` |
| `POST /guild/ABCD2345/join` | `{ member }` | `{ memberId, key }` (30명까지) |
| `POST /guild/ABCD2345/update` | `{ memberId, key, member }` | 내 방 사진 바꾸기 (15초에 한 번까지) |
| `POST /guild/ABCD2345/leave` | `{ memberId, key }` | 내 칸을 지운다. 길드장이 나가면 가장 오래된 길드원이 맡는다 |
| `POST /guild/ABCD2345/kick` | `{ memberId, key, target }` | 길드장만 |
| `POST /guild/ABCD2345/disband` | `{ memberId, key }` | 길드장만 — 길드를 통째로 지운다 |

- `member`(방 사진) — `{ trainer, theme, furni[], mons[{ line, dexId, name, shiny, stage, level }], dex{seen,total}, graduated, lastGrad, wins, team }`.
  서버는 꼴만 보고(`cleanSnap`) 모르는 칸·틀린 값은 버립니다
- 계정이 없습니다. `key` 는 들어갈 때 한 번 주고, 서버에는 SHA-256 해시만 남깁니다
- 길드 코드는 헷갈리는 글자(0·O·1·I)를 뺀 8글자. 앱에는 `GLD-` 를 붙여 보여 줍니다
- 길드가 생긴 뒤 처음 배포할 때 `wrangler.toml` 의 마이그레이션 `v2`(Guild)가 같이 적용됩니다
