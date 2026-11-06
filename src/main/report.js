"use strict";
/**
 * 📊 주간 리포트 — 한 주(월요일 0시 ~ 다음 월요일 0시, 내 PC 시간)를 카드 한 장으로.
 *
 * 토큰 쪽(합계 · 요일별 · 시간대 · 도구 · 버닝/사탕 타임 몫)은 로그 기록(usage events)에서
 * 그때그때 센다. 로그는 도구가 지우기도 하니(Claude Code 는 기본 30일) 주가 바뀌는 순간
 * 지난 주를 통째로 세이브에 남긴다(save.weekLog) — 지난 리포트는 거기서 읽는다.
 *
 * 아이 쪽(많이 자란 아이)은 로그에 없다. 주마다 처음 본 성장량(start)과 마지막으로 본
 * 성장량(last)을 적어 두고 그 차이로 센다(save.week). 사탕 · 나무열매 · 버닝 몫도 다 들어간다.
 * 이 기능이 생기기 전의 주는 모르는 채로 둔다 — 지어내지 않는다.
 */

const WEEK_MS = 7 * 86_400_000;
const KEEP = 12; // 지난 리포트를 몇 주까지 남기나

/** 그 시각이 든 주의 월요일 0시(내 PC 시간) */
function mondayOf(t = Date.now()) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** 주 이름 — 그 주 월요일의 날짜 "2026-11-02" */
const weekKey = (t = Date.now()) => dayKey(mondayOf(t));

/** 주 이름 → [시작, 끝) 시각. 서머타임이 없어도 setDate 로 센다(23 · 25시간인 날이 있어도 맞게) */
function rangeOf(key) {
  const [y, m, d] = key.split("-").map(Number);
  const from = new Date(y, m - 1, d);
  const to = new Date(y, m - 1, d + 7);
  return { from: from.getTime(), to: to.getTime() };
}

/** 지난 주 이름 */
function prevKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d - 7));
}

/**
 * 토큰 쪽. multAt(t) 가 1 보다 크면 버닝 · 사탕 타임에 쓴 것으로 센다(burning.multAt).
 * events 는 시각 순이 아니어도 된다.
 */
function tokensOf(events, key, { burnAt = () => 1, sweetAt = () => 1 } = {}) {
  const { from, to } = rangeOf(key);
  const days = [0, 0, 0, 0, 0, 0, 0]; // 월 ~ 일
  const hours = new Array(24).fill(0);
  const sources = {};
  let total = 0, burn = 0, sweet = 0;
  for (const e of events || []) {
    if (!(e.t >= from && e.t < to)) continue;
    const d = new Date(e.t);
    total += e.n;
    days[(d.getDay() + 6) % 7] += e.n;
    hours[d.getHours()] += e.n;
    sources[e.src || "?"] = (sources[e.src || "?"] || 0) + e.n;
    if (burnAt(e.t) > 1) burn += e.n;
    if (sweetAt(e.t) > 1) sweet += e.n;
  }
  return { total, days, hours, sources, burnShare: total ? burn / total : 0, sweetShare: total ? sweet / total : 0 };
}

/**
 * 갱신마다 — 박스 아이들의 지금 성장량(effs: { id: eff })을 적는다.
 * 주가 바뀌었으면 지난 주 기록을 돌려준다(그 뒤 새 주를 시작한다). 아니면 null.
 * 새로 들어온 아이는 처음 본 값이 start 다 — 교환으로 받은 9억짜리가 "+9억 자람"이 되지 않게.
 */
function track(save, effs, now = Date.now()) {
  const key = weekKey(now);
  let ended = null;
  const w = save.week;
  if (!w || w.key !== key) {
    if (w && w.key && w.key < key) ended = { key: w.key, start: w.start || {}, last: w.last || {} };
    save.week = { key, start: { ...effs }, last: { ...effs } };
    return { ended, dirty: true };
  }
  let dirty = false;
  for (const [id, e] of Object.entries(effs)) {
    if (!(id in w.start)) { w.start[id] = e; dirty = true; }
    if (w.last[id] !== e) { w.last[id] = e; dirty = true; }
  }
  return { ended, dirty };
}

/** 그 주에 자란 양 — 큰 순서. 박스에서 빠진 아이도 마지막으로 본 값으로 센다 */
function growthOf(w) {
  if (!w) return [];
  return Object.entries(w.last || {})
    .map(([id, e]) => ({ id, grown: Math.max(0, e - ((w.start || {})[id] ?? e)) }))
    .filter((x) => x.grown > 0)
    .sort((a, b) => b.grown - a.grown);
}

/** 지난 리포트를 남긴다 — 같은 주는 덮어쓰고, KEEP 주까지 */
function archive(save, entry) {
  const log = (Array.isArray(save.weekLog) ? save.weekLog : []).filter((x) => x && x.key !== entry.key);
  log.push(entry);
  log.sort((a, b) => (a.key < b.key ? -1 : 1));
  save.weekLog = log.slice(-KEEP);
}

module.exports = { WEEK_MS, KEEP, mondayOf, weekKey, rangeOf, prevKey, tokensOf, track, growthOf, archive, dayKey };
