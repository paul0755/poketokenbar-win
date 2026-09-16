# PokeTokenBar for Windows

토큰을 써서 포켓몬을 키우는 Windows 트레이 앱 + 데스크톱 펫.

[chattymin/PokeTokenBar](https://github.com/chattymin/PokeTokenBar) (macOS, MIT)의 아이디어를
Windows로 옮긴 것입니다. 원본 코드를 이식한 게 아니라 새로 만들었습니다 —
원본은 Swift/SwiftUI라 Windows에서 UI 레이어를 통째로 다시 써야 합니다.

## 지금 되는 것

**트레이**
- 아이콘이 **현재 포켓몬 스프라이트**로 바뀜
- 툴팁에 오늘 / 누적 토큰, 다음 진화까지 남은 양
- 우클릭 메뉴 — 펫 표시 · 움직임 강도 · 다시 뽑기 · 새로고침 · 종료

**팝오버** (트레이 클릭 또는 펫 클릭)
- 애니메이션 스프라이트, 현재 단계와 종 이름
- **진화 트리** — 도달한 칸은 컬러, 못 간 칸은 흑백, 각 칸에 필요 토큰
- 다음 진화까지 진행바, 도감 수집 현황
- 오늘 / 누적 토큰, 최근 7일 막대 그래프

**데스크톱 펫**
- 투명 창, 항상 위, 작업표시줄에 안 뜸
- **클릭하면 팝오버**, 드래그하면 이동 (4px 이하 움직임은 클릭으로 침)
- 천천히 배회 — 가만히 있기 / 가끔 / 자주

**게임**
- **221개 진화 라인** (1~5세대), 첫 실행에 자동 뽑기
- 5단계: 알 → 부화 → 1차 진화 → 최종 진화 → 마스터(이로치)
- 🎲 다시 뽑기, 뽑은 라인은 도감에 기록

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
src/main/pokemon.js    진화 단계 · 뽑기 · 진화 트리 · 스프라이트 캐시
src/main/lines.json    221개 진화 라인  ⚠️ 자동 생성물
src/main/index.js      트레이 · 팝오버 · 펫 · 배회 · 폴링
src/main/preload.js    contextBridge (렌더러는 파일시스템에 안 닿음)
src/renderer/          팝오버(index) · 데스크톱 펫(pet)
scripts/build-lines.mjs  PokéAPI → lines.json
```

`lines.json` 은 **손으로 고치지 마세요.** 도감 번호와 한국어 이름을
직접 적으면 반드시 틀립니다. `npm run lines` 로 다시 만듭니다.

## 아직 안 되는 것

원본 대비 빠진 것들입니다. [원본 README](https://github.com/chattymin/PokeTokenBar/blob/main/README.ko.md) 참고.

- **Gemini · Copilot** — 로컬 로그에 토큰이 안 남아 불가. Gemini CLI/Copilot CLI를 쓰면 가능해질 수 있음
- **공식 한도** — 5시간 / 주간 한도, 리셋 카운트다운, 번레이트 예측
- **비용 계산**
- 도감 화면 · 상점 · 아이템 · 성격 · 이로치 확률
- 알림 (이로치 부화, 한도 임박)
- 설정 화면 · 자동 시작 · 인스톨러
- 다국어 (지금은 한국어만)
