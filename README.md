# PokeTokenBar for Windows

토큰을 써서 포켓몬을 키우는 Windows 트레이 앱 + 데스크톱 펫.

[chattymin/PokeTokenBar](https://github.com/chattymin/PokeTokenBar) (macOS, MIT)의 아이디어를
Windows로 옮긴 것입니다. 원본 코드를 이식한 게 아니라 새로 만들었습니다 —
원본은 Swift/SwiftUI라 Windows에서 UI 레이어를 통째로 다시 써야 합니다.

## 지금 되는 것

**트레이**
- 아이콘이 **현재 포켓몬 스프라이트**로 바뀜
- 툴팁에 오늘 / 누적 토큰, 다음 진화까지 남은 양
- 우클릭 메뉴 — 펫 · 도감 · 설정 · 다시 뽑기 · 새로고침 · 종료

**팝오버** (트레이 클릭 또는 펫 클릭 · ✕ 버튼이나 Esc로 닫기)
- 애니메이션 스프라이트, 현재 단계와 종 이름
- **희귀도(★1~5)와 성격** — 같은 종이라도 개체가 다르다
- **진화 트리** — 도달한 칸은 컬러, 못 간 칸은 흑백, 각 칸에 필요 토큰
- 다음 진화까지 진행바, 도감 수집 현황
- 오늘 / 누적 토큰, **도구별 내역**, 최근 7일 막대 그래프
- **한도** — 5시간 창(사용량·남은 시간·시간당 속도), Codex 주간 %, 최근 7일

**데스크톱 펫**
- 투명 창, 항상 위, 작업표시줄에 안 뜸
- **클릭하면 팝오버**, 드래그하면 이동 (4px 이하 움직임은 클릭으로 침)
- 천천히 배회 — 가만히 있기 / 가끔 / 자주

**게임**
- **221개 진화 라인** (1~5세대), 첫 실행에 자동 뽑기
- **포획률 기반 가중 뽑기** — 공식 포획률을 5등급으로 묶어 희귀한 게 실제로 희귀하다
- **성격 25종** — 오른/내린 능력치까지 (표시용, 게임에 영향 없음)
- 5단계: 알 → 부화 → 1차 진화 → 최종 진화 → 마스터(이로치)
- **개체별 성장** — 받은 시점부터 쓴 토큰으로만 자란다. 알부터 시작한다
- **뽑기권** — 50M 쓸 때마다 1장. 무제한 리롤이면 희귀도가 의미를 잃는다
- **졸업** — 마스터까지 키우면 도감에 기록되고 다음 알이 공짜로 나온다
- **도감 창** — 221칸 격자. 만난 종만 그림·이름·★이 보이고 나머지는 번호만

**알림** (진화 · 졸업 · 한도 임박)
- 상태가 바뀐 순간에만. 폴링이 같은 사실을 반복해서 알리지 않는다

**설정 창**
- 알림 켜기 · 한도 경고 기준(50~95%)
- 펫 크기(64~320px) · 움직임
- 갱신 주기(30초~10분) · 로그인 시 자동 시작
- 저장 폴더 열기 · 진행 초기화

## 실행

```bash
npm install
npm start
```

로그만 확인:

```bash
npm run probe
```

진화 라인 다시 생성 (PokéAPI에서 받아옴):

```bash
npm run lines
```

## 데이터

Claude Code와 Codex의 로컬 로그를 읽습니다.

| 도구 | 경로 | 상태 |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | ✅ |
| Codex | `~/.codex/sessions/**/*.jsonl` | ✅ |
| Gemini | — | ❌ Antigravity 로그에 토큰이 없음 |
| Copilot | — | ❌ `.copilot` 전체에 토큰 필드 없음 |

**토큰 집계에는 네트워크를 쓰지 않습니다.**
스프라이트를 처음 받을 때만 PokéAPI/GitHub에 접속하고 이후 디스크에 캐시합니다.

토큰은 `input + output + cache_creation + cache_read` 를 전부 더합니다.
청구 기준이 아니라 "얼마나 굴렸나"가 관심사이기 때문입니다.
캐시를 빼면 하루 수치가 1/10로 줄어 게임이 성립하지 않았습니다.

## macOS 원본과 다른 점

| | macOS | Windows |
|---|---|---|
| 숫자 표시 | 메뉴바에 **글자로** | 트레이는 아이콘만 → **툴팁 + 팝오버** |
| 창 | NSStatusItem popover | frameless BrowserWindow |
| 펫 드래그 | AppKit | `app-region: drag`를 쓰면 클릭 이벤트가 안 와서 **직접 구현** |

Windows 트레이는 텍스트 라벨을 지원하지 않습니다. 이 앱의 가장 큰 설계 차이입니다.

## 진화 단계

실제 사용량(하루 5천만~1억)에 맞춰 잡았습니다.

| 단계 | 누적 토큰 |
|---|---|
| 알 | 0 |
| 부화 | 5M |
| 1차 진화 | 80M |
| 최종 진화 | 400M |
| 마스터 (이로치) | 1.5B |

`src/main/pokemon.js` 의 `STAGES` 에서 바꿀 수 있습니다.

## 구조

```
src/main/usage.js      JSONL 파서 (앱의 심장, 단독 실행 가능)
src/main/notify.js     알림 (상태 변화만 골라낸다)
src/main/limits.js     5시간 창 · 주간 · 번레이트 · Codex 쿼터
src/main/pokemon.js    진화 단계 · 뽑기 · 진화 트리 · 스프라이트 캐시
src/main/lines.json    221개 진화 라인(포획률 포함)  ⚠️ 자동 생성물
src/main/natures.json  성격 25종                 ⚠️ 자동 생성물
src/main/index.js      트레이 · 팝오버 · 펫 · 배회 · 폴링
src/main/preload.js    contextBridge (렌더러는 파일시스템에 안 닿음)
src/renderer/          팝오버(index) · 펫(pet) · 도감(dex) · 설정(settings)
src/renderer/egg.js    알 그림 (SVG). PokéAPI에 쓸 만한 알이 없어 직접 그렸다
scripts/build-lines.mjs  PokéAPI → lines.json
```

`lines.json` 은 **손으로 고치지 마세요.** 도감 번호와 한국어 이름을
직접 적으면 반드시 틀립니다. `npm run lines` 로 다시 만듭니다.

## 아직 안 되는 것

원본 대비 빠진 것들입니다. [원본 README](https://github.com/chattymin/PokeTokenBar/blob/main/README.ko.md) 참고.

- **Gemini · Copilot** — 로컬 로그에 토큰이 안 남아 불가. Gemini CLI/Copilot CLI를 쓰면 가능해질 수 있음
- **Claude 공식 한도 %** — 로컬에 한도값이 없어 불가 (Codex는 opencodex 캐시로 가능)
- **비용 계산**
- 도감 화면 · 상점 · 아이템 · 이로치 확률
- 인스톨러 · 자동 업데이트
- 다국어 (지금은 한국어만)
