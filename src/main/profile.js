"use strict";
/**
 * 개체 프로필 — 레벨·성별·개체값·능력치·배운 기술.
 *
 * ── 어디까지가 원작 규칙이고 어디부터가 우리 규칙인가 ──
 *
 * 능력치 계산식·개체값 범위(0~31)·성격 보정(±10%)·성별비는 원작 그대로다.
 * 종족값·특성·기술 목록도 PokéAPI에서 받은 사실이다.
 *
 * 우리가 정한 건 **레벨을 어떻게 매기나** 하나뿐이다. 원작은 경험치로
 * 오르지만 우리에겐 토큰밖에 없다. 그래서 성장량을 레벨로 환산한다.
 *
 * ── 개체값을 언제 정하나 ──
 *
 * 받는 순간 정해서 저장한다. 매번 계산하면 갱신할 때마다 능력치가
 * 흔들려서, 개체값이라는 말 자체가 성립하지 않는다.
 */
const poke = require("./world").pack; // 🌏 지금 세계의 종 데이터(포켓몬이면 pokemon.js 그대로)

const SPECIES = require("./species.json");
const MOVES = require("./moves.json");
const ABILITIES = require("./abilities.json");
const TYPES = require("./types.json");

/**
 * 마스터(15억)를 100레벨로 본다.
 *
 * 단계 임계값과 자연스럽게 맞물린다:
 *   부화 5M → 1레벨, 1차 진화 80M → 6레벨, 최종 진화 400M → 27레벨
 * 진화가 레벨보다 빨리 오는 셈인데, 원작도 저레벨 진화가 흔하니 어색하지 않다.
 */
const PER_LEVEL = 15_000_000;
const levelOf = (grown) => Math.max(1, Math.min(100, Math.floor(grown / PER_LEVEL) + 1));
/**
 * 이 아이의 레벨. 모습은 grown 으로 정하지만, 변하지않는돌을 지녔으면 grown 이 진화
 * 바로 앞에서 멈춰 있다. 원작처럼 레벨은 계속 올라야 해서 멈추지 않은 성장(lvGrown,
 * box.withLv 가 붙인다)이 있으면 그쪽으로 센다.
 */
const lvOf = (mon, grown) => levelOf(Math.max(grown, (mon && mon.lvGrown) || 0));

/* ---------------- 받는 순간 정해지는 것 ---------------- */

const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"];

/** 개체값 6개. 원작과 같이 0~31. */
const rollIVs = () => Array.from({ length: 6 }, () => Math.floor(Math.random() * 32));

/**
 * 성별. genderRate 는 암컷이 나올 확률을 8분의 몇으로 나타낸 값이다.
 * -1은 무성 — 메타몽·파오리 같은 종이 여기 들어간다.
 */
function rollGender(dexId) {
  const s = SPECIES[dexId];
  const r = s ? s.genderRate : -1;
  if (r < 0) return "무성";
  return Math.random() < r / 8 ? "암컷" : "수컷";
}

/**
 * 특성. 숨겨진 특성은 잘 안 나와야 값어치가 있다 — 1/8로 잡았다.
 * 인덱스를 저장한다. 이름은 사전에서 그때그때 찾는다.
 */
function rollAbility(dexId) {
  const s = SPECIES[dexId];
  if (!s || !s.abilities.length) return 0;
  const hidden = s.abilities.map((a, i) => (a.hidden ? i : -1)).filter((i) => i >= 0);
  const normal = s.abilities.map((a, i) => (a.hidden ? -1 : i)).filter((i) => i >= 0);
  if (hidden.length && Math.random() < 1 / 8) return hidden[Math.floor(Math.random() * hidden.length)];
  const pool = normal.length ? normal : s.abilities.map((_, i) => i);
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 알기술. 원작에서는 부모에게서 물려받는다 — 우리에겐 부모가 없으니 받는 순간
 * 종이 물려받을 수 있는 것 중 1~2개를 정한다. 개체값처럼 저장해 두고 진화해도 간다.
 * PokéAPI 는 알기술을 라인의 첫 형태에만 적어 두므로 첫 형태 기준으로 굴린다.
 */
function rollEggMoves(dexId) {
  const pool = [...((SPECIES[dexId] || {}).egg || [])];
  const n = Math.min(pool.length, Math.random() < 0.5 ? 1 : 2);
  const out = [];
  while (out.length < n) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

/* ---------------- 계산 ---------------- */

/**
 * 원작 능력치 계산식 (노력치 0).
 *
 *   HP    = floor((2*종족값 + 개체값) * 레벨 / 100) + 레벨 + 10
 *   그 외 = floor(floor((2*종족값 + 개체값) * 레벨 / 100) + 5 * 성격보정)
 *
 * 무한의 벽(팬텀) 같은 HP 1 고정 종은 예외지만, 우리 범위엔 없다.
 */
function statsOf(dexId, level, ivs, natureIndex, baseOverride = null) {
  const s = SPECIES[dexId];
  if (!s) return null;
  const B = baseOverride || s.base; // 💎 메가진화 — 메가 폼의 종족값(mega.js)
  const n = poke.NATURES[natureIndex ?? 0] || {};
  const out = {};
  for (let i = 0; i < 6; i++) {
    const base = B[i] ?? 0;
    const iv = (ivs && ivs[i]) ?? 0;
    const core = Math.floor(((2 * base + iv) * level) / 100);
    if (i === 0) {
      out.hp = core + level + 10;
    } else {
      // 성격은 한 능력치를 10% 올리고 다른 하나를 10% 내린다.
      // 같은 능력치를 올리고 내리는 성격(노력 등)은 보정이 없다.
      const key = STAT_KEYS[i];
      const label = STAT_LABEL[key];
      let mod = 1;
      if (n.up && n.down && n.up !== n.down) {
        if (n.up === label) mod = 1.1;
        else if (n.down === label) mod = 0.9;
      }
      out[key] = Math.floor((core + 5) * mod);
    }
  }
  return out;
}

/**
 * PokéAPI 성격의 능력치 이름은 한국어로 온다.
 * 우리 키와 짝지어야 보정을 어디에 걸지 알 수 있다.
 */
const STAT_LABEL = {
  hp: "HP",
  atk: "공격",
  def: "방어",
  spa: "특수공격",
  spd: "특수방어",
  spe: "스피드",
};

const STAT_NAME = { hp: "HP", atk: "공격", def: "방어", spa: "특공", spd: "특방", spe: "스피드" };

/** 기술 하나를 화면과 펫이 쓰는 꼴로. src 는 어디서 배웠나: level | egg | tm */
function moveInfo(id, lv, src) {
  const m = MOVES[id] || {};
  const t = m.t != null ? TYPES[m.t] : null;
  return {
    id,
    name: m.n || String(id),
    level: lv,
    src,
    type: t ? t.n : null,
    typeKey: t ? t.k : null,
    power: m.p ?? null,
    accuracy: m.a ?? null,
    pp: m.pp ?? null,
    damageClass: m.c || null,
  };
}

/**
 * 지금 레벨에서 쓸 수 있는 기술 넷.
 *
 * 원작처럼 배운 순서대로 밀려나게 한다 — 가장 최근에 배운 넷.
 * 레벨업 기술이 넷이 안 되면 있는 만큼만.
 */
function movesOf(dexId, level) {
  const s = SPECIES[dexId];
  if (!s || !s.moves) return [];
  return s.moves
    .filter(([, lv]) => lv <= level)
    .slice(-4)
    .map(([id, lv]) => moveInfo(id, lv, "level"))
    .reverse(); // 최근에 배운 것이 위로
}

/**
 * 기술머신으로 더 가르칠 수 있는 것. 이미 아는 기술(지금까지 배운 레벨업 기술·알기술·가르친 것)은 뺀다.
 * 지금 모습 기준이다 — 진화하면 배울 수 있는 기술머신이 늘어나는 종이 있다.
 */
function tmCandidates(mon, grown) {
  const line = poke.LINES[mon.line];
  if (!line) return [];
  const dexId = line.ids[poke.stageFor(grown)];
  const s = SPECIES[dexId];
  if (!s || !s.tm) return [];
  // 💿 떠올릴 수 있는 기술(지금까지 배운 레벨업 기술 전부)도 뺀다 — 기술 관리에서 고르면 되니 기술머신이 아깝다
  const known = new Set([
    ...movePool(mon, grown).map((m) => m.id),
    ...(mon.eggMoves || []),
    ...(mon.tmMoves || []),
  ]);
  return s.tm.filter((id) => !known.has(id));
}

/* ---------------- 💿 기술 관리 ---------------- */

/** 결투 · 펫이 쓰는 기술 — 고를 수 있는 만큼(원작처럼 넷). 패시브스킬(알기술)은 따로 늘 쓴다 */
const MOVE_SET_MAX = 4;

/**
 * 기술 떠올리기 — 고를 수 있는 기술 전부. 지금 레벨까지 배운 레벨업 기술(진화 전 모습에서 배운 것도)과
 * 기술머신으로 가르친 것. 레벨업 기술은 배운 레벨 순, 기술머신은 가르친 순. [{ id, lv, src }]
 */
function movePool(mon, grown) {
  const lv = levelPool(mon, grown);
  for (const id of mon.moveForgot || []) lv.delete(id); // 🗑 잊은 레벨업 기술
  const out = [...lv].sort((a, b) => a[1] - b[1]).map(([id, at]) => ({ id, lv: at, src: "level" }));
  for (const id of mon.tmMoves || []) if (MOVES[id] && !lv.has(id)) out.push({ id, lv: null, src: "tm" });
  return out;
}

/** 지금 레벨까지 배운 레벨업 기술(진화 전 모습 것도) — 잊은 것도 들어 있다. Map(id → 배운 레벨) */
function levelPool(mon, grown) {
  const line = poke.LINES[mon.line];
  const lv = new Map();
  if (!line) return lv;
  const stage = poke.stageFor(grown);
  const level = lvOf(mon, grown);
  for (const dexId of new Set(line.ids.slice(1, stage + 1))) {
    for (const [id, at] of (SPECIES[dexId] || {}).moves || []) {
      if (at <= level && MOVES[id] && !(lv.has(id) && lv.get(id) <= at)) lv.set(id, at);
    }
  }
  return lv;
}

/** 🗑 잊은 레벨업 기술 가운데 지금도 말이 되는 것(그 아이가 배웠던 것). 친선 코드에 실려 받는 쪽도 같은 기술로 싸운다 */
function cleanForgot(mon, grown) {
  if (!Array.isArray(mon.moveForgot) || !mon.moveForgot.length) return [];
  const lv = levelPool(mon, grown);
  return [...new Set(mon.moveForgot)].filter((id) => lv.has(id));
}

/**
 * 고른 뒤에 새로 배운 기술 — 기술을 고를 때 떠올릴 수 있던 것(mon.moveSeen) 말고 그 뒤에 생긴 것(레벨업 · 진화 · 기술머신).
 * 고른 적이 없으면(자동) 없다. 배운 순서대로 id
 */
function newMoves(mon, grown) {
  if (!Array.isArray(mon.moveSeen)) return [];
  const seen = new Set(mon.moveSeen);
  return movePool(mon, grown).filter((x) => !seen.has(x.id)).map((x) => x.id);
}

/**
 * mon.moveSet 가운데 지금 쓸 수 있는 것(떠올릴 수 있는 기술 안 · 넷까지). 고른 게 없거나 다 못 쓰면 null — 자동.
 * 넷이 덜 찼으면 고른 뒤에 새로 배운 기술을 배운 순서대로 채운다 — 골라 둔 아이가 새 기술을 영영 안 쓰던 것
 */
function cleanMoveSet(mon, grown) {
  if (!Array.isArray(mon.moveSet) || !mon.moveSet.length) return null;
  const pool = new Set(movePool(mon, grown).map((x) => x.id));
  const pick = [...new Set(mon.moveSet)].filter((id) => pool.has(id)).slice(0, MOVE_SET_MAX);
  if (!pick.length) return null;
  for (const id of newMoves(mon, grown)) if (pick.length < MOVE_SET_MAX && !pick.includes(id)) pick.push(id);
  return pick;
}

/**
 * 결투 · 펫이 쓰는 기술 id — 고른 기술(💿 기술 관리) + 패시브스킬.
 * 고르지 않았으면 예전 그대로(자동): 최근에 배운 레벨업 넷 + 패시브스킬 + 기술머신 전부
 */
function activeMoveIds(mon, grown) {
  const set = cleanMoveSet(mon, grown);
  if (set) return [...new Set([...set, ...(mon.eggMoves || [])])].filter((id) => MOVES[id]);
  const line = poke.LINES[mon.line];
  const s = line ? SPECIES[line.ids[poke.stageFor(grown)]] : null;
  const level = lvOf(mon, grown);
  const forgot = new Set(mon.moveForgot || []);
  const ids = [
    ...((s && s.moves) || []).filter(([id, lv]) => lv <= level && !forgot.has(id)).slice(-4).map(([id]) => id),
    ...(mon.eggMoves || []),
    ...(mon.tmMoves || []),
  ];
  return [...new Set(ids)].filter((id) => MOVES[id]);
}

/*
 * 💿 기술머신 — 어울리는 기술부터.
 * 공격 기술: 위력 × 명중 × 자속(1.5) × 강한 쪽 공격인가(물리면 공격, 특수면 특공이 더 센 종일수록) × 아직 없는 타입(1.25, 있으면 0.7).
 * 보조 기술: 강한 쪽 공격을 올리는 기술(칼춤 · 나쁜음모 · 명상 …) · 스피드 · 회복 · 상태이상은 쓸 만하게, 나머지는 낮게.
 * 위력이 정해지지 않은 기술(일격필살 · 카운터 …)과 자폭 · 대폭발은 거의 고르지 않는다.
 */
const SELF_KO = new Set([120, 153]); // 자폭 · 대폭발
// 원작에서 쓰기 번거로운 기술 — 결투 규칙에는 없지만(battle.js) "어울리는 기술"로는 뒤로 민다
// 쉬어야 하는 기술(파괴광선 · 기가임팩트 · 블러스트번 · 하이드로캐논 · 하드플랜트), 모으는 기술(솔라빔 · 칼바람 · 로케트박치기 · 불새), 꿈먹기
const AWKWARD = new Map([[63, 0.55], [416, 0.55], [307, 0.55], [308, 0.55], [338, 0.55], [76, 0.65], [13, 0.6], [130, 0.6], [143, 0.6], [138, 0.3]]);
const NORMAL = 1; // 노말 — 자속이 아니면 맞붙일 상대 타입이 없다
const STAT_SIDE = { attack: "atk", "special-attack": "spa" };
function tmScore(id, ctx) {
  const m = MOVES[id];
  if (!m || SELF_KO.has(id)) return 1;
  const { atk, spa, types, have } = ctx;
  const top = Math.max(atk, spa, 1);
  if (m.c !== "status") {
    if (!m.p) return 3;
    const hits = m.hits ? (m.hits[0] + m.hits[1]) / 2 : 1;
    const fit = (m.c === "physical" ? atk : spa) / top;
    const stab = types.includes(m.t);
    const cover = have.has(m.t) ? 0.7 : !stab && m.t === NORMAL ? 0.8 : 1.25;
    let sc = m.p * hits * ((m.a || 100) / 100) * (stab ? 1.5 : 1) * fit * fit * cover * (AWKWARD.get(id) || 1);
    if (m.dr < 0) sc *= 0.85; // 반동
    if ((m.st || []).some(([, ch]) => ch < 0) && (m.sc || 0) >= 100) sc *= 0.85; // 쓰면 내 능력이 떨어진다(오버히트 · 인파이트 …)
    return sc;
  }
  let sc = 8;
  if (/user|ally/.test(m.tg || "")) {
    for (const [stat, ch] of m.st || []) {
      if (ch <= 0) continue;
      const side = STAT_SIDE[stat];
      if (side) sc = Math.max(sc, (ctx[side] / top) ** 2 * (60 + ch * 20));
      else if (stat === "speed") sc = Math.max(sc, 55);
      else sc = Math.max(sc, 25);
    }
  }
  if (m.hl > 0) sc = Math.max(sc, 70);
  if (m.ail && m.c === "status" && !/user/.test(m.tg || "")) sc = Math.max(sc, ["sleep", "paralysis", "poison", "burn"].includes(m.ail) ? 60 : 30);
  return sc;
}

/**
 * 기술머신 하나 고르기 — 어울리는 순으로 줄 세워 위 셋 가운데서(점수만큼) 하나.
 * 늘 1등만 주면 같은 종은 다 같은 기술이 된다. { id, score, why } 또는 null
 */
function tmPick(mon, grown, rng = Math.random) {
  const pool = tmCandidates(mon, grown);
  if (!pool.length) return null;
  const line = poke.LINES[mon.line];
  const s = SPECIES[line.ids[poke.stageFor(grown)]] || {};
  const base = s.base || [];
  const have = new Set(activeMoveIds(mon, grown).map((id) => MOVES[id]).filter((m) => m && m.c !== "status" && m.p).map((m) => m.t));
  const ctx = { atk: base[1] || 0, spa: base[3] || 0, types: s.types || [], have };
  const ranked = pool.map((id) => ({ id, score: tmScore(id, ctx) })).sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, 3);
  const total = top.reduce((t, x) => t + x.score, 0);
  let r = rng() * total;
  const pick = top.find((x) => (r -= x.score) <= 0) || top[0];
  const m = MOVES[pick.id];
  const why = [];
  if (m.c !== "status" && ctx.types.includes(m.t)) why.push("자속");
  if (m.c !== "status" && m.p && !have.has(m.t)) why.push("새 타입");
  if (m.c === "physical" && ctx.atk >= ctx.spa) why.push("공격이 강한 종");
  if (m.c === "special" && ctx.spa > ctx.atk) why.push("특공이 강한 종");
  return { id: pick.id, score: pick.score, why };
}

/**
 * 개체 하나의 프로필 전체.
 *
 * 데이터가 없는 종이면 null을 준다 — 빈 값으로 채워 보여주면
 * 화면은 그럴듯한데 내용이 전부 0이 되어 더 헷갈린다.
 */
function build(mon, grown) {
  if (!mon) return null;
  const line = poke.LINES[mon.line];
  if (!line) return null;
  const level = lvOf(mon, grown);
  const stage = poke.stageFor(grown);
  const dexId = line.ids[stage];
  const s = SPECIES[dexId];
  if (!s) return null;

  const stats = statsOf(dexId, level, mon.ivs, mon.nature);
  const ivs = mon.ivs || [0, 0, 0, 0, 0, 0];
  const ab = s.abilities[mon.ability ?? 0] || s.abilities[0];
  const abInfo = ab ? ABILITIES[ab.id] : null;

  return {
    dexId,
    level,
    gender: mon.gender || "무성",
    types: (s.types || []).map((id) => (TYPES[id] ? TYPES[id].n : null)).filter(Boolean),
    typeKeys: (s.types || []).map((id) => (TYPES[id] ? TYPES[id].k : null)).filter(Boolean),
    ability: abInfo ? abInfo.n : null,
    abilityDesc: abInfo ? abInfo.d : null,
    abilityHidden: Boolean(ab && ab.hidden),
    stats: STAT_KEYS.map((k, i) => ({
      key: k,
      name: STAT_NAME[k],
      base: s.base[i] ?? 0,
      iv: ivs[i] ?? 0,
      value: stats ? stats[k] : 0,
    })),
    // 개체값 합계. 186이 만점이고, 원작에서도 이 숫자로 개체를 평가한다.
    ivTotal: ivs.reduce((a, b) => a + b, 0),
    ivMax: 186,
    moves: movesOf(dexId, level),
    eggMoves: (mon.eggMoves || []).map((id) => moveInfo(id, null, "egg")),
    tmMoves: (mon.tmMoves || []).map((id) => moveInfo(id, null, "tm")),
    tmLeft: tmCandidates(mon, grown).length,
    // 💿 기술 관리 — pool: 고를 수 있는 기술(on: 지금 쓰는 것), moveSet: 고른 기술(null 이면 자동), active: 결투 · 펫이 쓰는 기술
    ...(() => {
      const pool = movePool(mon, grown);
      const act = activeMoveIds(mon, grown);
      const on = new Set(act);
      const fresh = new Set(newMoves(mon, grown)); // 고른 뒤에 새로 배운 기술(NEW)
      const src = new Map(pool.map((x) => [x.id, x]));
      for (const id of mon.eggMoves || []) if (!src.has(id)) src.set(id, { id, lv: null, src: "egg" });
      return {
        pool: pool.map((x) => ({ ...moveInfo(x.id, x.lv, x.src), on: on.has(x.id), fresh: fresh.has(x.id) })),
        moveNew: pool.filter((x) => fresh.has(x.id) && !on.has(x.id)).length, // 새로 배웠는데 넷이 차서 못 쓰는 기술
        moveSet: cleanMoveSet(mon, grown),
        moveMax: MOVE_SET_MAX,
        forgot: cleanForgot(mon, grown).map((id) => moveInfo(id, levelPool(mon, grown).get(id), "level")), // 🗑 잊은 레벨업 기술(되살릴 수 있다)
        active: act.map((id) => { const x = src.get(id) || { lv: null, src: "level" }; return { ...moveInfo(id, x.lv, x.src), fresh: fresh.has(id) }; }),
      };
    })(),
    // 다음 레벨까지
    levelUpAt: level >= 100 ? null : level * PER_LEVEL,
  };
}

module.exports = { levelOf, rollIVs, rollGender, rollAbility, rollEggMoves, statsOf, movesOf, tmCandidates, build, PER_LEVEL, MOVE_SET_MAX, movePool, levelPool, cleanForgot, newMoves, cleanMoveSet, activeMoveIds, tmPick };
