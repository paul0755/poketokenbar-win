"use strict";
/**
 * 📒 토큰 장부 — 로그가 지워져도 줄지 않는 누적.
 *
 * usage.collect 는 지금 PC 에 남은 로그만 센다. Claude Code 는 30일 지난 로그를 지우니
 * 로그 합계는 날마다 줄었다 늘었다 한다. 장부는 읽을 때마다 "지난번보다 늘어난 만큼"만 더한다 —
 * 지워져서 줄어든 건 빼지 않고 기준점만 옮긴다.
 *
 * 데이터 폴더에 하나(tokens.json) — 두 세계가 같이 쓴다. 그래서 다른 세계에 가 있던 동안
 * 옛 로그가 지워져도, 돌아온 세계는 장부로 따라잡아 그 사이 쓴 만큼을 다 받는다.
 *
 * 처음 만들 때는 지금 로그 합계에서 시작한다 — 세이브의 lastTotal 과 같은 단위라 이어진다.
 *
 *   { v: 1, total, last, src: { claude: { acc: {total,in,out,cacheW,cacheR}, last: {…}, label } } }
 */
const fs = require("node:fs");
const path = require("node:path");

const PARTS = ["total", "in", "out", "cacheW", "cacheR"];

let file = null;
let book = null;

const partsOf = (s) => ({ total: s.total || 0, ...Object.fromEntries(PARTS.slice(1).map((k) => [k, (s.detail && s.detail[k]) || 0])) });

function load(dir) {
  file = path.join(dir, "tokens.json");
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (j && j.v === 1 && typeof j.total === "number" && typeof j.last === "number") book = { src: {}, ...j };
  } catch (e) {
    if (e.code !== "ENOENT") {
      // 망가진 장부 — 남겨 두고 지금 합계에서 다시 시작한다(표시 숫자만 걸린다)
      try { fs.renameSync(file, file + ".bad-" + Date.now()); } catch {}
      console.error("[ledger] tokens.json 을 읽지 못해 새로 시작합니다 (" + (e.code || e.message) + ")");
    }
  }
}

function write() {
  try {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(book), "utf8");
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error("[ledger] 장부를 쓰지 못했습니다 (" + (e.code || e.message) + ")");
  }
}

/**
 * 이번에 읽은 로그(u)로 장부를 늘린다. 장부 기준 누적과 도구별 누적을 돌려준다.
 * dir — 데이터 폴더(처음 한 번 읽는다)
 */
function update(dir, u) {
  if (!file) load(dir);
  let changed = false;
  if (!book) {
    book = { v: 1, total: u.total, last: u.total, src: {} };
    changed = true;
  } else if (u.total !== book.last) {
    book.total += Math.max(0, u.total - book.last);
    book.last = u.total;
    changed = true;
  }
  for (const s of u.sources || []) {
    const cur = partsOf(s);
    const e = book.src[s.id];
    if (!e) {
      book.src[s.id] = { label: s.label, acc: { ...cur }, last: cur }; // 처음 보는 도구 — 남은 로그 전부
      changed = true;
      continue;
    }
    for (const k of PARTS) {
      if (cur[k] === e.last[k]) continue;
      e.acc[k] += Math.max(0, cur[k] - e.last[k]);
      changed = true;
    }
    e.last = cur;
    e.label = s.label;
  }
  // 로그가 다 지워져 이번에 안 보인 도구 — 기준점을 0으로. 새 로그가 생기면 처음부터 다시 더한다
  const seen = new Set((u.sources || []).map((s) => s.id));
  for (const [id, e] of Object.entries(book.src)) {
    if (seen.has(id) || !e.last.total) continue;
    e.last = Object.fromEntries(PARTS.map((k) => [k, 0]));
    changed = true;
  }
  if (changed) write();
  return { total: book.total, sources: sources(u) };
}

/** 화면에 보낼 도구별 누적 — 로그가 다 지워진 도구도 장부에 있으면 남긴다 */
function sources(u) {
  const live = new Map((u.sources || []).map((s) => [s.id, s]));
  return Object.entries(book.src)
    .map(([id, e]) => {
      const s = live.get(id);
      const { total, ...detail } = e.acc;
      const hasParts = Object.values(detail).some((v) => v > 0); // 입력 · 출력을 나눠 주지 않는 도구도 있다
      return { ...(s || {}), id, label: e.label, total, detail: hasParts ? detail : null };
    })
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total);
}

module.exports = { update };
