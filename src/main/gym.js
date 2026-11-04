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

module.exports = { GYMS, PER_LEVEL, grownAt, leaderMon, challenge };
