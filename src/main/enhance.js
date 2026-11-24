"use strict";
/**
 * ✨ 강화 · 💊 특성캡슐 — 특성 칸(mon.ability)과 개체값을 바꾸는 규칙. 세이브를 만지지 않는 순수 함수만 둔다(index.js 가 부른다).
 *
 * 특성은 받을 때 한 번 정해지고(profile.rollAbility) 바꿀 길이 없었다. 결투에 특성이 들어오면서(0.19.0)
 * 꽝 특성(결투에서 효과 없음) · 손해 특성(게으름)을 받은 아이를 살릴 길이 필요해졌다.
 *
 * ── 강화 ──
 * 같은 라인의 다른 아이를 하나 넣을 때마다 +1(최대 +5). 넣은 아이는 박스에서 떠난다.
 *   +1  특성을 일반 칸 중에서 랜덤으로 다시 — 지금과 다른 칸으로. 숨겨진 특성을 가졌으면 그대로 둔다(운 좋게 받은 걸 빼앗지 않는다)
 *   +2  가장 낮은 개체값 하나 → 31
 *   +3  숨겨진 칸이 열린다 — 숨김까지 넣어 랜덤으로 다시(숨김 1/2). 숨겨진 칸이 없는 종은 일반 칸 중에서
 *   +4  가장 낮은 개체값 하나 → 31
 *   +5  개체값 모두 31
 * 고르는 화면은 없다 — 하나하나 고르면 머리 아프다. 좋은 걸 원하면 캡슐.
 *
 * ── 특성캡슐 ──
 * 그 종의 "좋은 특성"(결투에서 효과가 있고 손해가 아닌 것, ability.good) 중 지금 것을 빼고 하나로 랜덤.
 * 숨겨진 칸은 +3 이상만. 바꿀 좋은 특성이 없으면 쓰지 않는다(캡슐도 그대로).
 *
 * 특성 칸은 지금 모습의 종 것이다 — 결투(battle.fighter)가 그 칸을 지금 모습에서 찾는다.
 */
const AB = require("./ability");

const PLUS_MAX = 5;
const STAT_NAME = ["HP", "공격", "방어", "특공", "특방", "스피드"];

const normals = (slots) => slots.map((a, i) => (a.hidden ? -1 : i)).filter((i) => i >= 0);
const hiddens = (slots) => slots.map((a, i) => (a.hidden ? i : -1)).filter((i) => i >= 0);
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
/** 칸 번호가 달라도 같은 특성이면 같은 것 — 진화로 한 특성이 두 칸에 들어간 모습이 있다(샤미드 [저수 · 저수 · 촉촉바디]) */
const same = (slots, i, j) => i === j || ((slots[i] || {}).id != null && (slots[i] || {}).id === (slots[j] || {}).id);

/** 가장 낮은 개체값 하나를 31로. 이미 다 31이면 null */
function maxLowestIv(mon) {
  const ivs = [...(mon.ivs || [0, 0, 0, 0, 0, 0])];
  let lo = -1;
  ivs.forEach((v, i) => { if (v < 31 && (lo < 0 || v < ivs[lo])) lo = i; });
  if (lo < 0) return null;
  const before = ivs[lo];
  ivs[lo] = 31;
  mon.ivs = ivs;
  return `${STAT_NAME[lo]} 개체값 ${before} → 31`;
}

/**
 * 한 단계 올린다 — mon 을 바꾸고 무엇이 바뀌었는지 문장으로 돌려준다.
 * slots 는 지금 모습의 특성 칸(species.abilities). 이미 +5 면 null
 */
function step(mon, slots, rng = Math.random) {
  const plus = mon.plus || 0;
  if (plus >= PLUS_MAX) return null;
  const next = plus + 1;
  mon.plus = next;
  const notes = [];
  const cur = mon.ability ?? 0;
  const name = (i) => AB.name((slots[i] || {}).id) || "—";
  const setAb = (i) => {
    if (i == null || same(slots, i, cur)) { notes.push(`특성은 그대로 ${name(cur)}`); return; }
    mon.ability = i;
    notes.push(`특성 ${name(cur)} → ${name(i)}`);
  };
  if (next === 1) {
    if ((slots[cur] || {}).hidden) notes.push(`숨겨진 특성 ${name(cur)}은(는) 그대로`);
    else setAb(pick(normals(slots).filter((i) => !same(slots, i, cur)), rng) ?? cur);
  } else if (next === 3) {
    const hid = hiddens(slots);
    const nor = normals(slots);
    setAb(hid.length && (!nor.length || rng() < 0.5) ? pick(hid, rng) : pick(nor, rng));
    notes.unshift("숨겨진 칸이 열렸다");
  } else if (next === 2 || next === 4) {
    notes.push(maxLowestIv(mon) || "개체값은 이미 모두 31");
  } else if (next === 5) {
    const was = (mon.ivs || []).filter((v) => v < 31).length;
    mon.ivs = [31, 31, 31, 31, 31, 31];
    notes.push(was ? "개체값 모두 31" : "개체값은 이미 모두 31");
  }
  return { plus: next, notes };
}

/** 💊 캡슐로 갈 수 있는 칸들 — 좋은 특성 · 지금 것 빼고 · 숨김은 +3 부터 */
function capsulePool(mon, slots) {
  const cur = mon.ability ?? 0;
  const ok = slots.map((_, i) => i).filter((i) => !same(slots, i, cur) && AB.good(slots[i].id) && (!slots[i].hidden || (mon.plus || 0) >= 3));
  return ok.filter((i, n) => ok.findIndex((j) => same(slots, i, j)) === n); // 같은 특성은 한 번만
}

/** 💊 캡슐을 쓴다. 바꿀 칸이 없으면 null */
function capsule(mon, slots, rng = Math.random) {
  const pool = capsulePool(mon, slots);
  if (!pool.length) return null;
  const cur = mon.ability ?? 0;
  const i = pick(pool, rng);
  mon.ability = i;
  return { from: AB.name((slots[cur] || {}).id), to: AB.name(slots[i].id), hidden: Boolean(slots[i].hidden) };
}

/** 다음 단계에서 일어날 일 — 화면 안내 */
const NEXT = ["", "특성을 일반 칸 중에서 랜덤으로 다시 정한다", "가장 낮은 개체값 하나가 31이 된다", "숨겨진 칸이 열리고 특성을 숨김까지 넣어 랜덤으로 다시 정한다", "가장 낮은 개체값 하나가 31이 된다", "개체값이 모두 31이 된다"];

module.exports = { PLUS_MAX, NEXT, step, capsule, capsulePool };
