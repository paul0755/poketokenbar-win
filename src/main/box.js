"use strict";
/**
 * 박스 — 여러 마리를 보유한다.
 *
 * ── 왜 바꿨나 ──
 *
 * 0.1.0까지는 개체가 하나였다. 알을 사면 키우던 아이를 덮어썼다.
 * 기록이 남는 건 마스터까지 간 아이뿐이라, 중간까지 키우다 알을 산
 * 아이들은 흔적도 없이 사라졌다. 키우는 게임에서 이건 납득이 안 된다.
 *
 * ── 성장을 어떻게 세나 ──
 *
 * 전에는 (누적 토큰 - 태어난 시점)으로 쟀다. 개체가 하나일 때만 되는
 * 방식이다. 여러 마리가 되면 "누가 이 토큰을 먹었나"를 정해야 한다.
 *
 * 그래서 개체마다 제가 먹은 양을 들고 있게 했다. 갱신할 때마다
 * 늘어난 만큼을 키우는 중인 아이에게만 적립한다. 박스에 있는 아이는
 * 그 자리에 멈춰 있는다 — 안 키우는데 자라면 키운다는 말이 무의미해진다.
 *
 * raw 와 fed 를 나눠 두는 이유:
 *   raw  실제로 쓴 토큰. 난이도(성장 속도)가 여기에 곱해진다
 *   fed  사탕으로 밀어 넣은 양. 난이도와 무관하게 그대로 더한다
 *
 * 난이도를 되돌리면 raw 쪽은 정확히 복원된다. 임계값을 건드리지 않고
 * 성장량에 곱하는 방식을 유지하는 것도 같은 이유다.
 */

const poke = require("./pokemon");
const profile = require("./profile");

let seq = 0;
/** 시각 + 일련번호. 같은 밀리초에 두 마리를 받아도 겹치지 않는다. */
function newId() {
  return "m" + Date.now().toString(36) + (seq++).toString(36);
}

/**
 * 개체값·성별·특성은 받는 순간 정해진다.
 *
 * 매번 굴리면 갱신할 때마다 능력치가 흔들려서 "개체값"이라는 말이
 * 성립하지 않는다. 종 단위 값이라 진화해도 그대로 간다 —
 * 그래서 라인의 첫 형태(ids[1])를 기준으로 굴린다.
 */
function make(line, nature, shiny) {
  const L = poke.LINES[line];
  const baseDex = L && L.ids ? L.ids[1] : null;
  return {
    id: newId(),
    line,
    nature: nature ?? 0,
    shiny: Boolean(shiny),
    ivs: profile.rollIVs(),
    gender: baseDex ? profile.rollGender(baseDex) : "무성",
    ability: baseDex ? profile.rollAbility(baseDex) : 0,
    eggMoves: baseDex ? profile.rollEggMoves(baseDex) : [],
    tmMoves: [], // 상점의 기술머신으로 가르친 것
    raw: 0, // 이 아이가 먹은 실제 토큰
    bonus: 0, // 나무열매로 두 배가 된 몫. raw 처럼 난이도를 탄다
    boost: 0, // 앞으로 두 배로 쳐 줄 토큰이 얼마 남았나
    fed: 0, // 사탕으로 넣은 양
    maxStage: 0,
    caughtAt: new Date().toISOString().slice(0, 10),
    graduatedAt: null,
  };
}

/**
 * 난이도를 반영한 실효 성장량.
 * 나무열매 몫(bonus)은 토큰과 같이 난이도를 탄다 — "토큰 경험치 2배"라서
 * 토큰이 받는 대우를 그대로 받아야 한다. 사탕(fed)만 그대로 더한다.
 *
 * 변하지않는돌을 지녔으면 holdCap(진화 바로 앞)에서 멈춘다. 모습·레벨·결투·교환이
 * 전부 이 값을 쓰니 여기 한 곳에서 막으면 어디서도 진화하지 않는다. 먹은 토큰은
 * raw 에 그대로 쌓인다 — 돌을 빼면 밀린 만큼 한 번에 자란다(free 로 미리 본다).
 */
function effOf(m, speed = 1, free = false) {
  if (!m) return 0;
  const e = Math.max(0, ((m.raw || 0) + (m.bonus || 0)) * speed + (m.fed || 0));
  return !free && m.hold === "everstone" && typeof m.holdCap === "number" ? Math.min(e, m.holdCap) : e;
}

/**
 * 레벨을 셀 때 쓸 꼴. 돌을 지녔으면 멈추지 않은 성장량을 lvGrown 으로 붙여 준다 —
 * 모습은 effOf(멈춘 값), 레벨·기술은 lvGrown 을 쓴다(profile.lvOf). 세이브에는 넣지 않는다.
 */
function withLv(m, speed = 1) {
  if (!m || m.hold !== "everstone") return m;
  return { ...m, lvGrown: effOf(m, speed, true) };
}

/**
 * 프로필이 없던 시절의 개체를 채운다.
 *
 * 없는 채로 두면 화면이 전부 0으로 나온다. 지금 굴려 주는 것이
 * 원래 값을 복원하는 건 아니지만, 애초에 존재한 적이 없는 값이다.
 */
function backfill(box) {
  let dirty = false;
  for (const m of box || []) {
    const L = poke.LINES[m.line];
    const baseDex = L && L.ids ? L.ids[1] : null;
    if (!Array.isArray(m.ivs) || m.ivs.length !== 6) { m.ivs = profile.rollIVs(); dirty = true; }
    if (!m.gender) { m.gender = baseDex ? profile.rollGender(baseDex) : "무성"; dirty = true; }
    if (typeof m.ability !== "number") { m.ability = baseDex ? profile.rollAbility(baseDex) : 0; dirty = true; }
    // 알기술이 생기기 전에 태어난 아이들. 빈 배열과 구분하려고 배열인지를 본다
    if (!Array.isArray(m.eggMoves)) { m.eggMoves = baseDex ? profile.rollEggMoves(baseDex) : []; dirty = true; }
    if (!Array.isArray(m.tmMoves)) { m.tmMoves = []; dirty = true; }
  }
  return dirty;
}

const find = (box, id) => (Array.isArray(box) ? box.find((m) => m.id === id) : null) || null;

/**
 * 키우는 중인 아이. 지정이 없거나 사라졌으면 박스의 첫 아이로 떨어진다 —
 * 키우는 아이가 없으면 적립할 곳이 없어 성장이 통째로 멈춘다.
 */
function active(save) {
  return find(save.box, save.activeId) || (save.box && save.box[0]) || null;
}

/**
 * 늘어난 토큰을 키우는 아이에게 적립한다.
 *
 * lastTotal 이 기준점이다. 이게 없으면(첫 실행·이전 버전 세이브)
 * 누적 전체가 델타로 잡혀 한 번에 마스터가 된다. 그래서 기준점이
 * 없을 때는 적립하지 않고 기준점만 세운다.
 */
/**
 * 한 번에 적립을 허용할 최대량.
 *
 * 기록 출처를 새로 붙이면 과거분이 통째로 한 번에 들어온다. opencodex
 * 기록을 붙였을 때 430M 이 그랬다 — 몇 시간 키운 아이가 그 한 번으로
 * 최종 진화까지 끝나버린다. 실제로 쓴 토큰이긴 하지만, 한 번에 쏟아지는
 * 건 성장이 아니라 사고다.
 *
 * 그렇다고 고정값으로 막으면 앱을 오래 꺼 뒀다가 켰을 때 진짜 사용분까지
 * 버린다. 그래서 지난 적립 이후 흐른 시간만큼 허용한다.
 */
const BASE_ALLOW = 50_000_000;
const ALLOW_PER_HOUR = 60_000_000;

function accrue(save, total) {
  const prev = save.lastTotal;
  const prevAt = save.lastTotalAt;
  const now = Date.now();
  save.lastTotal = total;
  save.lastTotalAt = now;
  if (typeof prev !== "number") return 0; // 기준점만 세우고 이번엔 넘어간다
  const delta = Math.max(0, total - prev);
  if (!delta) return 0;

  const hours = typeof prevAt === "number" ? Math.max(0, (now - prevAt) / 3_600_000) : 0;
  if (delta > BASE_ALLOW + ALLOW_PER_HOUR * hours) {
    // 기준점만 옮기고 넘어간다. 다음부터는 평소대로 적립된다.
    return 0;
  }
  const a = active(save);
  if (a) {
    a.raw = (a.raw || 0) + delta;
    // 나무열매가 남아 있으면 그만큼 한 번 더 쳐 준다
    const extra = Math.min(delta, a.boost || 0);
    if (extra > 0) {
      a.bonus = (a.bonus || 0) + extra;
      a.boost -= extra;
    }
  }
  return delta;
}

/**
 * 0.1.x 세이브를 박스로 옮긴다. 한 번만 돈다.
 *
 * 되살릴 수 있는 과거는 졸업 기록뿐이다 — 중간에 덮어써진 아이들은
 * 애초에 어디에도 안 남아 있다. 졸업한 아이는 fed 로 성장량을 넣어
 * 마스터 모습 그대로 박스에 세운다.
 */
function migrate(save, total, natureIndexByName) {
  if (Array.isArray(save.box) && save.box.length) return false;
  const box = [];

  for (const g of save.graduated || []) {
    const m = make(g.line, natureIndexByName(g.nature), false);
    m.fed = g.grown || 0; // 이미 다 자란 상태로 복원
    m.maxStage = 4;
    m.caughtAt = g.at || m.caughtAt;
    m.graduatedAt = g.at || m.caughtAt;
    box.push(m);
  }

  if (save.lineIndex != null) {
    const cur = make(save.lineIndex, save.natureIndex ?? 0, save.shiny);
    // 기존 방식대로 (누적 - 태어난 시점)을 그대로 이어받는다.
    // 여기서 0으로 만들면 키우던 진행을 빼앗는 셈이다.
    cur.raw = Math.max(0, total - (save.bornAt ?? 0));
    cur.maxStage = (save.maxStage || {})[save.lineIndex] ?? 0;
    box.push(cur);
    save.activeId = cur.id;
  }

  save.box = box;
  save.lastTotal = total;
  if (!save.activeId && box.length) save.activeId = box[box.length - 1].id;
  return true;
}

module.exports = { newId, make, effOf, withLv, find, active, accrue, migrate, backfill };
