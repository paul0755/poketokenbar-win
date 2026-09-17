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
function readClaude(text, add) {
  for (const line of text.split("\n")) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // 마지막 줄이 잘려 있는 건 정상이다 (계속 쓰이는 파일)
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

  for (const line of text.split("\n")) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type !== "token_usage_record") continue;
    const u = o.payload && o.payload.usage;
    if (!u) continue;
    // Codex의 input_tokens는 cached를 포함한 값이다. 겹쳐 세지 않도록 빼준다.
    const cached = u.cached_input_tokens ?? 0;
    const parts = {
      in: Math.max(0, (u.input_tokens ?? 0) - cached),
      out: u.output_tokens ?? 0,
      cacheW: u.cache_write_input_tokens ?? 0,
      cacheR: cached,
    };
    const n = u.total_tokens ?? parts.in + parts.out + parts.cacheW + parts.cacheR;
    // response_id 로 중복을 막는다. 재시도·재개 시 같은 응답이 다시 기록된다.
    if (n) add(o.timestamp, n, o.payload.response_id, parts);
  }
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
const SOURCES = [
  {
    id: "claude",
    label: "Claude Code",
    dir: path.join(HOME, ".claude", "projects"),
    ext: ".jsonl",
    read: readClaude,
  },
  {
    id: "codex",
    label: "Codex",
    dir: path.join(HOME, ".codex", "sessions"),
    ext: ".jsonl",
    read: readCodex,
  },
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

function collect() {
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
    const paths = walk(src.dir, src.ext);
    files += paths.length;
    let srcTotal = 0;
    const seen = new Set(); // 중복 레코드 방지 (재시도·세션 재개)

    /**
     * 파서가 찾은 공식 한도 중 가장 최근 것만 남긴다.
     * 오래된 값이 새 값을 덮어쓰면 화면이 거꾸로 간다.
     */
    const note = (q) => {
      if (!q || (!q.block && !q.week)) return;
      if (!quota[src.id] || q.at > quota[src.id].at) quota[src.id] = q;
    };

    const add = (iso, n, dedupeKey, parts) => {
      if (dedupeKey) {
        const k = src.id + ":" + dedupeKey;
        if (seen.has(k)) return;
        seen.add(k);
      }
      const day = dayOf(iso);
      if (!day) return;
      byDay.set(day, (byDay.get(day) ?? 0) + n);
      const t = Date.parse(iso);
      if (Number.isFinite(t)) events.push({ t, n, src: src.id });
      if (parts) {
        const d = detail.get(src.id) ?? { in: 0, out: 0, cacheW: 0, cacheR: 0 };
        d.in += parts.in; d.out += parts.out; d.cacheW += parts.cacheW; d.cacheR += parts.cacheR;
        detail.set(src.id, d);
      }
      srcTotal += n;
      total += n;
    };

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

module.exports = { collect, localDay, SOURCES };

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
