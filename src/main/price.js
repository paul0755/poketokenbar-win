"use strict";
/**
 * 💸 토큰 → 달러 — Claude API 정가로 치면 얼마인가.
 *
 * 구독(Pro · Max)으로 쓰면 실제로 내는 돈은 정액이다. 여기 숫자는 "같은 양을 API 로 썼다면"의 값이다.
 * 로그의 요청마다 모델과 토큰 종류(입력 · 출력 · 캐시 쓰기 5분/1시간 · 캐시 읽기)가 있어서 요청 하나하나를 정가로 센다.
 *
 * 가격 — 2026-11 Claude API 정가(백만 토큰당 달러). 캐시 쓰기는 5분 1.25배 · 1시간 2배(모든 모델 같다),
 * 캐시 읽기는 모델마다 다르다. 빠른 모드(usage.speed "fast")는 모두 2배.
 * Codex(OpenAI) · Gemini 는 가격표가 없다 — 지어내지 않고 null 을 돌려준다(화면은 "가격표 없음").
 */

// [입력, 출력, 캐시 읽기]
const TABLE = {
  "claude-fable-5-2": [8, 40, 0.2],
  "claude-mythos-5-2": [8, 40, 0.2],
  "claude-fable-5-1": [10, 50, 0.25],
  "claude-mythos-5-1": [10, 50, 0.25],
  "claude-fable-5": [10, 50, 1],
  "claude-mythos-5": [10, 50, 1],
  "claude-opus-5-5": [4, 20, 0.2],
  "claude-opus-5": [5, 25, 0.5],
  "claude-opus-4-8": [5, 25, 0.5],
  "claude-opus-4-7": [5, 25, 0.5],
  "claude-opus-4-6": [5, 25, 0.5],
  "claude-opus-4-5": [5, 25, 0.5],
  "claude-opus-4-1": [15, 75, 1.5],
  "claude-opus-4": [15, 75, 1.5],
  "claude-sonnet-5-5": [2, 10, 0.1],
  "claude-sonnet-5": [2, 10, 0.2],
  "claude-sonnet-4-6": [3, 15, 0.3],
  "claude-sonnet-4-5": [3, 15, 0.3],
  "claude-sonnet-4": [3, 15, 0.3],
  "claude-haiku-5-5": [0.1, 0.5, 0.01], // 프롬프트 10만 토큰까지 — 넘으면 5배(HAIKU_LONG)
  "claude-haiku-4-5": [1, 5, 0.1],
};
const W5 = 1.25; // 캐시 쓰기(5분) = 입력 × 1.25
const W1H = 2; // 캐시 쓰기(1시간) = 입력 × 2
const FAST = 2;
const HAIKU_LONG = { at: 100_000, mul: 5 };
const KEYS = Object.keys(TABLE).sort((a, b) => b.length - a.length); // 긴 이름부터 — claude-opus-5-5 가 claude-opus-5 에 먼저 걸리지 않게

/** 로그의 모델 이름 → 표의 이름. 날짜 꼬리(-20251001) · [1m] · 플랫폼 앞머리(anthropic.)를 뗀다 */
function keyOf(model) {
  if (!model || typeof model !== "string") return null;
  const m = model.toLowerCase().replace(/\[.*?\]/g, "").replace(/^.*?(claude-)/, "$1").replace(/[-@]\d{8}$/, "").trim();
  if (TABLE[m]) return m;
  return KEYS.find((k) => m === k || m.startsWith(k + "-")) || null;
}

/**
 * 요청 하나의 값(달러). 모르는 모델이면 null. <synthetic>(앱이 스스로 적은 줄)은 0.
 * u — 로그의 message.usage 그대로
 */
function claudeUsd(model, u) {
  if (!u) return null;
  if (model === "<synthetic>") return 0;
  const k = keyOf(model);
  if (!k) return null;
  let [pin, pout, pr] = TABLE[k];
  const inp = u.input_tokens || 0, out = u.output_tokens || 0, cw = u.cache_creation_input_tokens || 0, cr = u.cache_read_input_tokens || 0;
  const w1h = Math.min(cw, (u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0);
  const w5 = cw - w1h; // 나눠 적히지 않았으면 모두 5분
  if (k === "claude-haiku-5-5" && inp + cw + cr > HAIKU_LONG.at) { pin *= HAIKU_LONG.mul; pout *= HAIKU_LONG.mul; pr *= HAIKU_LONG.mul; }
  const usd = (inp * pin + out * pout + w5 * pin * W5 + w1h * pin * W1H + cr * pr) / 1e6;
  return u.speed === "fast" ? usd * FAST : usd;
}

module.exports = { claudeUsd, keyOf, TABLE, PRICED_AT: "2026-11" };
