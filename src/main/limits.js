"use strict";
/**
 * 사용 한도 — 5시간 창, 주간, 번레이트.
 *
 * ── 어디까지가 사실이고 어디부터가 계산인가 ──
 *
 * 로그에는 "한도가 얼마인지"가 적혀 있지 않다. 쓴 양만 적혀 있다.
 * 그래서 퍼센트는 한도를 아는 곳에서만 보여준다:
 *
 *   Codex  : opencodex가 캐시해 둔 실제 쿼터(%, 리셋 시각)를 읽는다.  ← 사실
 *   그 외  : 쓴 양과 남은 시간만 보여준다. 한도를 모르면 %는 지어내는 값이다.
 *
 * 5시간 창 자체는 로그의 타임스탬프로 재구성한다 — 이건 계산이지만
 * 입력이 실제 기록이라 신뢰할 수 있다.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const FIVE_HOURS = 5 * 60 * 60 * 1000;
const WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * 5시간 창으로 묶는다.
 *
 * 창은 "쉬었다가 다시 시작한 첫 요청"에서 열리고 5시간 뒤 닫힌다.
 * 창이 닫힌 뒤 처음 온 요청이 다음 창을 연다.
 */
function fiveHourBlocks(events) {
  const blocks = [];
  for (const e of events) {
    const last = blocks[blocks.length - 1];
    if (last && e.t < last.start + FIVE_HOURS) {
      last.used += e.n;
      last.last = e.t;
      last.count++;
    } else {
      blocks.push({ start: e.t, end: e.t + FIVE_HOURS, last: e.t, used: e.n, count: 1 });
    }
  }
  return blocks;
}

/** 지금 열려 있는 5시간 창. 없으면 null (한동안 안 썼다는 뜻) */
function currentBlock(events, now = Date.now()) {
  const blocks = fiveHourBlocks(events);
  const b = blocks[blocks.length - 1];
  if (!b || now >= b.end) return null;
  const elapsedH = Math.max(0.05, (now - b.start) / 3600000);
  return {
    ...b,
    remainingMs: b.end - now,
    elapsedH,
    // 번레이트는 창이 열린 뒤 실제 경과 시간으로 나눈다.
    // 마지막 요청 시각으로 나누면 쉬는 동안 값이 부풀려진다.
    perHour: Math.round(b.used / elapsedH),
  };
}

/** 최근 7일 (달력 주가 아니라 롤링) */
function rollingWeek(events, now = Date.now()) {
  const from = now - WEEK;
  let used = 0;
  const bySrc = new Map();
  for (const e of events) {
    if (e.t < from) continue;
    used += e.n;
    bySrc.set(e.src, (bySrc.get(e.src) ?? 0) + e.n);
  }
  return { used, from, bySource: [...bySrc.entries()].sort((a, b) => b[1] - a[1]) };
}

/**
 * 리셋 시각에 맞춘 주간 창.
 *
 * 롤링 7일과는 다른 물건이다. Claude 주간 한도는 정해진 요일·시각에
 * 리셋되는데, 롤링으로 재면 리셋 직후에도 지난주 사용분이 그대로 남는다.
 * 실제로 Claude가 3%라고 할 때 롤링 창은 560M을 세고 있었다 —
 * 그 분모로 한도를 역산하면 33배 틀린 값이 나온다.
 *
 * day: 0=일 … 6=토, hour: 0~23 (로컬 시각)
 */
function anchoredWeek(events, now, day, hour) {
  const d = new Date(now);
  const start = new Date(d);
  start.setDate(d.getDate() - ((d.getDay() - day + 7) % 7));
  start.setHours(hour, 0, 0, 0);
  // 오늘이 리셋 요일이어도 아직 시각 전이면 지난주가 현재 창이다
  if (start.getTime() > now) start.setDate(start.getDate() - 7);
  const from = start.getTime();
  let used = 0;
  for (const e of events) if (e.t >= from) used += e.n;
  return { used, from, resetAt: from + WEEK };
}

/**
 * opencodex가 캐시한 Codex 실제 쿼터.
 *
 * 이건 계산이 아니라 제공자가 알려준 값이다. 없으면 null —
 * 없는 걸 추정해서 채우지 않는다.
 */
/**
 * clanker-usage 계열 도구가 떨궈 두는 사용률.
 *
 *   ~/.cache/clanker-usage/<공급자>/<계정>.json   (usage-v1)
 *   { schema, provider, account, plan, status, retrieved_at,
 *     windows: [ { name: "5-hour"|"weekly"|..., scope, used_pct, resets_at } ] }
 *
 * 왜 남의 도구 파일을 읽나 —
 * 사용률 퍼센트는 공급자에게 물어봐야 알 수 있고, 물어보려면 인증 정보가
 * 필요하다. 그 코드는 이 앱에 넣지 않기로 했다. 대신 그 일을 하는 도구가
 * 떨궈 둔 결과만 읽는다. opencodex 쿼터 캐시를 읽는 것과 같은 방식이다.
 *
 * 없으면 null 이다. 안 깔았으면 예전과 똑같이 동작한다.
 *
 * 모델별 주간 창은 건너뛴다. 전체 주간 한도와 섞이면 "주간 16% 쓴 계정에
 * 주간 한도 도달" 같은 모순이 화면에 뜬다 — 실제로 로그에서 그걸 봤다.
 */
function clankerUsage(id, file) {
  const want = id === "claude" ? /claude/i : id === "codex" ? /codex|openai/i : new RegExp(id, "i");
  const files = [];
  if (file) files.push(file);
  else {
    const base = path.join(os.homedir(), ".cache", "clanker-usage");
    try {
      for (const prov of fs.readdirSync(base)) {
        if (!want.test(prov)) continue;
        const dir = path.join(base, prov);
        try {
          for (const n of fs.readdirSync(dir)) if (n.endsWith(".json")) files.push(path.join(dir, n));
        } catch {}
      }
    } catch {
      return null; // 도구를 안 쓴다
    }
  }

  let best = null;
  for (const f of files) {
    let j;
    try {
      const raw = fs.readFileSync(f, "utf8");
      j = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    } catch {
      continue;
    }
    if (!j || !Array.isArray(j.windows)) continue;
    if (j.status === "unavailable") continue;

    const ms = (v) => (typeof v === "number" ? (v > 1e11 ? v : v * 1000) : null);
    const pick = (re) =>
      j.windows.find(
        (w) =>
          w &&
          typeof w.used_pct === "number" &&
          re.test(String(w.name || "")) &&
          // 모델별 창은 제외한다 — scope 가 알려주면 그걸 믿고, 없으면 이름으로 거른다
          !/model|opus|sonnet|haiku|gpt|gemini/i.test(String(w.name) + " " + String(w.scope || "")),
      ) || null;

    const b = pick(/^5[s-]?hour|five/i);
    const w = pick(/^week/i);
    if (!b && !w) continue;

    const at = ms(j.retrieved_at) ?? Date.now();
    const cand = {
      block: b ? b.used_pct : null,
      week: w ? w.used_pct : null,
      blockResetAt: b ? ms(b.resets_at) : null,
      weekResetAt: w ? ms(w.resets_at) : null,
      at,
      ageMs: Date.now() - at,
      status: j.status || null,
      plan: j.plan || null,
      path: f,
      from: "공식 값",
    };
    if (!best || cand.at > best.at) best = cand;
  }
  return best;
}

function codexQuota(file) {
  const f = file || path.join(os.homedir(), ".opencodex", "codex-quota-cache.json");
  try {
    const raw = fs.readFileSync(f, "utf8");
    const j = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    const q = j.quotas && j.quotas.__main__;
    if (!q || typeof q.weeklyPercent !== "number") return null;
    const ageMs = Date.now() - q.updatedAt;
    return {
      percent: q.weeklyPercent,
      resetAt: q.weeklyResetAt * 1000, // 파일은 초 단위
      updatedAt: q.updatedAt,
      ageMs,
      /*
       * opencodex가 캐시를 갱신해 줄 때만 값이 바뀐다. 갱신이 멈추면
       * 우리 숫자는 틀린 게 아니라 오래된 것인데, 화면에서는 구분되지 않는다.
       * 실제로 4시간 45분 묵은 값이 최신처럼 보인 적이 있어 기준을 1시간으로 낮췄다.
       */
      stale: ageMs > 3600000,
    };
  } catch {
    return null; // opencodex를 안 쓰거나 아직 캐시가 없다
  }
}

/**
 * Claude 공식 사용률.
 *
 * Claude 데스크톱 앱이 제 사용률을 적어 둔다:
 *   { samples: [ { t: 밀리초, org: "...", u: { fh: 5시간%, sd: 7일% } } ] }
 *
 * 어디에 적는지는 설치 방식과 버전에 따라 다르다. 한 곳만 박아 두면,
 * 앱이 데이터를 옮기는 날 막대가 조용히 사라지고 사용자는 "자동이라더니"
 * 하며 수동 입력란을 보게 된다. 실제로 그렇게 됐다. 그래서 아는 자리를
 * 전부 후보로 두고 가장 최근에 쓰인 쪽을 쓴다.
 *
 *   %APPDATA%/Claude/                              일반 설치본
 *   %LOCALAPPDATA%/Packages/Claude_<패키지>/LocalCache/Roaming/Claude/
 *                                                  MSIX(스토어) 설치본.
 *                                                  %APPDATA% 가 가상화되어
 *                                                  밖에서는 안 보인다
 *   %LOCALAPPDATA%/Claude-Data/<패키지>/           2026-10 이후. 옛 자리에는
 *                                                  .user-data-left 표식만 남는다
 *
 * fh = five hour, sd = seven day, 둘 다 "쓴 비율"이다. 15분쯤마다 한 줄씩
 * 쌓이고 창이 리셋되면 0으로 떨어진다. 제공자가 알려준 값이라 계산이 아니다.
 *
 * 로그에는 한도가 없어서 이 값을 못 구하는 줄 알았는데, 앱이 이미
 * 받아 두고 있었다. 크리덴셜도 네트워크도 필요 없다 — 이미 디스크에 있다.
 */
function claudeQuotaCandidates() {
  const home = os.homedir();
  const local = path.join(home, "AppData", "Local");
  const out = [path.join(home, "AppData", "Roaming", "Claude", "plan-usage-history.json")];

  const pkgs = path.join(local, "Packages");
  try {
    for (const n of fs.readdirSync(pkgs)) {
      if (!/^Claude_/i.test(n)) continue;
      out.push(path.join(pkgs, n, "LocalCache", "Roaming", "Claude", "plan-usage-history.json"));
    }
  } catch {}

  // 2026-10 이후 자리. 패키지 이름은 설치마다 다르므로 하위 폴더를 훑는다.
  const moved = path.join(local, "Claude-Data");
  try {
    for (const n of fs.readdirSync(moved)) {
      out.push(path.join(moved, n, "plan-usage-history.json"));
    }
  } catch {}

  return out;
}

/** 후보 중 가장 최근에 쓰인 파일. 둘 다 있으면 오래된 쪽은 이미 멈춘 것이다. */
function claudeQuotaFile(file) {
  if (file) return file;
  const cands = claudeQuotaCandidates();
  let best = null;
  let bestAt = -1;
  for (const f of cands) {
    try {
      const st = fs.statSync(f);
      if (st.mtimeMs > bestAt) {
        bestAt = st.mtimeMs;
        best = f;
      }
    } catch {}
  }
  return best || cands[0];
}

function claudeQuota(file) {
  const f = claudeQuotaFile(file);
  try {
    const raw = fs.readFileSync(f, "utf8");
    const j = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    const s = Array.isArray(j.samples) ? j.samples : [];
    // 가장 최근 것. 파일이 시간순이라도 믿지 않고 직접 고른다.
    let last = null;
    for (const x of s) if (x && typeof x.t === "number" && (!last || x.t > last.t)) last = x;
    if (!last || !last.u) return null;
    const pct = (v) => (typeof v === "number" && v >= 0 && v <= 100 ? v : null);
    const block = pct(last.u.fh);
    const week = pct(last.u.sd);
    if (block == null && week == null) return null;

    /*
     * 나이는 "쓴 시각" 이 아니라 "값이 마지막으로 바뀐 시각" 으로 잰다.
     *
     * 앱은 15분마다 파일을 쓰지만 값은 사용량 메뉴를 열 때만 새로 받아온다.
     * 실제로 fh·sd 가 3시간 반 동안 같은 값으로 얼어 있다가 메뉴를 연 순간
     * 한꺼번에 뛰었다. 쓴 시각으로 재면 "4분 전 값" 이라고 말하면서 3시간
     * 묵은 값을 막대로 그리게 된다.
     */
    let changedAt = last.t;
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1],
        b = s[i];
      if (!a || !a.u || !b || !b.u) continue;
      if (a.u.fh !== b.u.fh || a.u.sd !== b.u.sd) {
        changedAt = b.t;
        break;
      }
    }
    const ageMs = Date.now() - changedAt;
    return { block, week, at: changedAt, writtenAt: last.t, ageMs };
  } catch {
    return null; // 데스크톱 앱을 안 쓰거나 아직 기록이 없다
  }
}

/**
 * 도구별 5시간 블록·주간.
 *
 * 전체 합산만 보여주면 "이 한도가 어느 도구 것인지" 알 수가 없다.
 * 도구마다 한도가 따로 있으므로 집계도 따로 내야 한다.
 *
 * limits 는 사용자가 설정에 적어 넣은 한도값이다 — 없으면 퍼센트를 내지 않는다.
 * 우리가 아는 한도는 Codex 주간(제공자 제공)뿐이고, 나머지는 모른다.
 */
function perSource(usage, now, limits = {}, files = {}) {
  const events = usage.events || [];
  const ids = [...new Set(events.map((e) => e.src))];
  const out = {};
  for (const id of ids) {
    const mine = events.filter((e) => e.src === id);
    const block = currentBlock(mine, now);
    const lim = limits[id] || {};
    /*
     * 제공자가 알려준 사용률.
     *
     * 전에는 이 퍼센트로 한도(토큰)를 역산했는데 Codex 에서 틀렸다.
     * opencodex 는 제공자별로 창을 따로 세는데(캐시의 customWindows) 우리가
     * 세는 토큰은 전부 합친 값이라, 분자와 분모가 다른 걸 재고 있었다.
     * 퍼센트가 토큰 수에 비례한다는 보장도 없다.
     *
     * 그래서 역산하지 않고 알려준 퍼센트를 그대로 쓴다.
     */
    const off = officialOf(usage, id, now, files);
    // 리셋 요일을 알면 그 창으로 센다. 모르면 롤링 7일 —
    // 둘은 다른 값이므로 화면에도 어느 쪽인지 밝힌다.
    const wk =
      lim.resetDay != null
        ? anchoredWeek(mine, now, lim.resetDay, lim.resetHour ?? 0)
        : { used: rollingWeek(mine, now).used, from: now - WEEK, resetAt: null };
    /*
     * 공식 창이 있으면 그 창으로 센다.
     *
     * 우리가 재구성한 5시간 창은 "쉬었다 다시 시작한 지점"에서 열리는데,
     * 제공자의 창은 고정된 시각에 리셋된다. 한도를 제공자 기준으로 구했으면
     * 사용량도 같은 창으로 재야 분자와 분모가 맞는다.
     */
    const week = wk.used;

    /*
     * 남은 비율은 세 가지에서 나온다. 앞선 것이 이긴다.
     *   1) 제공자가 알려준 값 — 단, 묵지 않았을 때만
     *   2) 사용자가 설정에 적어 넣은 한도
     *   3) 없음 — 쓴 양만 보여준다
     *
     * 묵은 공식값으로 막대를 그리지 않는다. 그 뒤로 쓴 게 반영 안 된
     * 값이라 지금 몇 %인지는 모르는 것이다.
     */
    /*
     * 묵었는지는 창마다 따로 재야 한다.
     *
     * 5M 하나로 재다가 주간 막대가 억울하게 사라졌다. 재 보니 주간은 1%가
     * 약 180M인데 15.9M 흘렀다고 숨기고 있었다 — 창의 0.09%다. 반대로
     * 5시간은 1%가 약 1.8M이라 같은 15.9M이면 벌써 9% 어긋난 값이다.
     *
     * 그래서 "그 창에서 1%가 몇 토큰인지"로 환산해 2%까지만 봐준다.
     * 공식 퍼센트가 0이거나 우리가 잰 게 없으면 환산을 못 하므로,
     * 그때만 예전처럼 고정값으로 재고 넘어간다.
     */
    const driftOk = (usedInWindow, pctUsed) => {
      if (!off) return false;
      if (!(pctUsed > 0) || !(usedInWindow > 0)) return off.drift <= DRIFT_TOKENS;
      return off.drift <= Math.max(DRIFT_TOKENS, 2 * (usedInWindow / pctUsed));
    };
    /*
     * 공식값이 찍힌 뒤에 창이 리셋됐다면, 그 값은 끝난 창의 것이다.
     * 드리프트로도 대개 걸러지지만 이건 추정이 아니라 사실이라 따로 본다.
     */
    const resetAfterSample =
      off && off.blockResetAt && off.at < off.blockResetAt && off.blockResetAt <= now
        ? off.blockResetAt
        : null;
    const blockFresh =
      off && off.block != null && !resetAfterSample && driftOk(block ? block.used : 0, off.block);
    const weekFresh = off && off.week != null && driftOk(week, off.week);
    const blockPct = blockFresh ? 100 - off.block : null;
    const weekPct = weekFresh ? 100 - off.week : null;

    out[id] = {
      block,
      week,
      weekFrom: wk.from,
      weekResetAt: off && off.weekResetAt ? off.weekResetAt : wk.resetAt,
      weekAnchored: lim.resetDay != null,
      blockLimit: lim.block || null,
      weekLimit: lim.week || null,
      blockLeftPct: blockPct ?? (lim.block && block ? pctLeft(block.used, lim.block) : null),
      weekLeftPct: weekPct ?? (lim.week ? pctLeft(week, lim.week) : null),
      /*
       * 출처는 창마다 따로 적는다.
       *
       * 하나로 뭉뚱그렸더니 화면이 모순된 말을 했다 — 주간은 공식값 82%
       * 막대를 그리면서 옆에는 직접 넣은 한도로 "583.9M / 18.79B"(=97%) 라고
       * 적혀 있었다. 5시간도 공식값이 없는데 옛 수동 한도로 막대가 떴다.
       * 어느 숫자가 어디서 왔는지는 창 단위로 갈린다.
       */
      blockFrom: blockPct != null ? "공식 값" : lim.block && block ? "직접 넣은 값" : null,
      weekFrom: weekPct != null ? "공식 값" : lim.week ? "직접 넣은 값" : null,
      /*
       * 공식값이 언제 찍힌 값인지.
       *
       * Claude 앱은 15분마다 한 줄씩 쓴다. 그래서 앱 메뉴가 보여주는 실시간
       * 값과 최대 15분까지 벌어진다. 우리 토큰 측정으로 그 사이를 메워 볼까
       * 했지만 1%당 토큰이 261K~2.0M로 139% 흩어져서(모델별 가중치로 보인다)
       * 보간이 불가능했다. 메울 수 없으면 얼마나 오래된 값인지라도 밝힌다.
       */
      officialAgeMs: blockPct != null || weekPct != null ? off.ageMs : null,
      // 묵어서 막대를 못 그린 경우에도 무엇이 있었는지는 알려준다
      /*
       * 묵어서 막대를 못 그린 경우에도 무엇이 있었는지는 알려준다.
       *
       * 막대가 조용히 사라지면 "고장났나"가 된다. 실제로 그렇게 물어 왔다.
       * 창마다 사정이 다르므로 따로 넘긴다.
       */
      officialStale: off && off.week != null && !weekFresh ? off : null,
      officialBlockStale: off && off.block != null && !blockFresh ? off : null,
      // 추정이 아니라 로그에 적힌 사실이다 — 그 창은 이 시각에 리셋됐다
      officialBlockResetAt: resetAfterSample,
    };
  }
  return out;
}

const pctLeft = (used, limit) =>
  Math.max(0, Math.min(100, Math.round(((limit - used) / limit) * 100)));

/**
 * Codex 공식 한도 — 캐시와 로그 중 더 최신인 쪽.
 *
 * 출처가 둘이다.
 *   1) opencodex 캐시  주간만 있다. opencodex 가 갱신할 때만 바뀐다
 *   2) Codex 세션 로그  5시간·주간 둘 다. 응답에 붙어 온 값 그대로다
 *
 * 둘 다 "제공자가 알려준 값"이지만 시점이 다르다. 오래된 쪽을 보여주면
 * 실제로 틀린 숫자가 최신처럼 보인다 — 4시간 45분 묵은 값 때문에
 * 겪었던 일이다. 그래서 더 최신인 쪽을 고르고, 어디서 왔는지와
 * 얼마나 묵었는지를 함께 넘긴다.
 */
function codexOfficial(usage, now, file) {
  const cache = codexQuota(file);
  const log = (usage.quota || {}).codex || null;

  const out = [];
  if (cache) {
    out.push({
      at: cache.updatedAt,
      from: "opencodex",
      block: null,
      // 캐시에는 창 길이가 안 적혀 있다. 주간 쿼터이므로 7일로 둔다.
      week: { percent: cache.percent, resetAt: cache.resetAt, windowMinutes: 10080 },
    });
  }
  if (log && (log.block || log.week)) {
    out.push({ at: log.at, from: "Codex 로그", block: log.block, week: log.week });
  }
  if (!out.length) return null;

  for (const o of out) {
    o.ageMs = now - o.at;
    /*
     * 묵은 값은 막대로 그리지 않는다.
     *
     * 21시간 전 "0% 사용"을 꽉 찬 막대로 그린 적이 있다. 틀린 값은 아니었지만
     * 그 뒤로 쓴 건 하나도 반영이 안 된 값이라, 화면은 "여유 만땅"이라고
     * 말하고 있었다. 모르는 값으로 %를 만들지 않는다는 원칙은 오래된 값에도
     * 똑같이 적용된다 — 지금 몇 %인지는 모르는 것이다.
     */
    o.stale = o.ageMs > 3600000;
  }
  out.sort((a, b) => b.at - a.at); // 최신 먼저

  /*
   * 출처가 둘인데 값이 크게 갈리면 고르지 않는다.
   *
   * opencodex 는 프록시가 붙는 제공자를, Codex 로그는 ChatGPT 계정을 본다.
   * 서로 다른 한도를 재고 있을 수 있어서 "더 최신"이라는 이유로 하나를
   * 고르면 엉뚱한 쪽을 보여주게 된다. 둘 다 내보내고 출처를 밝힌다.
   */
  return out;
}

/**
 * 도구의 공식 사용률. 출처가 도구마다 다르다.
 *
 *   claude : 데스크톱 앱이 적어 두는 plan-usage-history.json (15분마다 갱신)
 *   codex  : 세션 로그의 rate_limits, 없으면 opencodex 캐시
 */
/**
 * 공식값이 묵었는지 판정한다.
 *
 * 시간으로만 재면 틀린다. 제공자 값은 우리가 쓸 때만 움직이므로,
 * 쉬고 있었다면 세 시간 된 값도 여전히 정확하다. 반대로 값이 멈춘 사이
 * 많이 썼다면 10분 된 값도 이미 틀리다.
 *
 * 그래서 시간이 아니라 **값이 바뀐 뒤 우리가 잰 토큰**으로 잰다.
 * 1%가 대략 0.5~2M 이므로 5M을 넘으면 몇 % 는 이미 어긋나 있다.
 */
const DRIFT_TOKENS = 5_000_000;

function driftSince(usage, id, at) {
  let n = 0;
  for (const e of usage.events || []) if (e.src === id && e.t > at) n += e.n;
  return n;
}

function officialOf(usage, id, now, files = {}) {
  if (id === "claude") {
    /*
     * 두 출처가 있다. 데스크톱 앱 파일은 앱이 시작할 때나 한도에 막혔을 때만
     * 쓰이므로 몇 시간씩 묵는다. clanker-usage 는 데몬이 돌면 실시간이다.
     * 더 최근에 찍힌 쪽을 쓴다.
     */
    const live = clankerUsage("claude", files.claudeLive);
    const file0 = claudeQuota(files.claude);
    const q = live && (!file0 || live.at > file0.at) ? live : file0;
    if (!q) return null;
    const drift = driftSince(usage, "claude", q.at);
    /*
     * 로그에서 건진 한도 거부 기록을 붙인다.
     *
     * 데스크톱 앱 파일에는 "몇 %" 는 있어도 "그 창이 언제 리셋되는지" 가 없다.
     * 그게 없으면 100% 라는 값이 지금 창의 것인지 이미 끝난 창의 것인지
     * 구별할 수 없다. 로그의 거부 기록에는 resetsAt 이 들어 있다.
     */
    const hit = (usage.quota || {}).claude || {};
    return {
      ...q,
      drift,
      blockHitAt: hit.blockHitAt ?? null,
      blockResetAt: hit.blockResetAt ?? null,
    };
  }
  if (id !== "codex") return null;
  const list = codexOfficial(usage, now, files.codex);
  if (!list || !list.length) return null;
  const o = list[0]; // 최신 먼저 정렬돼 있다
  const drift = driftSince(usage, "codex", o.at);
  return {
    drift,
    block: o.block ? o.block.percent : null,
    week: o.week ? o.week.percent : null,
    weekResetAt: o.week ? o.week.resetAt : null,
    at: o.at,
    ageMs: o.ageMs,
    from: o.from,
  };
}

/**
 * 공식 퍼센트를 보정점 삼아 한도(토큰)를 역산한다.
 *
 * 제공자는 "몇 % 썼다"만 알려주고 한도가 몇 토큰인지는 말해주지 않는다.
 * 그런데 그 시점에 우리가 잰 사용량을 알고 있으니 분모를 되돌릴 수 있다:
 *
 *   한도 = 그때까지 쓴 양 / (그때 퍼센트 / 100)
 *
 * 한도는 상수다. 한 번 구해 두면 그 뒤로는 우리 측정만으로 지금 퍼센트를
 * 낼 수 있다 — 공식값이 하루쯤 묵어도 막대는 계속 살아 있다.
 * 사용자가 설정에서 손으로 넣는 것과 같은 계산이고, 다만 자동이다.
 */
function limitFromOfficial(events, w, at) {
  if (!w || !w.percent || w.percent <= 0 || !w.resetAt || !w.windowMinutes) return null;
  const winMs = w.windowMinutes * 60000;
  // 그 값이 찍힌 시점에 열려 있던 창
  let start = w.resetAt - winMs;
  while (start > at) start -= winMs; // 리셋이 여러 번 지났으면 되감는다
  let usedThen = 0;
  for (const e of events) if (e.t >= start && e.t <= at) usedThen += e.n;
  if (!usedThen) return null;
  return Math.round(usedThen / (w.percent / 100));
}

/** 지금 열려 있는 창의 사용량. resetAt 이 지났으면 다음 창으로 넘어간다. */
function windowUsage(events, w, now) {
  if (!w || !w.windowMinutes || !w.resetAt) return null;
  const winMs = w.windowMinutes * 60000;
  let reset = w.resetAt;
  while (reset <= now) reset += winMs;
  const start = reset - winMs;
  let used = 0;
  for (const e of events) if (e.t >= start) used += e.n;
  return { used, start, resetAt: reset };
}

/**
 * 도구의 한도를 공식값에서 자동으로 구한다.
 *
 * 출처가 여럿이면 퍼센트가 0이 아닌 것 중 가장 최근 것을 쓴다.
 * 0% 로는 나눌 수가 없고, 0% 는 애초에 보정에 쓸 정보가 없는 값이다.
 */
function autoLimits(usage, id, now) {
  const src = codexOfficial(usage, now);
  if (id !== "codex" || !src) return null;
  const events = (usage.events || []).filter((e) => e.src === id);
  const out = {};
  for (const key of ["block", "week"]) {
    for (const o of src) {
      const lim = limitFromOfficial(events, o[key], o.at);
      if (lim) {
        out[key] = { limit: lim, from: o.from, at: o.at, ...windowUsage(events, o[key], now) };
        break;
      }
    }
  }
  return Object.keys(out).length ? out : null;
}

function summarize(usage, now = Date.now(), limits = {}, files = {}) {
  const events = usage.events || [];
  return {
    block: currentBlock(events, now),
    week: rollingWeek(events, now),
    codex: codexQuota(files.codex),
    perSource: perSource(usage, now, limits, files),
    now,
  };
}

/**
 * 쿼터 파일 상태. 설정 화면에서 "이 파일을 보고 있고 읽히는가"를 보여준다.
 *
 * 경로만 적어두면 오타를 알아챌 방법이 없다. 읽혔는지, 값이 언제 것인지까지 돌려준다.
 */
function diagnoseQuota(usage, files = {}) {
  const now = Date.now();
  const rows = [];
  const push = (id, label, file, q) =>
    rows.push({
      id,
      label,
      path: file,
      ok: Boolean(q),
      ageMs: q ? now - (q.at ?? q.updatedAt) : null,
      detail: q
        ? [q.block != null ? "5시간 " + q.block + "%" : null, q.week != null ? "주간 " + q.week + "%" : null]
            .filter(Boolean)
            .join(" · ")
        : null,
    });

  const cf = claudeQuotaFile(files.claude);
  push("claude", "Claude 사용률 (데스크톱 앱)", cf, claudeQuota(files.claude));

  // 깔려 있으면 실시간이다. 없으면 "없음"으로 보이는 게 맞다 — 안내가 거기 붙는다.
  for (const id of ["claude", "codex"]) {
    const live = clankerUsage(id);
    push(
      id,
      (id === "claude" ? "Claude" : "Codex") + " 사용률 (clanker-usage)",
      live ? live.path : path.join(os.homedir(), ".cache", "clanker-usage", id === "claude" ? "claude-code" : "codex", "<계정>.json"),
      live,
    );
  }

  const kf = files.codex || path.join(os.homedir(), ".opencodex", "codex-quota-cache.json");
  const c = codexQuota(files.codex);
  push("codex", "Codex 쿼터 (opencodex)", kf, c ? { week: c.percent, updatedAt: c.updatedAt } : null);

  // 로그에 섞여 오는 Codex 한도는 파일이 아니라 세션 로그에서 온다
  const lg = (usage.quota || {}).codex;
  rows.push({
    id: "codex",
    label: "Codex 한도 (세션 로그)",
    path: "세션 로그 안에 포함",
    ok: Boolean(lg),
    ageMs: lg ? now - lg.at : null,
    detail: lg
      ? [lg.block ? "5시간 " + lg.block.percent + "%" : null, lg.week ? "주간 " + lg.week.percent + "%" : null]
          .filter(Boolean)
          .join(" · ")
      : null,
  });
  return rows;
}

module.exports = { FIVE_HOURS, fiveHourBlocks, currentBlock, rollingWeek, anchoredWeek, codexQuota, claudeQuota, claudeQuotaFile, clankerUsage, codexOfficial, officialOf, perSource, summarize, diagnoseQuota };

// node src/main/limits.js 로 확인
if (require.main === module) {
  const usage = require("./usage").collect();
  const s = summarize(usage);
  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : (n / 1e3).toFixed(1) + "K");
  const hm = (ms) => Math.floor(ms / 3600000) + "시간 " + Math.floor((ms % 3600000) / 60000) + "분";

  console.log("기록 " + usage.events.length.toLocaleString() + "건\n");

  console.log("── 현재 5시간 창 ──");
  if (!s.block) console.log("  열린 창 없음 (5시간 이상 쉬는 중)");
  else {
    console.log("  시작   " + new Date(s.block.start).toLocaleString("ko-KR"));
    console.log("  사용   " + fmt(s.block.used) + "  (" + s.block.count + "건)");
    console.log("  남음   " + hm(s.block.remainingMs));
    console.log("  속도   " + fmt(s.block.perHour) + "/시간");
  }

  console.log("\n── 최근 7일 ──");
  console.log("  " + fmt(s.week.used));
  for (const [k, v] of s.week.bySource) console.log("    " + k.padEnd(8) + fmt(v));

  console.log("\n── Codex 주간 한도 (opencodex 캐시) ──");
  if (!s.codex) console.log("  캐시 없음");
  else {
    console.log("  " + s.codex.percent + "% 사용" + (s.codex.stale ? "  ⚠️ 오래된 값" : ""));
    console.log("  리셋까지 " + hm(s.codex.resetAt - Date.now()));
  }

  console.log("\n── 최근 5시간 창 5개 ──");
  for (const b of fiveHourBlocks(usage.events).slice(-5)) {
    console.log(
      "  " + new Date(b.start).toLocaleString("ko-KR").padEnd(24) +
        fmt(b.used).padStart(8) + "  " + b.count + "건",
    );
  }
}
