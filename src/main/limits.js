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
 * opencodex가 캐시한 Codex 실제 쿼터.
 *
 * 이건 계산이 아니라 제공자가 알려준 값이다. 없으면 null —
 * 없는 걸 추정해서 채우지 않는다.
 */
function codexQuota() {
  const f = path.join(os.homedir(), ".opencodex", "codex-quota-cache.json");
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

function summarize(usage, now = Date.now()) {
  const events = usage.events || [];
  return {
    block: currentBlock(events, now),
    week: rollingWeek(events, now),
    codex: codexQuota(),
    now,
  };
}

module.exports = { FIVE_HOURS, fiveHourBlocks, currentBlock, rollingWeek, codexQuota, summarize };

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
