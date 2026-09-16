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
    const n =
      (u.input_tokens ?? 0) +
      (u.output_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0);
    if (n) add(o.timestamp, n, o.requestId || o.uuid);
  }
}

/* ------------------------------------------------------------------
   Codex — ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
   type: "token_usage_record" 의 payload.usage 가 응답 1건의 사용량이다.

   payload.info.total_token_usage 라는 누적값도 같이 흐르는데 그건 쓰지 않는다.
   세션 누계라서 더하면 같은 토큰을 수십 번 세게 된다.
   total_tokens 는 input + output 이고 cached 는 input의 부분집합이다.
   ------------------------------------------------------------------ */
function readCodex(text, add) {
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
    const n = u.total_tokens ?? (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
    // response_id 로 중복을 막는다. 재시도·재개 시 같은 응답이 다시 기록된다.
    if (n) add(o.timestamp, n, o.payload.response_id);
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

function collect() {
  const byDay = new Map();
  const bySource = new Map();
  // 개별 사용 기록. 5시간 창·번레이트는 일자 합계로는 계산할 수 없다.
  const events = [];
  let total = 0;
  let files = 0;

  for (const src of SOURCES) {
    const paths = walk(src.dir, src.ext);
    files += paths.length;
    let srcTotal = 0;
    const seen = new Set(); // 중복 레코드 방지 (재시도·세션 재개)

    const add = (iso, n, dedupeKey) => {
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
      srcTotal += n;
      total += n;
    };

    for (const f of paths) {
      let text;
      try {
        text = fs.readFileSync(f, "utf8");
      } catch {
        continue; // 쓰기 중인 파일일 수 있다. 다음 폴링에서 잡힌다
      }
      try {
        src.read(text, add);
      } catch {
        /* 한 파일이 깨져도 나머지는 세어야 한다 */
      }
    }
    if (srcTotal) bySource.set(src.label, srcTotal);
  }

  const today = localDay();
  events.sort((a, b) => a.t - b.t);
  return {
    total,
    today: byDay.get(today) ?? 0,
    days: [...byDay.entries()].sort(),
    sources: [...bySource.entries()].sort((a, b) => b[1] - a[1]),
    events,
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
