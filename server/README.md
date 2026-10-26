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
| `POST /guild` | `{ name, member, walletKey? }` | `{ code, memberId, key }` — 만든 사람이 길드장 |
| `GET /guild/ABCD2345` | | `{ name, leader, max, members: [{ id, snap, joined, updated }], weeks: [{ key, rows }] }` |
| `POST /guild/ABCD2345/join` | `{ member, walletKey? }` | `{ memberId, key }` (30명까지) |
| `POST /guild/ABCD2345/update` | `{ memberId, key, member, walletKey? }` | 내 방 사진 바꾸기 (15초에 한 번까지) |
| `POST /guild/ABCD2345/leave` | `{ memberId, key }` | 내 칸을 지운다. 길드장이 나가면 가장 오래된 길드원이 맡는다 |
| `POST /guild/ABCD2345/kick` | `{ memberId, key, target }` | 길드장만 |
| `POST /guild/ABCD2345/disband` | `{ memberId, key }` | 길드장만 — 길드를 통째로 지운다 |

- `member`(방 사진) — `{ trainer, theme, furni[], statue, pos, mons[{ line, dexId, name, shiny, stage, level }], dex{seen,total}, graduated, lastGrad, wins, team, usage }`.
  `statue` 는 전설 석상의 모델(도감 번호) — 전설 · 환상이 아니면 버립니다. `pos` 는 끌어 옮긴 가구 자리 `{ id: [x, y] }`(그림 좌표 320×200).
  `usage` 는 길드 순위용 토큰 합계 `{ week, today, burn, morning, core, night, dawn, weekKey, dayKey, prev }` — 앱에서 공개를 끈 사람은 보내지 않습니다.
  `prev` 는 지난주 최종 합계로, 지난주가 끝나기 전에 이미 길드원이었던 사람만 지난주 칸을 마무리할 수 있습니다
  서버는 꼴만 보고(`cleanSnap`) 모르는 칸·틀린 값은 버립니다
- `weeks` — 주간 기록(최근 26주, 최신부터). 길드원이 합계를 올릴 때마다 그 주 칸에 마지막 값을 적어 둡니다.
  앱이 이걸로 지난주 순위·칭호·명예의 전당을 계산합니다. 나가거나 내보내진 사람의 줄은 모든 주에서 지웁니다
- **코인 꾸미기는 산 사람 방에만 보입니다** — 방 사진에 코인 배경·가구(`src/main/deco.json`)가 있으면 지갑의 산 목록과
  맞춰 보고 안 산 것은 지웁니다(배경은 오두막으로). 지갑 번호는 길드 보기에 드러나 있어서 `walletKey` 로 그 지갑이 이 사람
  것인지 봅니다. 열쇠는 저장하지 않고, 코인 꾸미기가 없으면 지갑을 부르지 않습니다
- 계정이 없습니다. `key` 는 들어갈 때 한 번 주고, 서버에는 SHA-256 해시만 남깁니다
- 길드 코드는 헷갈리는 글자(0·O·1·I)를 뺀 8글자. 앱에는 `GLD-` 를 붙여 보여 줍니다
- 길드가 생긴 뒤 처음 배포할 때 `wrangler.toml` 의 마이그레이션 `v2`(Guild)가 같이 적용됩니다

## 코인 지갑 (HTTP, JSON) — `src/wallet.js`

몰에서 쓰는 화폐(🪙). 사탕과 달리 **잔액을 서버가 들고 있어서** 가짜 결제·두 번 쓰기가 안 됩니다.

| 요청 | 본문 | |
|---|---|---|
| `POST /wallet` | | 만들기 → `{ walletId, key, balance }` — 처음 지원금 없음. 같은 인터넷 주소에서 하루 5개까지 |
| `POST /wallet/w0123456789ab` | `{ key }` | 잔액 · 오늘 출석했나 · 남은 환전 한도 · 최근 내역 |
| `POST /wallet/w0123456789ab/checkin` | `{ key, day }` | 출석 🪙10, 하루 한 번 (그 사람 PC 날짜, 서버 시각 ±36시간 안) |
| `POST /wallet/w0123456789ab/exchange` | `{ key, day, n }` | 사탕 n개 → 🪙5n, 하루 사탕 5개까지 |
| `POST /wallet/w0123456789ab/sell` | `{ key, day, mon: { line, grown, shiny } }` | 상점에 팔기 — 값은 서버가 센다(희귀도 × 진화 단계 × 이로치, 전설 15). 하루 10마리 · 🪙100까지 |
| `POST /wallet/w0123456789ab/buy` | `{ key, item }` | 코인 꾸미기 사기 — 값은 서버가 `src/main/deco.json`(앱과 같은 파일)에서 정한다. 산 것은 보기의 `deco` 에 남는다 |

- 부계정으로 코인 모으기를 막으려고 처음 지원금이 없고, 지갑 만들기는 같은 주소(해시로만 셉니다)에서 하루 5개까지,
  **새 지갑은 만든 지 이틀이 지나야 몰에서 살 수 있습니다**(파는 건 바로)
- 코인이 생기는 곳은 위 출석 · 환전 · 상점에 팔기와 **몰 판매 대금 · 길드 주간 보상**뿐입니다. 뒤의 둘은 길드 객체가 지갑 객체를 직접 불러
  넣습니다(`credit`) — 밖에서는 부를 수 없습니다
- 사탕은 서버가 확인할 수 없어서(세이브에 있다) 환전은 하루 한도로 묶었습니다
- 코인이 **빠져나가는 곳**은 몰 수수료 5%와 **코인 꾸미기**입니다. 꾸미기는 되팔거나 선물할 수 없어서 쓴 코인은 그대로 사라집니다
- 계정이 없습니다. 열쇠는 만들 때 한 번 주고 서버에는 해시만 둡니다. 열쇠를 잃으면 지갑도 잃습니다

## 길드 몰 — `src/market.js`

| 요청 | 본문 | |
|---|---|---|
| `GET /guild/ABCD2345/market` | | 매물 · 최근 거래 100건 |
| `POST /guild/ABCD2345/market/list` | `{ memberId, key, walletId, walletKey, mon, price }` | 팔기 — 포켓몬을 서버에 맡긴다. 🪙1~9999, 한 사람 5마리까지, 7일 |
| `POST /guild/ABCD2345/market/buy` | `{ memberId, key, walletId, walletKey, listingId }` | 사기 — 산 사람 지갑에서 빼고, 판 사람 지갑에 판매가 − 수수료 5% |
| `POST /guild/ABCD2345/market/cancel` | `{ walletId, walletKey, listingId }` | 돌려받기 — 취소 · 7일 만료 · 내보내졌을 때 |

- `mon` 은 교환 코드와 같은 내용(종 · 성격 · 이로치 · 개체값 · 성별 · 특성 · 패시브스킬 · 기술머신 · 성장량 ·
  변하지않는돌 · 처음 키운 트레이너). 서버는 꼴만 보고, 말이 되는 값인지는 사는 앱이 다시 봅니다
- 사는 동안 그 매물을 잠가 둬서 두 사람이 같은 포켓몬을 동시에 살 수 없습니다
- 판 사람이 꺼져 있어도 대금은 지갑에 바로 들어갑니다. 넣다 실패하면 다음 몰 요청 때 다시 넣습니다
- 내보내진 사람의 매물은 지갑 열쇠로 돌려받을 수 있게 남깁니다. 맡겨 둔 포켓몬이 있으면 길드를 없앨 수 없습니다

## 길드 주간 코인 보상

지난주가 확정되면(다음 주 시작 + 36시간) 1위에게 🪙50, 칭호(버닝 MVP · 코어타임 · 야근왕 · 올빼미 · 아침형)마다
🪙10 을 그 사람 지갑에 한 번 넣습니다. 끝난 주는 고칠 수 없습니다 — "이번 주"는 서버 시각으로 지금인 주만,
지난주는 바로 앞 주의 마무리(prev)로만 받습니다.
