"use strict";
/**
 * 사용량 응답 해석 — 파일도 네트워크도 건드리지 않는 순수 함수들.
 *
 * 가져오는 쪽(claude-limits.js)과 떼어 놓는다.
 * 해석 규칙은 눈으로 확인할 수 있어야 하는데, 가져오는 코드와 붙어 있으면
 * 확인하려 할 때마다 실제 호출이 따라붙는다.
 *
 * ── 왜 필드 이름을 박지 않나 ──
 *
 * 이 응답에는 공개 스펙이 없다. 이름을 박아두면 어느 날 조용히 빈 화면이 된다.
 * 대신 "퍼센트처럼 생긴 수 + 시각처럼 생긴 값"을 가진 객체를 훑는다.
 */

const PCT_KEYS = ["utilization", "percent", "percentage", "used_percent", "usedPercent", "usage_percent"];
const RESET_KEYS = ["resets_at", "resetsAt", "reset_at", "resetAt", "resets", "next_reset", "nextReset"];

/** ISO 문자열 · 초 · 밀리초를 모두 밀리초로. 못 읽으면 null */
function toMs(v) {
  if (v == null) return null;
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * 0.37 로 올 수도, 37 로 올 수도 있다.
 * 소수점이 있고 1 이하면 비율로 본다 — 37.5% 를 0.375 로 보내는 API는 없다.
 */
function toPercent(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const p = n <= 1 && !Number.isInteger(n) ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(p)));
}

/** 이름을 아는 창은 한국어로, 모르는 창은 온 이름 그대로 보여준다. */
const LABELS = {
  five_hour: "5시간",
  fiveHour: "5시간",
  seven_day: "주간",
  sevenDay: "주간",
  seven_day_opus: "주간 (Opus)",
  sevenDayOpus: "주간 (Opus)",
  seven_day_oauth_apps: "주간 (앱)",
};

/** 5시간 · 주간 · 나머지 순으로. 화면에 뜨는 순서를 응답 순서에 맡기지 않는다. */
const ORDER = (k) => (/five|5/i.test(k) ? 0 : /seven|week|7/i.test(k) ? 1 : 2);

/** 퍼센트를 가진 객체를 깊이 우선으로 훑는다. 구조가 바뀌어도 살아남게. */
function harvest(node, out = [], depth = 0) {
  if (!node || typeof node !== "object" || depth > 4) return out;
  for (const [key, v] of Object.entries(node)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const pct = toPercent(PCT_KEYS.map((k) => v[k]).find((x) => typeof x === "number"));
    if (pct != null && !out.some((w) => w.key === key)) {
      out.push({
        key,
        label: LABELS[key] || key,
        percent: pct,
        resetAt: toMs(RESET_KEYS.map((k) => v[k]).find((x) => x != null)),
      });
    }
    harvest(v, out, depth + 1);
  }
  return depth === 0 ? out.sort((a, b) => ORDER(a.key) - ORDER(b.key)) : out;
}

/** 무엇이 왔는지 키 이름과 타입만 남긴다. 값은 담지 않는다. */
function shapeOf(o, depth = 0) {
  if (!o || typeof o !== "object" || depth > 2) return null;
  const s = {};
  for (const [k, v] of Object.entries(o)) {
    s[k] = v && typeof v === "object" && !Array.isArray(v) ? shapeOf(v, depth + 1) : typeof v;
  }
  return s;
}

module.exports = { toMs, toPercent, harvest, shapeOf, LABELS };
