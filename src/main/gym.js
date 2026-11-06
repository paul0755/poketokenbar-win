"use strict";
/**
 * 체육관 — 관장 8명에게 차례로 도전해 배지를 모은다(gyms.json).
 *
 * 관장 · 이름 · 대사는 이 앱에서 지은 인물이다. 쓰는 포켓몬만 기존 종이다.
 *
 * ── 싸우는 법 ──
 * 내 아이 최대 3마리 대 관장 3~5마리, 한 마리씩 1:1(battle.run)을 잇는다. 이긴 쪽은 깎인
 * 체력 · 상태이상을 들고 다음 상대와 붙는다(opts.init — 야생이 쓰는 그것). 레벨은 맞추지 않는다.
 * 관장의 레벨이 곧 "이만큼 키워 오라"는 문턱이다 — 레벨은 토큰으로 자란다(1500만당 Lv.1).
 *
 * 관장 아이의 성장량은 레벨에서 거꾸로 셈한다. 그래서 모습(1차 · 2차 · 3차 진화)도 레벨을 따라간다.
 */
const battle = require("./battle");
const poke = require("./pokemon");
const SPECIES = require("./species.json");
const GYMS = require("./gyms.json");
const ROAD = require("./road.json");

const PER_LEVEL = 15_000_000; // profile.js 와 같은 값
const grownAt = (lv) => (lv - 1) * PER_LEVEL + PER_LEVEL / 2;

/**
 * 관장 아이의 성격 — 그 모습의 공격 · 특수공격 중 센 쪽을 올리고 안 쓰는 쪽을 내린다.
 * 고집(공격↑ 특수공격↓) · 조심(특수공격↑ 공격↓). 관장은 아이를 제대로 키운 사람이다.
 */
const NATURE_ATK = 10, NATURE_SPA = 2;
function leaderNature(line, grown) {
  const d = poke.describe(grown, line, {});
  const b = (SPECIES[d.dexId] || {}).base;
  if (!b) return 0;
  return b[1] >= b[3] ? NATURE_ATK : NATURE_SPA;
}

/** 관장 아이 하나 — battle.fighter 가 받는 모양(raidBoss 와 같다) */
function leaderMon(g, k) {
  const t = g.team[k];
  const iv = g.iv ?? 20;
  const grown = grownAt(t.lv);
  return {
    mon: { id: `gym-${g.id}-${k}`, line: t.line, nature: leaderNature(t.line, grown), shiny: false, ivs: [iv, iv, iv, iv, iv, iv], gender: "무성", ability: 0, eggMoves: [], tmMoves: [] },
    grown,
  };
}

/**
 * 도전. mine = [{ mon, grown }] (내 순서대로), rng 는 결투 하나하나에 쓴다.
 * 돌려주는 rounds 는 화면이 차례로 재생한다 — 판마다 누가 나왔는지(a · b 번째)와 결투 결과.
 *
 * 무승부(턴이 다 되도록 판정도 못 낸 경우)는 둘 다 물러난다.
 * 판정으로 진 쪽도 쓰러진 것으로 친다 — 그 판은 끝났다.
 */
function challenge(mine, g, rng = Math.random) {
  const foe = g.team.map((_, k) => leaderMon(g, k));
  const rounds = [];
  let i = 0, j = 0;
  let stA = null, stB = null; // 다음 판으로 들고 가는 체력 · 상태이상
  const carry = (e) => ({ hp: e.hp / e.max, status: e.status });
  while (i < mine.length && j < foe.length) {
    const r = battle.run(mine[i].mon, mine[i].grown, foe[j].mon, foe[j].grown, rng, { init: [stA, stB] });
    if (!r) return null;
    rounds.push({ a: i, b: j, r });
    if (r.winner === 0) { stA = carry(r.end[0]); stB = null; j++; }
    else if (r.winner === 1) { stB = carry(r.end[1]); stA = null; i++; }
    else { stA = stB = null; i++; j++; }
  }
  const last = rounds[rounds.length - 1];
  return { win: j >= foe.length && Boolean(last) && last.r.winner === 0, rounds };
}

/* ---------------- 🏆 챔피언 로드 ---------------- */

/*
 * 배지 8개를 다 모은 뒤 매주 열리는 길. 관장 셋의 재대결(gyms.json 순서대로) → 챔피언 누리(road.json).
 * 누가 나오는지는 주(그 주 월요일 날짜)로 정한다 — 같은 주에는 언제 켜도 같은 길이다.
 *
 * 재대결 관장은 원래 팀에 road.json 의 add 를 더해 Lv.87 부터 두 칸씩(에이스가 가장 높다), 개체값 28.
 * 챔피언은 pool 에서 넷 + 에이스 하나, 개체값 30. 내 쪽은 6마리까지 데려간다(체육관은 3).
 * 시뮬레이션(Lv.100 여섯 마리)으로 재대결은 대개 이기고, 챔피언은 한 판에 절반쯤 이기게 맞췄다.
 */
const AGAIN_LV = 87;
const AGAIN_STEP = 2;
const AGAIN_IV = 28;
const ROAD_LEADERS = 3;

/** 주 이름으로 정하는 난수 — 문자열 해시(FNV-1a)를 씨앗으로 xorshift */
function seeded(key) {
  let h = 2166136261;
  for (const c of String(key)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  // 비슷한 날짜 문자열이 비슷한 씨앗이 되지 않게 한 번 더 섞는다(murmur3 마무리)
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  h = h >>> 0 || 1;
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

/** 앞에서부터 n 개를 고른다(섞어서). 원본은 그대로 */
function pickN(arr, n, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/** 그 주의 길 — [재대결 관장 셋(체육관 순서), 챔피언]. 결투가 받는 모양(challenge 의 g)과 같다 */
function roadOf(weekKey) {
  const rng = seeded("road:" + weekKey);
  const idx = pickN(GYMS.map((_, i) => i), ROAD_LEADERS, rng).sort((a, b) => a - b);
  const stages = idx.map((i) => {
    const g = GYMS[i];
    const a = ROAD.again[g.id] || { add: [] };
    const lines = [...g.team.map((t) => t.line), ...(a.add || [])];
    return {
      id: `again-${g.id}`, base: g.id, n: i, name: g.name, title: g.title, type: g.type, typeName: g.typeName,
      iv: AGAIN_IV, intro: a.intro || g.intro, win: a.win || g.win, lose: a.lose || g.lose,
      team: lines.map((line, k) => ({ line, lv: Math.min(100, AGAIN_LV + k * AGAIN_STEP) })),
    };
  });
  const c = ROAD.champion;
  const four = pickN(c.pool, c.lv.length, rng);
  stages.push({
    id: c.id, base: c.id, champ: true, name: c.name, title: c.title, type: c.type, typeName: c.typeName,
    iv: c.iv, intro: c.intro, win: c.win, lose: c.lose,
    team: [...four.map((line, k) => ({ line, lv: c.lv[k] })), { line: c.ace.line, lv: c.ace.lv }],
  });
  return stages;
}

module.exports = { GYMS, ROAD, PER_LEVEL, grownAt, leaderMon, challenge, roadOf, seeded };
