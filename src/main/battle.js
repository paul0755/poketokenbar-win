"use strict";
/**
 * 결투 — 박스의 두 아이를 싸움 붙인다.
 *
 * ── 어디까지가 원작인가 ──
 * 데미지 공식·자속·상성·급소·난수·랭크·주요 상태이상·우선도는 5세대 그대로다.
 * 숫자는 전부 PokéAPI 에서 받은 것(위력·명중·효과 확률·흡수량)이고, 우리가 정한
 * 건 "어느 기술을 고르나"(AI)뿐이다.
 *
 * 빠진 것: 특성(153개가 저마다 다른 규칙이다), 지닌 물건, 날씨, 교체, PP,
 * 기술 고유 효과(카운터·대타출동처럼 숫자로 안 오는 것). 그런 기술은 효과 없이
 * 지나가고, AI 가 웬만하면 고르지 않는다.
 *
 * ── 왜 결과를 한꺼번에 내나 ──
 * 메인에서 끝까지 계산해 사건 목록(log)을 넘기고, 화면은 그걸 차례로 재생만 한다.
 * 화면이 계산까지 하면 보상(나무열매)을 렌더러가 정하게 된다 — 렌더러가 보낸
 * 승패를 믿을 이유가 없다.
 */
const profile = require("./profile");
const poke = require("./pokemon");

const SPECIES = require("./species.json");
const MOVES = require("./moves.json");
const TYPES = require("./types.json");

const MAX_TURNS = 60;

/* ---------------- 참가자 ---------------- */

const STAT_OF = { attack: "atk", defense: "def", "special-attack": "spa", "special-defense": "spd", speed: "spe", accuracy: "acc", evasion: "eva" };
const STAT_KO = { atk: "공격", def: "방어", spa: "특수공격", spd: "특수방어", spe: "스피드", acc: "명중률", eva: "회피율" };
const AIL_KO = { paralysis: "마비", burn: "화상", poison: "독", sleep: "잠듦", freeze: "얼음", confusion: "혼란" };
const MAJOR = new Set(["paralysis", "burn", "poison", "sleep", "freeze"]);
const TRANSFORM = 144; // 변신 — 메타몽

/**
 * 조사. "방어이(가)"처럼 둘 다 적으면 로그가 읽히지 않는다. 마지막 글자에 받침이
 * 있는지로 고른다. 한글이 아니면(폴리곤2) 둘 다 적는 쪽으로 물러난다.
 */
function josa(word, pair) {
  const [withF, noF] = [pair[0], pair[1]];
  const c = String(word).charCodeAt(String(word).length - 1);
  if (c < 0xac00 || c > 0xd7a3) return `${word}${withF}(${noF})`;
  return word + ((c - 0xac00) % 28 ? withF : noF);
}

/**
 * 박스의 개체 하나를 싸울 수 있는 꼴로. 기술은 펫이 쓰는 것과 같다 —
 * 레벨업 넷 + 패시브스킬(알기술) + 기술머신.
 *
 * level 을 주면 그 레벨로 맞춘다 — 원작 배틀시설의 "Lv.50 고정"과 같다.
 * 능력치만 그 레벨로 다시 계산하고 기술은 아는 그대로 둔다. 개체값·성격은
 * 그대로라 레벨을 맞추면 그 차이로 승부가 갈린다.
 */
function fighter(mon, grown, level = null) {
  const p = profile.build(mon, grown);
  if (!p) return null;
  const s = SPECIES[p.dexId];
  const ids = [
    ...(s.moves || []).filter(([, lv]) => lv <= p.level).slice(-4).map(([id]) => id),
    ...(mon.eggMoves || []),
    ...(mon.tmMoves || []),
  ];
  const moves = [...new Set(ids)].filter((id) => MOVES[id]).map((id) => ({ id, ...MOVES[id] }));
  const st = level
    ? profile.statsOf(p.dexId, level, mon.ivs, mon.nature)
    : Object.fromEntries(p.stats.map((x) => [x.key, x.value]));
  const d = poke.describe(grown, mon.line, { shiny: mon.shiny });
  return {
    id: mon.id,
    name: d.name,
    dexId: p.dexId, // 변신하면 상대 모습을 그린다
    shiny: d.isShiny,
    level: level || p.level,
    types: s.types,
    stats: st,
    maxHp: st.hp,
    hp: st.hp,
    moves,
    stage: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
    status: null, // 주요 상태이상
    sleep: 0,
    confused: 0,
    flinch: false,
  };
}

/* ---------------- 계산 ---------------- */

/** 랭크 배율. 능력치는 (2+n)/2, 명중·회피는 (3+n)/3 */
const stageMul = (n, acc = false) => {
  const b = acc ? 3 : 2;
  return n >= 0 ? (b + n) / b : b / (b - n);
};

/** 상성 배율. 타입이 둘이면 곱한다 */
function effectiveness(moveType, defTypes) {
  const t = TYPES[moveType];
  if (!t) return 1;
  let m = 1;
  for (const d of defTypes) {
    if ((t.zero || []).includes(d)) m *= 0;
    else if ((t.x2 || []).includes(d)) m *= 2;
    else if ((t.half || []).includes(d)) m *= 0.5;
  }
  return m;
}

/**
 * 위력이 숫자로 안 오는 공격 기술(지구던지기·용의분노·카운터 등).
 * 저마다 고유 규칙이라 다 구현하지 않고 고정 위력으로 친다.
 */
const powerOf = (mv) => mv.p || 50;

/** 실효 능력치. 마비는 스피드 1/4 (5세대) */
function eff(f, key) {
  let v = f.stats[key] * stageMul(f.stage[key]);
  if (key === "spe" && f.status === "paralysis") v /= 4;
  return v;
}

/**
 * 5세대 데미지 공식.
 *   floor(floor(floor(2L/5+2) × 위력 × A/D) / 50) + 2
 *   × 급소(2) × 난수(0.85~1) × 자속(1.5) × 상성 × 화상(물리 0.5)
 * 급소면 내 쪽 하락 랭크와 상대 상승 랭크를 무시한다.
 */
function damage(att, def, mv, rng, crit) {
  const phys = mv.c === "physical";
  const ak = phys ? "atk" : "spa";
  const dk = phys ? "def" : "spd";
  let A = att.stats[ak] * stageMul(crit ? Math.max(0, att.stage[ak]) : att.stage[ak]);
  let D = def.stats[dk] * stageMul(crit ? Math.min(0, def.stage[dk]) : def.stage[dk]);
  let base = Math.floor(Math.floor((Math.floor((2 * att.level) / 5 + 2) * powerOf(mv) * A) / D) / 50) + 2;
  if (crit) base *= 2;
  base = Math.floor(base * (0.85 + rng() * 0.15));
  if (att.types.includes(mv.t)) base = Math.floor(base * 1.5);
  const e = effectiveness(mv.t, def.types);
  base = Math.floor(base * e);
  if (phys && att.status === "burn") base = Math.floor(base / 2);
  return { amount: e === 0 ? 0 : Math.max(1, base), e };
}

/** 급소 확률. 랭크 0이 1/16, 급소율이 높은 기술은 1/8 (5세대) */
const critChance = (mv) => [1 / 16, 1 / 8, 1 / 4, 1 / 3, 1 / 2][Math.min(4, mv.cr || 0)];

/**
 * 능력치 변화가 누구에게 가나.
 *
 * PokéAPI 는 대상을 한 칸(target)만 준다. 오버히트는 "상대를 고른다"고 적혀 있지만
 * 특공이 떨어지는 건 나다. 그래서 규칙으로 가른다:
 *   변화 기술  대상이 나(user 계열)면 나, 아니면 상대
 *   공격 기술  올라가는 건 나(니트로차지), 반드시 떨어지는 건 나(인파이트),
 *             확률로 떨어지는 건 상대(섀도볼)
 */
function statTarget(mv, change) {
  if (mv.c === "status") return /user|ally/.test(mv.tg || "") ? "self" : "foe";
  if (change > 0) return "self";
  return !mv.sc || mv.sc >= 100 ? "self" : "foe";
}

/* ---------------- 기술 고르기 ---------------- */

/**
 * 그럴듯하게 고른다. 원작 트레이너 AI 처럼 "세게 때릴 수 있으면 때리고,
 * 할 만한 보조가 있으면 가끔 쓴다". 늘 최선만 고르면 매번 같은 기술만 나와서
 * 보는 재미가 없다 — 점수에 비례해 뽑는다.
 */
function choose(me, foe, rng, gentle = false) {
  const scored = me.moves.map((mv) => {
    if (mv.c !== "status") {
      const e = effectiveness(mv.t, foe.types);
      if (e === 0) return [mv, 0];
      /*
       * 잡으려고 약하게만 만들 때(gentle) — 쓰러뜨릴 것 같은 기술은 거의 안 고른다.
       * 원작에서 사람이 약한 기술을 골라 쓰는 것과 같다. 그래도 급소·난수로 넘칠 수 있다.
       */
      if (gentle && damage(me, foe, mv, () => 1, false).amount >= foe.hp) return [mv, 1];
      const stab = me.types.includes(mv.t) ? 1.5 : 1;
      const phys = mv.c === "physical";
      const ratio = eff(me, phys ? "atk" : "spa") / Math.max(1, eff(foe, phys ? "def" : "spd"));
      const hits = mv.hits ? (mv.hits[0] + mv.hits[1]) / 2 : 1;
      let sc = powerOf(mv) * hits * stab * e * ratio * ((mv.a || 100) / 100);
      if (mv.dr < 0 && me.hp < me.maxHp * 0.3) sc *= 0.5; // 반동으로 쓰러지기 싫다
      return [mv, sc];
    }
    // 보조 기술 — 지금 쓸 의미가 있을 때만
    let sc = 0;
    if (mv.hl && me.hp < me.maxHp * 0.5) sc = 120;
    if (mv.ail && MAJOR.has(mv.ail) && !foe.status) sc = Math.max(sc, gentle ? 140 : 70); // 잡을 땐 상태이상이 제일 좋다
    if (mv.ail === "confusion" && !foe.confused) sc = Math.max(sc, 45);
    for (const [stat, ch] of mv.st || []) {
      const who = statTarget(mv, ch) === "self" ? me : foe;
      const k = STAT_OF[stat];
      if (!k) continue;
      const room = ch > 0 ? who.stage[k] < 2 : who.stage[k] > -2;
      if (room && me.hp > me.maxHp * 0.5) sc = Math.max(sc, 35 + Math.abs(ch) * 15);
    }
    return [mv, sc];
  });
  const total = scored.reduce((a, [, s]) => a + s * s, 0);
  if (!total) return me.moves[Math.floor(rng() * me.moves.length)] || null;
  let r = rng() * total;
  for (const [mv, s] of scored) {
    r -= s * s;
    if (r <= 0) return mv;
  }
  return scored[scored.length - 1][0];
}

/* ---------------- 한 판 ---------------- */

/**
 * 끝까지 싸운다. 사건 목록과 승자를 낸다.
 *
 * 사건(ev)은 화면이 차례로 재생한다. 각 사건에 로그 한 줄(text)을 같이 실어 둔다 —
 * 화면이 문장을 지어내면 메인과 화면이 다른 말을 할 수 있다.
 *
 *   { t: "move",  side, move:{name,typeKey,damageClass,power}, text }
 *   { t: "hp",    side, hp, max, text }           데미지·회복·반동·상태이상 피해
 *   { t: "info",  side, text }                    빗나감·상성·급소·랭크·상태이상
 *   { t: "faint", side, text }
 */
function run(monA, grownA, monB, grownB, rng = Math.random, opts = {}) {
  const F = [fighter(monA, grownA, opts.level), fighter(monB, grownB, opts.level)];
  if (!F[0] || !F[1]) return null;
  /*
   * 이어서 싸우기 — opts.init[i] = { hp: 남은 비율, status }.
   * 야생 포켓몬은 한 번 깎인 체력을 다음 결투까지 들고 간다. 처음부터 다시 차면
   * "약하게 만들어 잡는다"가 성립하지 않는다.
   */
  (opts.init || []).forEach((st, i) => {
    if (!st || !F[i]) return;
    if (typeof st.hp === "number") F[i].hp = Math.max(1, Math.min(F[i].maxHp, Math.round(F[i].maxHp * st.hp)));
    if (st.status) { F[i].status = st.status; if (st.status === "sleep") F[i].sleep = 2; }
  });
  const hp0 = F.map((f) => f.hp);
  const log = [];
  const say = (e) => log.push(e);
  const nm = (i) => F[i].name;
  const typeKey = (mv) => (TYPES[mv.t] ? TYPES[mv.t].k : "normal");

  const setHp = (i, hp, text) => {
    F[i].hp = Math.max(0, Math.min(F[i].maxHp, Math.round(hp)));
    say({ t: "hp", side: i, hp: F[i].hp, max: F[i].maxHp, text });
  };

  const applyStat = (i, stat, ch) => {
    const k = STAT_OF[stat];
    if (!k) return;
    const before = F[i].stage[k];
    F[i].stage[k] = Math.max(-6, Math.min(6, before + ch));
    if (F[i].stage[k] === before) {
      say({ t: "info", side: i, text: `${nm(i)}의 ${josa(STAT_KO[k], "은는")} 더 ${ch > 0 ? "오르지" : "떨어지지"} 않는다!` });
      return;
    }
    const how = Math.abs(ch) >= 3 ? "극적으로" : Math.abs(ch) === 2 ? "크게" : "";
    say({ t: "info", side: i, stat: k, change: ch, text: `${nm(i)}의 ${josa(STAT_KO[k], "이가")} ${how ? how + " " : ""}${ch > 0 ? "올랐다" : "떨어졌다"}!` });
  };

  /**
   * 변신 — 원작처럼 상대의 타입 · 능력치(HP 빼고) · 랭크 · 기술을 그대로 복사한다.
   * 화면은 transform 을 보고 상대 모습으로 바꿔 그린다. 메타몽끼리면 서로 변신만 하다 끝난다.
   */
  const transform = (i, j) => {
    const me = F[i];
    const foe = F[j];
    me.types = [...foe.types];
    me.stats = { ...foe.stats, hp: me.stats.hp };
    me.stage = { ...foe.stage };
    me.moves = foe.moves.map((m) => ({ ...m }));
    me.transformed = true;
    say({ t: "info", side: i, transform: { dexId: foe.dexId, shiny: foe.shiny, side: j }, text: `${josa(nm(i), "은는")} ${nm(j)}(으)로 변신했다!` });
  };

  const applyAilment = (i, ail) => {
    const f = F[i];
    if (ail === "confusion") {
      if (f.confused) return;
      f.confused = 1 + Math.floor(rng() * 4);
      say({ t: "info", side: i, status: "confusion", text: `${josa(nm(i), "은는")} 혼란에 빠졌다!` });
      return;
    }
    if (!MAJOR.has(ail) || f.status) return;
    // 타입 면역: 불꽃은 화상, 얼음은 얼음, 독·강철은 독, 전기는 마비 (5세대)
    const tk = f.types.map((t) => TYPES[t] && TYPES[t].k);
    if ((ail === "burn" && tk.includes("fire")) || (ail === "freeze" && tk.includes("ice")) ||
        (ail === "poison" && (tk.includes("poison") || tk.includes("steel"))) || (ail === "paralysis" && tk.includes("electric"))) return;
    f.status = ail;
    if (ail === "sleep") f.sleep = 1 + Math.floor(rng() * 3);
    say({ t: "info", side: i, status: ail, text: `${josa(nm(i), "은는")} ${AIL_KO[ail]} 상태가 되었다!` });
  };

  /** 한쪽이 기술을 쓴다. 쓰러뜨렸으면 true */
  const act = (i, mv) => {
    const me = F[i];
    const j = 1 - i;
    const foe = F[j];

    // 움직이지 못하는 경우들
    if (me.status === "sleep") {
      if (--me.sleep > 0) return void say({ t: "info", side: i, text: `${josa(nm(i), "은는")} 쿨쿨 잠들어 있다.` });
      me.status = null;
      say({ t: "info", side: i, status: null, text: `${josa(nm(i), "은는")} 눈을 떴다!` });
    }
    if (me.status === "freeze") {
      if (rng() >= 0.2) return void say({ t: "info", side: i, text: `${josa(nm(i), "은는")} 얼어붙어서 움직일 수 없다!` });
      me.status = null;
      say({ t: "info", side: i, status: null, text: `${nm(i)}의 얼음이 녹았다!` });
    }
    if (me.flinch) {
      me.flinch = false;
      return void say({ t: "info", side: i, text: `${josa(nm(i), "은는")} 풀이 죽어 움직일 수 없었다!` });
    }
    if (me.status === "paralysis" && rng() < 0.25) {
      return void say({ t: "info", side: i, text: `${josa(nm(i), "은는")} 몸이 저려서 움직일 수 없다!` });
    }
    if (me.confused) {
      if (--me.confused <= 0) {
        say({ t: "info", side: i, status: "unconfused", text: `${nm(i)}의 혼란이 풀렸다!` });
      } else if (rng() < 0.5) {
        // 위력 40 무속성 물리로 자기를 때린다
        const d = damage(me, me, { p: 40, c: "physical", t: -1 }, rng, false).amount;
        setHp(i, me.hp - d, `${josa(nm(i), "은는")} 영문도 모르고 자신을 공격했다!`);
        return me.hp <= 0;
      }
    }

    say({ t: "move", side: i, move: { name: mv.n, typeKey: typeKey(mv), damageClass: mv.c, power: mv.p }, text: `${nm(i)}의 ${mv.n}!` });

    // 명중. 명중률이 없는 기술(칼춤 등)과 나에게 거는 기술은 반드시 맞는다
    const selfMove = mv.c === "status" && /user|ally/.test(mv.tg || "");
    if (mv.a != null && !selfMove) {
      const acc = mv.a * stageMul(me.stage.acc - foe.stage.eva, true);
      if (rng() * 100 >= acc) return void say({ t: "info", side: i, text: `그러나 ${nm(j)}에게는 맞지 않았다!` });
    }

    if (mv.id === TRANSFORM) return void transform(i, j);

    if (mv.c === "status") {
      let did = false;
      if (mv.hl) { setHp(i, me.hp + (me.maxHp * mv.hl) / 100, `${nm(i)}의 체력이 회복되었다!`); did = true; }
      if (mv.ail) {
        const before = mv.ail === "confusion" ? foe.confused : foe.status;
        applyAilment(j, mv.ail);
        did = did || (mv.ail === "confusion" ? foe.confused : foe.status) !== before;
      }
      for (const [stat, ch] of mv.st || []) { applyStat(statTarget(mv, ch) === "self" ? i : j, stat, ch); did = true; }
      if (!did) say({ t: "info", side: i, text: "하지만 아무 일도 일어나지 않았다!" });
      return false;
    }

    // 공격
    const n = mv.hits ? mv.hits[0] + Math.floor(rng() * (mv.hits[1] - mv.hits[0] + 1)) : 1;
    let dealt = 0;
    let lastE = 1;
    let hitCount = 0;
    for (let h = 0; h < n && foe.hp > 0; h++) {
      const crit = rng() < critChance(mv);
      const { amount, e } = damage(me, foe, mv, rng, crit);
      lastE = e;
      if (e === 0) break;
      dealt += amount;
      hitCount++;
      setHp(j, foe.hp - amount, crit ? "급소에 맞았다!" : "");
    }
    if (lastE === 0) return void say({ t: "info", side: j, text: `${nm(j)}에게는 효과가 없는 것 같다...` });
    if (lastE > 1) say({ t: "info", side: j, eff: lastE, text: "효과가 굉장했다!" });
    else if (lastE < 1) say({ t: "info", side: j, eff: lastE, text: "효과가 별로인 듯하다..." });
    if (n > 1) say({ t: "info", side: j, text: `${hitCount}번 맞았다!` });

    // 흡수·반동
    if (mv.dr > 0 && dealt) setHp(i, me.hp + Math.max(1, Math.floor((dealt * mv.dr) / 100)), `${nm(j)}에게서 체력을 흡수했다!`);
    if (mv.dr < 0 && dealt) setHp(i, me.hp - Math.max(1, Math.floor((dealt * -mv.dr) / 100)), `${josa(nm(i), "은는")} 반동으로 데미지를 입었다!`);

    if (foe.hp > 0) {
      if (mv.ail && rng() * 100 < (mv.ac || 100)) applyAilment(j, mv.ail);
      if (mv.fl && rng() * 100 < mv.fl) foe.flinch = true;
    }
    for (const [stat, ch] of mv.st || []) {
      const who = statTarget(mv, ch) === "self" ? i : j;
      if (F[who].hp <= 0) continue;
      if (rng() * 100 < (mv.sc || 100)) applyStat(who, stat, ch);
    }
    return foe.hp <= 0 || me.hp <= 0;
  };

  say({ t: "info", side: -1, text: `${nm(0)} Lv.${F[0].level} VS ${nm(1)} Lv.${F[1].level}` });

  let turn = 0;
  let stopped = false;
  while (F[0].hp > 0 && F[1].hp > 0 && turn < MAX_TURNS) {
    turn++;
    const picks = [choose(F[0], F[1], rng, opts.gentle === 0), choose(F[1], F[0], rng, opts.gentle === 1)];
    // 우선도 → 스피드 → 동률이면 동전
    const pr = (i) => (picks[i] ? picks[i].pr || 0 : 0);
    let order = [0, 1];
    if (pr(1) > pr(0) || (pr(1) === pr(0) && (eff(F[1], "spe") > eff(F[0], "spe") || (eff(F[1], "spe") === eff(F[0], "spe") && rng() < 0.5)))) order = [1, 0];
    F[0].flinch = F[1].flinch = false;
    for (const i of order) {
      if (F[0].hp <= 0 || F[1].hp <= 0) break;
      if (!picks[i]) { say({ t: "info", side: i, text: `${josa(nm(i), "은는")} 쓸 수 있는 기술이 없다!` }); continue; }
      act(i, picks[i]);
    }
    // 턴 끝 — 독·화상 1/8
    for (const i of order) {
      const f = F[i];
      if (f.hp <= 0 || (f.status !== "poison" && f.status !== "burn")) continue;
      setHp(i, f.hp - Math.max(1, Math.floor(f.maxHp / 8)), `${josa(nm(i), "은는")} ${f.status === "burn" ? "화상" : "독"} 데미지를 입었다!`);
    }
    F[0].flinch = F[1].flinch = false;
    // 멈출 때 — 야생을 잡으려고 약하게만 만들 때. 둘 다 서 있을 때만 멈춘다
    if (opts.stop && F[0].hp > 0 && F[1].hp > 0 && opts.stop(F)) { stopped = true; break; }
  }

  for (const i of [0, 1]) if (F[i].hp <= 0) say({ t: "faint", side: i, text: `${josa(nm(i), "은는")} 쓰러졌다!` });

  // 둘 다 서 있으면(턴 제한) 남은 체력 비율로, 둘 다 쓰러졌으면(반동) 무승부
  let winner = null;
  if (stopped) {
    if (opts.stopText) say({ t: "info", side: -1, text: opts.stopText(F) });
  } else if (F[0].hp > 0 && F[1].hp <= 0) winner = 0;
  else if (F[1].hp > 0 && F[0].hp <= 0) winner = 1;
  else if (F[0].hp > 0 && F[1].hp > 0) {
    const r0 = F[0].hp / F[0].maxHp;
    const r1 = F[1].hp / F[1].maxHp;
    if (r0 !== r1) winner = r0 > r1 ? 0 : 1;
    say({ t: "info", side: -1, text: `${MAX_TURNS}턴이 지나 판정으로 결정합니다.` });
  }
  if (!stopped) say({ t: "info", side: -1, text: winner == null ? "무승부!" : `${nm(winner)}의 승리!` });

  return {
    winner,
    stopped,
    turns: turn,
    // hp 는 시작할 때 체력 — 이어서 싸우면 가득이 아니다
    fighters: F.map((f, i) => ({ id: f.id, name: f.name, level: f.level, maxHp: f.maxHp, hp: hp0[i] })),
    // 끝났을 때 상태. 야생은 이걸 들고 다음 결투·포획으로 간다
    end: F.map((f) => ({ hp: f.hp, max: f.maxHp, status: f.status })),
    log,
  };
}

module.exports = { run, fighter, effectiveness, damage, josa, MAX_TURNS };
