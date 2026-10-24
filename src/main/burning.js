"use strict";
/**
 * 버닝타임 — 정해 둔 시간에 쓴 토큰은 성장을 몇 배로 쳐 준다.
 *
 * 기본은 코어 타임(10~16시)과 야근 시간(18시~자정), 4배. 설정에서 바꾼다.
 *
 * ── 어느 토큰이 버닝인가 ──
 * 성장은 갱신할 때 "지난번 이후 늘어난 토큰"을 한꺼번에 적립한다(box.accrue). 그 순간의
 * 시각으로 정하면 틀린다 — 밤새 꺼 뒀다가 10시에 켜면 밤에 쓴 토큰이 전부 4배가 된다.
 * 그래서 기록 한 줄 한 줄의 시각(usage events)을 보고, 늘어난 몫 중 버닝 시간에 쓴
 * 비율만큼만 더 쳐 준다.
 *
 * 더 쳐 준 몫은 나무열매처럼 bonus 에 넣는다 — 토큰 경험치라서 난이도를 똑같이 탄다.
 * 나무열매(2배)와 겹치면 둘 다 더해져 5배가 된다.
 */

const DEFAULT = {
  enabled: true,
  mult: 4,
  weekdays: false, // 평일만
  spans: [
    { name: "코어 타임", on: true, from: 10, to: 16 },
    { name: "야근 시간", on: true, from: 18, to: 0 }, // to 0 = 자정
  ],
};
const MULTS = [2, 3, 4];

const isHour = (h) => Number.isInteger(h) && h >= 0 && h <= 23;

/** 세이브·설정 창에서 온 값을 바로잡는다. 모르는 값은 기본으로 */
function normalize(b) {
  const src = b && typeof b === "object" ? b : {};
  const spans = DEFAULT.spans.map((d, i) => {
    const s = (Array.isArray(src.spans) && src.spans[i]) || {};
    return {
      name: d.name,
      on: typeof s.on === "boolean" ? s.on : d.on,
      from: isHour(s.from) ? s.from : d.from,
      to: isHour(s.to) ? s.to : d.to,
    };
  });
  return {
    enabled: typeof src.enabled === "boolean" ? src.enabled : DEFAULT.enabled,
    mult: MULTS.includes(src.mult) ? src.mult : DEFAULT.mult,
    weekdays: typeof src.weekdays === "boolean" ? src.weekdays : DEFAULT.weekdays,
    spans,
  };
}

/** 그 구간 안인가. 자정을 넘겨도 된다(18~0, 22~6). from == to 는 빈 구간 */
function inSpan(h, s) {
  if (!s.on || s.from === s.to) return false;
  return s.from < s.to ? h >= s.from && h < s.to : h >= s.from || h < s.to;
}

/** 이 시각에 쓴 토큰은 몇 배인가 */
function multAt(t, b) {
  if (!b || !b.enabled) return 1;
  const d = new Date(t);
  const day = d.getDay();
  if (b.weekdays && (day === 0 || day === 6)) return 1;
  const h = d.getHours() + d.getMinutes() / 60;
  return b.spans.some((s) => inSpan(h, s)) ? b.mult : 1;
}

/**
 * (from, to] 사이에 늘어난 토큰 중 버닝 시간에 쓴 비율(0~1).
 * 그 사이 기록이 하나도 없으면(시각이 없는 기록뿐이면) 지금 시각으로 정한다.
 */
function share(events, from, to, b) {
  if (!b || !b.enabled) return 0;
  let all = 0, hot = 0;
  for (const e of events || []) {
    if (e.t <= from || e.t > to) continue;
    all += e.n;
    if (multAt(e.t, b) > 1) hot += e.n;
  }
  if (!all) return multAt(to, b) > 1 ? 1 : 0;
  return hot / all;
}

/**
 * 화면에 보일 상태 — 지금 버닝인지, 언제 끝나는지(on), 다음은 언제인지(off).
 * 10분 단위로 앞을 살핀다. 이틀 안에 없으면 next 는 null.
 */
function status(now, b) {
  if (!b || !b.enabled) return { enabled: false, on: false, mult: 1 };
  const t0 = now.getTime ? now.getTime() : now;
  const on = multAt(t0, b) > 1;
  const STEP = 10 * 60_000;
  let t = Math.floor(t0 / STEP) * STEP + STEP;
  for (const end = t0 + 48 * 3_600_000; t < end; t += STEP) if ((multAt(t, b) > 1) !== on) break;
  const edge = t < t0 + 48 * 3_600_000 ? t : null;
  return { enabled: true, on, mult: b.mult, until: on ? edge : null, next: on ? null : edge };
}

module.exports = { DEFAULT, MULTS, normalize, multAt, share, status };
