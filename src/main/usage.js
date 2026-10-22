"use strict";
/**
 * AI 코딩 도구의 로컬 로그에서 토큰 사용량을 읽는다.
 *
 * 네트워크를 쓰지 않는다. 이 파일들은 이미 디스크에 있다.
 *
 * ── 도구를 추가하려면 ──
 * SOURCES에 { id, label, dir, ext, read } 를 넣는다.
 * read(text, add) 는 파일 내용을 받아 add(일자, 토큰수, 중복키) 를 호출한다.
 *
 * ⚠️ 로그에 토큰이 실제로 있는지 먼저 확인하고 추가한다.
 *    scripts/probe-formats.mjs 로 확인할 수 있다.
 *    없는 값을 추정해 채우면 게임 전체가 틀린 숫자 위에 선다.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOME = os.homedir();

/* ------------------------------------------------------------------
   Claude Code — ~/.claude/projects/ ** /*.jsonl
   assistant 레코드의 message.usage 에 토큰이 들어있다.
   ------------------------------------------------------------------ */
/**
 * Claude Code 로그에 섞여 오는 한도 거부 기록.
 *
 *   { status: "rejected", rateLimitType: "five_hour"|"seven_day",
 *     resetsAt: <초>, ... }
 *
 * status 는 지금까지 rejected 밖에 없었다 — 막혔을 때만 적힌다. 그래서
 * 퍼센트는 못 얻지만 두 가지를 확실히 얻는다: 그 순간 100% 였다는 것과,
 * 그 창이 언제 리셋되는지. 리셋 시각은 데스크톱 앱 파일에는 없는 정보다.
 * 그게 있어야 "100% 라는 옛 값이 지금 창의 것인지"를 판정할 수 있다.
 */
function pickLimitHit(o) {
  const find = (x, d = 0) => {
    if (!x || typeof x !== "object" || d > 6) return null;
    if (x.rateLimitType && x.status && typeof x.resetsAt === "number") return x;
    for (const v of Object.values(x)) {
      const r = find(v, d + 1);
      if (r) return r;
    }
    return null;
  };
  return find(o);
}

function readClaude(text, add, note) {
  for (const line of text.split("\n")) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // 마지막 줄이 잘려 있는 건 정상이다 (계속 쓰이는 파일)
    }
    /*
     * 한도 거부는 assistant 메시지가 아니라 오류 쪽에 실려 온다.
     * 토큰 집계보다 먼저 본다 — continue 아래로 내려가면 못 본다.
     */
    if (note && line.includes("rateLimitType")) {
      const h = pickLimitHit(o);
      if (h && h.status === "rejected") {
        const at = Date.parse(o.timestamp);
        if (Number.isFinite(at)) {
          /*
           * 퍼센트로 바꾸지 않는다.
           *
           * "거부당했으니 그 창을 100% 썼다"고 적어 봤는데 값이 서로 어긋났다.
           * 주간 거부가 10/23까지 유효한데 데스크톱 앱은 주간 16% 사용이라고
           * 한다. 둘 다 맞다면 그 거부는 전체 주간 한도가 아니라 모델별
           * 한도(거부 기록의 모델은 전부 opus 였다)다. 어느 쪽인지 모르는 채로
           * 막대를 그리면 또 틀린 값을 보여주게 된다.
           *
           * 확실한 것만 남긴다 — 언제 막혔고, 그 창이 언제 리셋되는지.
           */
          const five = h.rateLimitType === "five_hour";
          note({
            at,
            hit: true,
            blockHitAt: five ? at : null,
            blockResetAt: five ? h.resetsAt * 1000 : null,
            weekHitAt: five ? null : at,
            weekResetAt: five ? null : h.resetsAt * 1000,
          });
        }
      }
    }
    if (o.type !== "assistant") continue;
    const u = o.message && o.message.usage;
    if (!u) continue;
    const parts = {
      in: u.input_tokens ?? 0,
      out: u.output_tokens ?? 0,
      cacheW: u.cache_creation_input_tokens ?? 0,
      cacheR: u.cache_read_input_tokens ?? 0,
    };
    const n = parts.in + parts.out + parts.cacheW + parts.cacheR;
    if (n) add(o.timestamp, n, o.requestId || o.uuid, parts);
  }
}

/* ------------------------------------------------------------------
   Codex — ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
   type: "token_usage_record" 의 payload.usage 가 응답 1건의 사용량이다.

   payload.info.total_token_usage 라는 누적값도 같이 흐르는데 그건 쓰지 않는다.
   세션 누계라서 더하면 같은 토큰을 수십 번 세게 된다.
   total_tokens 는 input + output 이고 cached 는 input의 부분집합이다.
   ------------------------------------------------------------------ */
/**
 * Codex 로그에 섞여 있는 공식 한도.
 *
 * 응답에 rate_limits 가 붙어 온다. 대부분 null 이지만 값이 채워진 것도 있고,
 * 그건 제공자가 알려준 사실이다 — 우리가 계산한 게 아니다.
 *
 *   primary    창 300분   = 5시간 한도
 *   secondary  창 10080분 = 주간 한도
 *
 * opencodex 캐시(codex-quota-cache.json)보다 나은 점이 둘 있다.
 * 5시간 창도 들어 있고, 어느 시각의 값인지 기록에 그대로 남아 있다.
 */
function pickRateLimits(o) {
  const find = (x, d = 0) => {
    if (!x || typeof x !== "object" || d > 6) return null;
    if (x.rate_limits && (x.rate_limits.primary || x.rate_limits.secondary)) return x.rate_limits;
    for (const v of Object.values(x)) {
      const r = find(v, d + 1);
      if (r) return r;
    }
    return null;
  };
  return find(o);
}

const rlWindow = (w) =>
  w && typeof w.used_percent === "number"
    ? {
        percent: w.used_percent,
        windowMinutes: w.window_minutes ?? null,
        resetAt: w.resets_at ? w.resets_at * 1000 : null,
      }
    : null;

function readCodex(text, add, note) {
  // 한도가 붙은 줄만 먼저 훑는다. 값이 없는 파일이 대부분이라 문자열로 먼저 거른다.
  if (note && text.includes('"used_percent"')) {
    for (const line of text.split("\n")) {
      if (!line.includes("used_percent")) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const rl = pickRateLimits(o);
      const t = Date.parse(o.timestamp);
      if (rl && Number.isFinite(t)) {
        note({ at: t, block: rlWindow(rl.primary), week: rlWindow(rl.secondary) });
      }
    }
  }

  /*
   * 누적치(total_token_usage)의 증가분을 센다.
   *
   * 예전에는 token_usage_record 를 셌는데 두 가지로 틀렸다.
   *   · 8월 세션 36개에는 그 레코드가 아예 없다 (82.6M을 0으로 읽었다)
   *   · 있는 파일에서도 턴을 다 덮지 못한다 (한 파일에서 2077 vs 3645건)
   *
   * 원본 앱처럼 last_token_usage(턴 델타)를 더하는 방법도 재생된 이벤트까지
   * 세서 20% 넘게 부풀려졌다. 누적치의 증가분은 재생을 자연스럽게 흡수한다 —
   * 다시 쓰인 이벤트는 누적이 안 늘어나므로 0이 된다.
   *
   * 누적이 줄면 세션이 재시작된 것이다(한 파일에서 3번까지 봤다).
   * 그때는 그 값 자체가 새 구간의 시작이므로 통째로 센다.
   *
   * 실측: 정상 파일에서 Codex 자체 누적치와 오차 0.5% 이내.
   */
  let prev = null;
  let seq = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type !== "event_msg" || !o.payload || o.payload.type !== "token_count") continue;
    const info = o.payload.info;
    if (!info || !info.total_token_usage) continue;

    const cum = total(info.total_token_usage);
    const n = prev === null || cum < prev ? cum : cum - prev;
    prev = cum;
    if (!n) continue;

    /*
     * 종류별 분해는 이번 턴(last_token_usage) 비율로 나눈다.
     * 누적치에서 빼도 되지만 재시작 구간에서 음수가 나온다.
     */
    const lu = info.last_token_usage;
    const parts = split(n, lu);
    // 한 줄에 하나씩 세므로 중복키는 줄 번호로 충분하다.
    add(o.timestamp, n, "tc:" + seq++, parts);
  }
}

/** Codex의 input_tokens는 cached를 포함한 값이다. 겹쳐 세지 않도록 빼준다. */
function total(u) {
  if (!u) return 0;
  const cached = u.cached_input_tokens ?? 0;
  return (
    u.total_tokens ??
    Math.max(0, (u.input_tokens ?? 0) - cached) +
      (u.output_tokens ?? 0) +
      (u.cache_write_input_tokens ?? 0) +
      cached
  );
}

/** n 토큰을 이번 턴의 종류별 비율로 나눈다. 비율을 모르면 입력으로 둔다. */
function split(n, lu) {
  const cached = (lu && lu.cached_input_tokens) ?? 0;
  const p = {
    in: Math.max(0, ((lu && lu.input_tokens) ?? 0) - cached),
    out: (lu && lu.output_tokens) ?? 0,
    cacheW: (lu && lu.cache_write_input_tokens) ?? 0,
    cacheR: cached,
  };
  const sum = p.in + p.out + p.cacheW + p.cacheR;
  if (!sum) return { in: n, out: 0, cacheW: 0, cacheR: 0 };
  const k = n / sum;
  return { in: Math.round(p.in * k), out: Math.round(p.out * k), cacheW: Math.round(p.cacheW * k), cacheR: Math.round(p.cacheR * k) };
}

/**
 * 읽을 로그들.
 *
 * Gemini·Copilot 은 여기 없다 — 넣을 수 없어서가 아니라 **토큰이 안 남아서**다.
 *   Gemini  : Antigravity 로그(jsonl·sqlite) 어디에도 토큰 수가 없다.
 *             Gemini CLI(~/.gemini/tmp/ ** /chats)는 토큰을 남기지만 미설치.
 *   Copilot : ~/.copilot 전체에 토큰 숫자 필드가 없다.
 * 둘 다 설치·기록이 생기면 read 함수만 붙이면 된다.
 */
/**
 * Claude 로그가 있을 수 있는 모든 곳.
 *
 * 한 곳만 보면 환경에 따라 통째로 놓친다.
 *   · CLAUDE_CONFIG_DIR   설정 위치를 옮긴 경우. 콤마로 여러 개를 줄 수 있다
 *   · ~/.config/claude    XDG 스타일 설치
 *   · ~/.claude           기본
 *   · 임베디드 세션       데스크톱 앱이 세션마다 제 .claude/projects 를 갖는다.
 *                        <store>/<uuid>/<uuid>/local_<uuid>/.claude/projects 처럼
 *                        UUID 단계가 여러 겹이라 고정 경로로는 못 잡고 찾아야 한다.
 */
function claudeRoots(extra = []) {
  const roots = [...extra];
  const env = process.env.CLAUDE_CONFIG_DIR;
  if (env) for (const p of env.split(",")) if (p.trim()) roots.push(path.join(p.trim(), "projects"));
  roots.push(path.join(HOME, ".config", "claude", "projects"));
  roots.push(path.join(HOME, ".claude", "projects"));
  for (const store of ["local-agent-mode-sessions", "claude-code-sessions"]) {
    roots.push(...findEmbedded(path.join(HOME, ".claude", store)));
  }
  return roots;
}

/** <base> 아래에서 `.claude/projects` 디렉터리를 찾는다. `.claude` 는 숨김이라 건너뛰면 안 된다. */
function findEmbedded(base, depth = 0, out = []) {
  if (depth > 7) return out;
  let entries;
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(base, e.name);
    if (e.name === "projects" && path.basename(base) === ".claude") out.push(p);
    else findEmbedded(p, depth + 1, out);
  }
  return out;
}

/** Codex 로그. 보관된 세션도 실제로 쓴 토큰이므로 같이 센다. */
function codexRoots(extra = []) {
  const home = process.env.CODEX_HOME || path.join(HOME, ".codex");
  return [...extra, path.join(home, "sessions"), path.join(home, "archived_sessions")];
}

/**
 * opencodex 프록시가 요청마다 남기는 기록.
 *
 * Codex 사용량이 두 군데로 갈린다. CLI 가 직접 쓰면 ~/.codex/sessions 에
 * 남지만, 프록시를 통해 쓰면 거기엔 한 줄도 안 남고 여기에만 남는다.
 * 실제로 그래서 GPT 를 하루 종일 쓰고도 화면에는 0 이 떠 있었다.
 *
 * 한 줄에 요청 하나다:
 *   { requestId, timestamp, model, usage: { inputTokens, outputTokens,
 *     totalTokens, cachedInputTokens, cacheReadInputTokens, ... } }
 *
 * 돌려주는 값은 이 기록들의 시각 목록이다 — 세션 로그에서 같은 요청을
 * 또 세지 않으려면 어느 시각에 프록시 기록이 있는지 알아야 한다.
 */
function readOpenCodex(add) {
  const f = path.join(HOME, ".opencodex", "usage.jsonl");
  let st;
  try {
    st = fs.statSync(f);
  } catch {
    return []; // 프록시를 안 쓰는 구성이다
  }

  const key = "opencodex:" + f;
  const hit = fileCache.get(key);
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) {
    for (const r of hit.rows) add(r.iso, r.n, r.id, r.parts);
    return hit.ts;
  }

  let text;
  try {
    text = fs.readFileSync(f, "utf8");
  } catch {
    return [];
  }

  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue; // 쓰는 중인 마지막 줄은 잘려 있을 수 있다
    }
    const u = j.usage || {};
    const n = j.totalTokens ?? u.totalTokens ?? 0;
    if (!(n > 0) || !Number.isFinite(j.timestamp)) continue;
    const cached = u.cachedInputTokens || 0;
    rows.push({
      iso: new Date(j.timestamp).toISOString(),
      n,
      id: j.requestId || String(j.timestamp),
      parts: {
        // inputTokens 에는 캐시분이 포함돼 있다. 빼지 않으면 합이 두 번 잡힌다.
        in: Math.max(0, (u.inputTokens || 0) - cached),
        out: u.outputTokens || 0,
        cacheW: u.cacheCreationInputTokens || 0,
        cacheR: u.cacheReadInputTokens || cached,
      },
    });
  }

  const ts = rows.map((r) => Date.parse(r.iso)).sort((a, b) => a - b);
  fileCache.set(key, { mtime: st.mtimeMs, size: st.size, rows, ts });
  for (const r of rows) add(r.iso, r.n, r.id, r.parts);
  return ts;
}

/**
 * 정렬된 시각 목록에 t 와 가까운 게 있는가.
 *
 * 창을 10초로 잡았더니 같은 요청을 두 번 셌다. 프록시는 요청을 보낸 시각을,
 * 세션 로그는 응답이 끝난 시각을 적는데 한 요청이 25초씩 걸린다. 창을 넓혀
 * 가며 재 보니 2분부터 이중 집계가 0으로 떨어지고 그 뒤로는 더 넓혀도 값이
 * 안 변한다 — 프록시 이전 기록은 그대로 남는다.
 */
function nearTester(sorted, windowMs = 180_000) {
  return (t) => {
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (Math.abs(sorted[m] - t) <= windowMs) return true;
      if (sorted[m] < t) lo = m + 1;
      else hi = m - 1;
    }
    return false;
  };
}

const SOURCES = [
  { id: "claude", label: "Claude Code", dirs: claudeRoots, ext: ".jsonl", read: readClaude },
  { id: "codex", label: "Codex", dirs: codexRoots, ext: ".jsonl", read: readCodex },
];

function walk(dir, ext, out = [], depth = 0) {
  if (depth > 10) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // 폴더가 없으면 그 도구를 안 쓰는 것뿐이다
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out, depth + 1);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

/** 로컬 날짜 'YYYY-MM-DD'. 로그의 timestamp는 UTC라 하루가 밀릴 수 있어 맞춰준다. */
function localDay(d = new Date()) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/** UTC 타임스탬프 → 로컬 날짜 */
function dayOf(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? localDay(new Date(t)) : String(iso).slice(0, 10);
}

/**
 * 파일별 파싱 결과 캐시. 프로세스가 살아 있는 동안만 유지된다.
 *
 * 디스크에 쓰지 않는다 — 로그가 원본이고, 앱을 다시 켜면 다시 읽으면 된다.
 * 캐시가 틀릴 위험보다 첫 스캔 한 번이 느린 쪽이 낫다.
 */
const fileCache = new Map();

/**
 * 사용자가 설정에서 더해 준 경로를 앞에 끼워 넣는다.
 *
 * 기본 경로를 없애지는 않는다. "여기도 봐 줘"이지 "여기만 봐"가 아니다 —
 * 잘못 지정하면 멀쩡히 읽히던 게 통째로 사라지는 쪽이 더 나쁘다.
 */
function collect(extraRoots = {}) {
  const byDay = new Map();
  const bySource = new Map();
  // 도구별 토큰 종류 분해. 합계만 보면 캐시 때문에 커진 건지 알 수 없다.
  const detail = new Map();
  // 개별 사용 기록. 5시간 창·번레이트는 일자 합계로는 계산할 수 없다.
  const events = [];
  // 로그에 섞여 있는 공식 한도 (도구별로 가장 최근 것)
  const quota = {};
  let total = 0;
  let files = 0;

  for (const src of SOURCES) {
    /*
     * 여러 루트를 훑되 같은 파일을 두 번 세지 않는다.
     * ~/.config/claude 가 ~/.claude 로 걸린 심볼릭 링크인 구성이 흔하다.
     */
    const seenPath = new Set();
    const paths = [];
    for (const root of src.dirs(extraRoots[src.id] || [])) {
      let real;
      try {
        real = fs.realpathSync(root);
      } catch {
        continue; // 없는 경로는 그 구성을 안 쓴다는 뜻이다
      }
      if (seenPath.has(real)) continue;
      seenPath.add(real);
      for (const p of walk(real, src.ext)) if (!seenPath.has(p)) (seenPath.add(p), paths.push(p));
    }
    files += paths.length;
    let srcTotal = 0;
    const seen = new Set(); // 중복 레코드 방지 (재시도·세션 재개)
    /*
     * 프록시를 거친 요청은 세션 로그와 프록시 기록 양쪽에 남는다.
     * 둘 다 세면 그 구간이 두 배가 된다 — 재 보니 세션 로그의 48%가
     * 프록시 기록과 ±2초 안에 겹쳤다. 프록시 쪽을 먼저 넣고,
     * 세션 로그에서 같은 시각의 기록은 건너뛴다.
     */
    let suppress = null;

    /**
     * 파서가 찾은 공식 한도 중 가장 최근 것만 남긴다.
     * 오래된 값이 새 값을 덮어쓰면 화면이 거꾸로 간다.
     */
    const note = (q) => {
      if (!q || (!q.block && !q.week && !q.hit)) return;
      const cur = quota[src.id];
      if (!cur) {
        quota[src.id] = { ...q, blockAt: q.block != null ? q.at : null, weekAt: q.week != null ? q.at : null };
        return;
      }
      /*
       * 통째로 덮어쓰고 있었다. 5시간 거부 뒤에 주간 거부가 들어오면
       * 앞의 5시간 정보가 사라진다 — 두 기록은 서로 다른 창의 소식이라
       * 새 것이 옛 것을 대신할 수 없다. 창마다 따로 최신을 지킨다.
       */
      const m = { ...cur };
      if (q.at > (cur.at ?? 0)) {
        m.at = q.at;
        if (q.from) m.from = q.from;
      }
      if (q.block != null && q.at >= (cur.blockAt ?? -1)) {
        m.block = q.block;
        m.blockAt = q.at;
        if (q.blockResetAt) m.blockResetAt = q.blockResetAt;
      }
      if (q.week != null && q.at >= (cur.weekAt ?? -1)) {
        m.week = q.week;
        m.weekAt = q.at;
        if (q.weekResetAt) m.weekResetAt = q.weekResetAt;
      }
      // 한도 거부는 퍼센트와 별개로, 창마다 가장 최근 것을 지킨다
      if (q.blockHitAt && q.blockHitAt >= (cur.blockHitAt ?? -1)) {
        m.blockHitAt = q.blockHitAt;
        m.blockResetAt = q.blockResetAt;
      }
      if (q.weekHitAt && q.weekHitAt >= (cur.weekHitAt ?? -1)) {
        m.weekHitAt = q.weekHitAt;
        m.weekResetAt = q.weekResetAt;
      }
      quota[src.id] = m;
    };

    const add = (iso, n, dedupeKey, parts) => {
      if (dedupeKey) {
        const k = src.id + ":" + dedupeKey;
        if (seen.has(k)) return;
        seen.add(k);
      }
      const day = dayOf(iso);
      if (!day) return;
      const t = Date.parse(iso);
      // 프록시 기록에서 이미 센 요청이면 여기서 끝낸다 (일자 합계도 건드리지 않는다)
      if (suppress && Number.isFinite(t) && suppress(t)) return;
      byDay.set(day, (byDay.get(day) ?? 0) + n);
      if (Number.isFinite(t)) events.push({ t, n, src: src.id });
      if (parts) {
        const d = detail.get(src.id) ?? { in: 0, out: 0, cacheW: 0, cacheR: 0 };
        d.in += parts.in; d.out += parts.out; d.cacheW += parts.cacheW; d.cacheR += parts.cacheR;
        detail.set(src.id, d);
      }
      srcTotal += n;
      total += n;
    };

    if (src.id === "codex") {
      const ts = readOpenCodex(add);
      if (ts.length) {
        suppress = nearTester(ts);
        files += 1;
      }
    }

    for (const f of paths) {
      /*
       * 안 바뀐 파일은 지난번에 읽은 결과를 그대로 쓴다.
       *
       * 로그는 append-only 다. 크기와 mtime 이 같으면 다시 파싱해도 같은 값이
       * 나온다. 그런데 30초마다 109개를 전부 JSON.parse 하면 4초가 걸린다 —
       * 그중 실제로 바뀌는 건 지금 쓰고 있는 한두 개뿐이다.
       */
      let st;
      try {
        st = fs.statSync(f);
      } catch {
        continue;
      }
      const key = src.id + ":" + f;
      const hit = fileCache.get(key);
      if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) {
        for (const r of hit.rows) add(r[0], r[1], r[2], r[3]);
        if (hit.quota) note(hit.quota);
        continue;
      }

      let text;
      try {
        text = fs.readFileSync(f, "utf8");
      } catch {
        continue; // 쓰기 중인 파일일 수 있다. 다음 폴링에서 잡힌다
      }
      // 이번에 읽은 것을 캐시에 적어 둔다. add/note 를 감싸 기록만 남긴다.
      const rows = [];
      let q = null;
      try {
        src.read(
          text,
          (iso, n, k, parts) => {
            rows.push([iso, n, k, parts]);
            add(iso, n, k, parts);
          },
          (x) => {
            if (x && (!q || x.at > q.at)) q = x;
            note(x);
          },
        );
        fileCache.set(key, { mtime: st.mtimeMs, size: st.size, rows, quota: q });
      } catch {
        /* 한 파일이 깨져도 나머지는 세어야 한다 */
      }
    }
    if (srcTotal) bySource.set(src.label, { id: src.id, label: src.label, total: srcTotal });
  }

  const today = localDay();
  events.sort((a, b) => a.t - b.t);

  // 이번 주(월요일 시작)와 이번 달. 롤링이 아니라 달력 기준이다 —
  // "이번 달 얼마 썼나"는 달이 바뀌면 0부터 다시 세는 게 자연스럽다.
  const now = new Date();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const month1 = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let week = 0;
  let month = 0;
  for (const e of events) {
    if (e.t >= monday.getTime()) week += e.n;
    if (e.t >= month1) month += e.n;
  }

  // 이번 달 일별 (그래프용). 빈 날도 0으로 채워 막대 간격이 일정하게.
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthly = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const key = localDay(new Date(now.getFullYear(), now.getMonth(), d));
    monthly.push({ day: d, key, n: byDay.get(key) ?? 0 });
  }

  return {
    total,
    today: byDay.get(today) ?? 0,
    week,
    month,
    monthly,
    days: [...byDay.entries()].sort(),
    sources: [...bySource.values()]
      .map((s) => ({ ...s, detail: detail.get(s.id) ?? null }))
      .sort((a, b) => b.total - a.total),
    events,
    // 로그에서 주운 공식 한도. 없으면 빈 객체 — 지어내지 않는다.
    quota,
    fileCount: files,
    scannedAt: Date.now(),
  };
}

/**
 * 경로별 상태. 설정 화면에서 "여기를 보고 있고, 몇 개가 잡혔다"를 보여준다.
 *
 * 경로가 틀렸는지 아닌지는 화면에 나오기 전엔 알 수가 없다.
 * 폴더는 있는데 파일이 0개인 경우도 구분해서 알려준다.
 */
function diagnose(extraRoots = {}) {
  const out = [];
  for (const src of SOURCES) {
    const seen = new Set();
    for (const root of src.dirs(extraRoots[src.id] || [])) {
      let real = null;
      try {
        real = fs.realpathSync(root);
      } catch {
        out.push({ id: src.id, label: src.label, path: root, exists: false, files: 0, dup: false });
        continue;
      }
      const dup = seen.has(real);
      seen.add(real);
      out.push({
        id: src.id,
        label: src.label,
        path: root,
        exists: true,
        files: dup ? 0 : walk(real, src.ext).length,
        dup,
      });
    }
  }
  return out;
}

module.exports = { collect, diagnose, localDay, SOURCES };

// node src/main/usage.js 로 바로 확인할 수 있게
if (require.main === module) {
  const t0 = Date.now();
  const r = collect();
  console.log(
    `파일 ${r.fileCount} · 총 ${r.total.toLocaleString()} · 오늘 ${r.today.toLocaleString()}` +
      ` (${Date.now() - t0}ms)`,
  );
  console.log("\n도구별:");
  for (const [k, v] of r.sources) console.log("  " + k.padEnd(14) + v.toLocaleString());
  console.log("\n날짜별 (최근 10일):");
  for (const [d, t] of r.days.slice(-10)) console.log("  " + d + "  " + t.toLocaleString());
}
