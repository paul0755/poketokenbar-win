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
const poke = require("./pokemon");

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

/* ---------------- 계산 ---------------- */

/**
 * 원작 능력치 계산식 (노력치 0).
 *
 *   HP    = floor((2*종족값 + 개체값) * 레벨 / 100) + 레벨 + 10
 *   그 외 = floor(floor((2*종족값 + 개체값) * 레벨 / 100) + 5 * 성격보정)
 *
 * 무한의 벽(팬텀) 같은 HP 1 고정 종은 예외지만, 우리 범위엔 없다.
 */
function statsOf(dexId, level, ivs, natureIndex) {
  const s = SPECIES[dexId];
  if (!s) return null;
  const n = poke.NATURES[natureIndex ?? 0] || {};
  const out = {};
  for (let i = 0; i < 6; i++) {
    const base = s.base[i] ?? 0;
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
    .map(([id, lv]) => {
      const m = MOVES[id] || {};
      const t = m.t != null ? TYPES[m.t] : null;
      return {
        name: m.n || String(id),
        level: lv,
        type: t ? t.n : null,
        typeKey: t ? t.k : null,
        power: m.p ?? null,
        accuracy: m.a ?? null,
        pp: m.pp ?? null,
        damageClass: m.c || null,
      };
    })
    .reverse(); // 최근에 배운 것이 위로
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
  const level = levelOf(grown);
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
    // 다음 레벨까지
    levelUpAt: level >= 100 ? null : level * PER_LEVEL,
  };
}

module.exports = { levelOf, rollIVs, rollGender, rollAbility, statsOf, movesOf, build, PER_LEVEL };
