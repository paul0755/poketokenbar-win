"use strict";
/**
 * 길드 레이드 결투 — 길드원 모두의 포켓몬이 함께 보스 하나와 싸운다(server/src/raid.js).
 *
 * 데미지 공식·상성·급소·랭크·상태이상은 battle.js 의 1:1 규칙 그대로다. 판만 여럿 대 하나로 넓힌다.
 *  - 길드원마다 한 마리씩 나온다. 도전한 사람(나)의 아이가 쓰러지면 그 턴이 끝난 뒤 판이 멈추고(step 의
 *    need), 내가 다른 아이를 골라 내보내면(swap) 이어서 싸운다. 다른 길드원은 지금 없어서 대표 한 마리뿐이다.
 *  - 보스의 체력은 "칸"으로 쌓여 있다. 한 칸은 1:1 에서 한 번 쓰러뜨릴 만큼(그 보스의 최대 HP)이다.
 *  - 보스는 한 턴에 기술 하나를 골라 서 있는 아이 모두에게 쓴다. 그래서 아이 하나하나는 1:1 과 비슷하게
 *    버티고, 여럿이 나오면 그만큼 더 깎는다(한 마리씩만 때리면 뒤에 선 아이들이 공짜로 오래 때린다).
 *  - 보스는 상태이상·혼란·풀죽음에 걸리지 않고, 능력치는 BOSS_FLOOR 단계까지만 떨어진다 — 서른 마리가
 *    번갈아 걸면 보스가 한 번도 못 움직인다.
 *  - 아이가 모두 쓰러지거나, 남은 체력을 다 깎거나, RAID_TURNS 턴이 지나면 끝난다.
 *
 * battle.js 를 고치지 않고 여기 따로 둔다 — battle.js 는 친선 배틀 데이터 버전(friend.dataVersion)에
 * 들어가서, 고치면 옛 버전 앱과 친선 배틀이 안 된다. 그래서 내보내지 않은 작은 도우미 몇 개를 옮겨 왔다.
 */
const { fighter, effectiveness, damage, josa } = require("./battle");
const friend = require("./friend");

const TYPES = require("./types.json");

const RAID_TURNS = 10;
const BOSS_FLOOR = -2; // 보스의 능력치는 이만큼까지만 떨어진다 — 여럿이 울음소리를 겹쳐 쓰면 보스가 아무것도 못 한다
const TRANSFORM = 144; // 변신 — 메타몽
const GENDERS = ["무성", "수컷", "암컷"];

const STAT_OF = { attack: "atk", defense: "def", "special-attack": "spa", "special-defense": "spd", speed: "spe", accuracy: "acc", evasion: "eva" };
const STAT_KO = { atk: "공격", def: "방어", spa: "특수공격", spd: "특수방어", spe: "스피드", acc: "명중률", eva: "회피율" };
const AIL_KO = { paralysis: "마비", burn: "화상", poison: "독", sleep: "잠듦", freeze: "얼음", confusion: "혼란" };
const MAJOR = new Set(["paralysis", "burn", "poison", "sleep", "freeze"]);

/* ---------------- battle.js 에서 옮겨 온 것 ---------------- */

const stageMul = (n, acc = false) => {
  const b = acc ? 3 : 2;
  return n >= 0 ? (b + n) / b : b / (b - n);
};
const powerOf = (mv) => mv.p || 50;
function eff(f, key) {
  let v = f.stats[key] * stageMul(f.stage[key]);
  if (key === "spe" && f.status === "paralysis") v /= 4;
  return v;
}
const critChance = (mv) => [1 / 16, 1 / 8, 1 / 4, 1 / 3, 1 / 2][Math.min(4, mv.cr || 0)];
function statTarget(mv, change) {
  if (mv.c === "status") return /user|ally/.test(mv.tg || "") ? "self" : "foe";
  if (change > 0) return "self";
  return !mv.sc || mv.sc >= 100 ? "self" : "foe";
}
/** 기술 고르기 — battle.js choose 와 같다(잡을 때의 gentle 만 뺐다). foeImmune 이면 상태이상 기술은 고르지 않는다 */
function choose(me, foe, rng, foeImmune = false) {
  const scored = me.moves.map((mv) => {
    if (mv.c !== "status") {
      const e = effectiveness(mv.t, foe.types);
      if (e === 0) return [mv, 0];
      const stab = me.types.includes(mv.t) ? 1.5 : 1;
      const phys = mv.c === "physical";
      const ratio = eff(me, phys ? "atk" : "spa") / Math.max(1, eff(foe, phys ? "def" : "spd"));
      const hits = mv.hits ? (mv.hits[0] + mv.hits[1]) / 2 : 1;
      let sc = powerOf(mv) * hits * stab * e * ratio * ((mv.a || 100) / 100);
      if (mv.dr < 0 && me.hp < me.maxHp * 0.3) sc *= 0.5;
      return [mv, sc];
    }
    let sc = 0;
    if (mv.hl && me.hp < me.maxHp * 0.5) sc = 120;
    if (!foeImmune && mv.ail && MAJOR.has(mv.ail) && !foe.status) sc = Math.max(sc, 70);
    if (!foeImmune && mv.ail === "confusion" && !foe.confused) sc = Math.max(sc, 45);
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

/* ---------------- 길드원의 팀 코드 ---------------- */

/**
 * 길드에 올려 둔 대표 팀 코드(PTB1-)를 읽는다. friend.decode 와 달리 데이터 버전을 따지지 않는다 —
 * 레이드는 내 PC 에서만 돌리니 길드원이 옛 버전이어도 같이 싸울 수 있어야 한다. 말이 안 되면 null.
 */
function parseTeam(code) {
  const m = /^PTB1-([A-Za-z0-9_-]+)-[0-9a-z]{5}$/.exec(String(code || ""));
  if (!m) return null;
  let arr;
  try {
    arr = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const [ver, , , , d] = arr || [];
  if (ver !== 1 || !Array.isArray(d)) return null;
  const [line, nature, shiny, ivs, g, ability, eggMoves, tmMoves, grown, lv] = d;
  const mon = { line, nature, shiny: Boolean(shiny), ivs, gender: GENDERS[g], ability, eggMoves, tmMoves };
  if (lv) mon.lvGrown = lv;
  if (friend.validate(mon, grown)) return null;
  return { mon, grown };
}

/* ---------------- 한 판 ---------------- */

/**
 * 판을 연다. step() 으로 한 토막씩 싸운다 — 내 아이가 쓰러지면 멈춘다.
 *   allies  [{ mon, grown, owner, member, me }]  — 함께 싸우는 아이들(member: 주인의 길드원 번호). 나는 0번
 *   boss    { mon, grown }
 *   opts    { level, bars }          — bars: 보스가 시작할 때 남은 칸(소수)
 *
 *   step()   → { log, need, over }   need: 내 아이가 쓰러졌다 — swap 이나 stop 을 기다린다
 *   swap(a)  내 다음 아이를 내보낸다({ mon, grown, owner, member, me: true })
 *   stop()   그만 싸운다 — 다음 step() 이 끝을 낸다
 *   result() → { turns, defeated, dealt, allies, boss }
 *
 * 사건(ev)의 who 는 아이 번호(0..) 또는 "b"(보스), 판 전체 글이면 null.
 *   { t: "turn", n, text }
 *   { t: "enter", who, text }        내가 고른 다음 아이가 나왔다
 *   { t: "move", who, move:{name,typeKey,damageClass,power}, text }
 *   { t: "hp",   who, hp, max, text }
 *   { t: "info", who, text, eff?, status?, transform? }
 *   { t: "faint", who, text }
 */
function start(allies, boss, rng, opts = {}) {
  const level = opts.level || 50;
  const team = allies.map((a) => ({ a, f: fighter(a.mon, a.grown, level) })).filter((x) => x.f);
  const A = team.map((x) => x.f);
  const B = fighter(boss.mon, boss.grown, level);
  if (!A.length || !B) return null;
  const bar = B.maxHp;
  const pool = Math.max(1, Math.round(bar * (opts.bars || 1)));
  B.hp = B.maxHp = pool;
  B.bar = bar;
  B.moves = B.moves.filter((mv) => mv.id !== TRANSFORM);
  const dealtBy = A.map(() => 0);
  let my = team.findIndex((x) => x.a.me); // 지금 나가 있는 내 아이

  const log = [];
  const say = (e) => log.push(e);
  const F = (who) => (who === "b" ? B : A[who]);
  const nm = (who) => (who === "b" ? `보스 ${B.name}` : A[who].name);
  const typeKey = (mv) => (TYPES[mv.t] ? TYPES[mv.t].k : "normal");
  const fainted = new Set();

  const setHp = (who, hp, text) => {
    const f = F(who);
    f.hp = Math.max(0, Math.min(f.maxHp, Math.round(hp)));
    say({ t: "hp", who, hp: f.hp, max: f.maxHp, text });
    if (f.hp <= 0 && !fainted.has(who)) {
      fainted.add(who);
      say({ t: "faint", who, text: who === "b" ? `${josa(nm(who), "을를")} 쓰러뜨렸다!` : `${josa(nm(who), "은는")} 쓰러졌다!` });
    }
  };
  // 회복 — 보스는 한 칸을 기준으로 채우고, 시작할 때 체력을 넘지 않는다
  const heal = (who, pct) => {
    const f = F(who);
    const full = who === "b" ? bar : f.maxHp;
    setHp(who, f.hp + Math.max(1, Math.floor((full * pct) / 100)), `${nm(who)}의 체력이 회복되었다!`);
  };

  const applyStat = (who, stat, ch) => {
    const k = STAT_OF[stat];
    if (!k) return;
    const f = F(who);
    const before = f.stage[k];
    f.stage[k] = Math.max(who === "b" ? BOSS_FLOOR : -6, Math.min(6, before + ch));
    if (f.stage[k] === before) return void say({ t: "info", who, text: `${nm(who)}의 ${josa(STAT_KO[k], "은는")} 더 ${ch > 0 ? "오르지" : "떨어지지"} 않는다!` });
    const how = Math.abs(ch) >= 3 ? "극적으로" : Math.abs(ch) === 2 ? "크게" : "";
    say({ t: "info", who, stat: k, change: ch, text: `${nm(who)}의 ${josa(STAT_KO[k], "이가")} ${how ? how + " " : ""}${ch > 0 ? "올랐다" : "떨어졌다"}!` });
  };

  /** 상태이상 — 아이에게만 걸린다. 타입 면역은 5세대 그대로 */
  const applyAilment = (i, ail) => {
    const f = A[i];
    if (ail === "confusion") {
      if (f.confused) return;
      f.confused = 1 + Math.floor(rng() * 4);
      return void say({ t: "info", who: i, status: "confusion", text: `${josa(nm(i), "은는")} 혼란에 빠졌다!` });
    }
    if (!MAJOR.has(ail) || f.status) return;
    const tk = f.types.map((t) => TYPES[t] && TYPES[t].k);
    if ((ail === "burn" && tk.includes("fire")) || (ail === "freeze" && tk.includes("ice")) ||
        (ail === "poison" && (tk.includes("poison") || tk.includes("steel"))) || (ail === "paralysis" && tk.includes("electric"))) return;
    f.status = ail;
    if (ail === "sleep") f.sleep = 1 + Math.floor(rng() * 3);
    say({ t: "info", who: i, status: ail, text: `${josa(nm(i), "은는")} ${AIL_KO[ail]} 상태가 되었다!` });
  };

  const stuck = (i, text) => {
    say({ t: "info", who: i, text });
    return false;
  };
  /** 아이가 움직일 수 있나 — 잠듦·얼음·풀죽음·마비·혼란. 못 움직이면 false */
  const canMove = (i) => {
    const me = A[i];
    if (me.status === "sleep") {
      if (--me.sleep > 0) return stuck(i, `${josa(nm(i), "은는")} 쿨쿨 잠들어 있다.`);
      me.status = null;
      say({ t: "info", who: i, status: null, text: `${josa(nm(i), "은는")} 눈을 떴다!` });
    }
    if (me.status === "freeze") {
      if (rng() >= 0.2) return stuck(i, `${josa(nm(i), "은는")} 얼어붙어서 움직일 수 없다!`);
      me.status = null;
      say({ t: "info", who: i, status: null, text: `${nm(i)}의 얼음이 녹았다!` });
    }
    if (me.flinch) {
      me.flinch = false;
      return stuck(i, `${josa(nm(i), "은는")} 풀이 죽어 움직일 수 없었다!`);
    }
    if (me.status === "paralysis" && rng() < 0.25) return stuck(i, `${josa(nm(i), "은는")} 몸이 저려서 움직일 수 없다!`);
    if (me.confused) {
      if (--me.confused <= 0) say({ t: "info", who: i, status: "unconfused", text: `${nm(i)}의 혼란이 풀렸다!` });
      else if (rng() < 0.5) {
        const d = damage(me, me, { p: 40, c: "physical", t: -1 }, rng, false).amount;
        setHp(i, me.hp - d, `${josa(nm(i), "은는")} 영문도 모르고 자신을 공격했다!`);
        return false;
      }
    }
    return true;
  };

  const moveEv = (who, mv) => say({ t: "move", who, move: { name: mv.n, typeKey: typeKey(mv), damageClass: mv.c, power: mv.p }, text: `${nm(who)}의 ${mv.n}!` });
  const effText = (e) => (e > 1 ? "효과가 굉장했다!" : e < 1 ? "효과가 별로인 듯하다..." : "");

  /** 아이 i 가 보스에게 기술을 쓴다 */
  const actAlly = (i, mv) => {
    const me = A[i];
    if (!canMove(i) || me.hp <= 0) return;
    moveEv(i, mv);
    const selfMove = mv.c === "status" && /user|ally/.test(mv.tg || "");
    if (mv.a != null && !selfMove && rng() * 100 >= mv.a * stageMul(me.stage.acc - B.stage.eva, true)) {
      return void say({ t: "info", who: i, text: `그러나 ${nm("b")}에게는 맞지 않았다!` });
    }
    if (mv.id === TRANSFORM) {
      me.types = [...B.types];
      me.stats = { ...B.stats, hp: me.stats.hp };
      me.stage = { ...B.stage };
      me.moves = B.moves.map((m) => ({ ...m }));
      return void say({ t: "info", who: i, transform: { dexId: B.dexId, shiny: B.shiny }, text: `${josa(nm(i), "은는")} ${nm("b")}(으)로 변신했다!` });
    }
    if (mv.c === "status") {
      let did = false;
      if (mv.hl) { heal(i, mv.hl); did = true; }
      if (mv.ail && !selfMove) { say({ t: "info", who: "b", text: `${nm("b")}에게는 통하지 않았다!` }); did = true; }
      for (const [stat, ch] of mv.st || []) { applyStat(statTarget(mv, ch) === "self" ? i : "b", stat, ch); did = true; }
      if (!did) say({ t: "info", who: i, text: "하지만 아무 일도 일어나지 않았다!" });
      return;
    }
    const n = mv.hits ? mv.hits[0] + Math.floor(rng() * (mv.hits[1] - mv.hits[0] + 1)) : 1;
    let dealt = 0;
    let lastE = 1;
    let crits = 0;
    for (let h = 0; h < n && B.hp > 0; h++) {
      const crit = rng() < critChance(mv);
      const { amount, e } = damage(me, B, mv, rng, crit);
      lastE = e;
      if (e === 0) break;
      dealt += Math.min(amount, B.hp);
      if (crit) crits++;
      setHp("b", B.hp - amount, [crit ? "급소에 맞았다!" : "", h === n - 1 || B.hp - amount <= 0 ? effText(e) : ""].filter(Boolean).join(" "));
    }
    if (lastE === 0) return void say({ t: "info", who: "b", text: `${nm("b")}에게는 효과가 없는 것 같다...` });
    dealtBy[i] += dealt;
    if (n > 1) say({ t: "info", who: "b", text: `${n}번 맞았다!` });
    if (mv.dr > 0 && dealt) setHp(i, me.hp + Math.max(1, Math.floor((dealt * mv.dr) / 100)), `${nm("b")}에게서 체력을 흡수했다!`);
    if (mv.dr < 0 && dealt) setHp(i, me.hp - Math.max(1, Math.floor((dealt * -mv.dr) / 100)), `${josa(nm(i), "은는")} 반동으로 데미지를 입었다!`);
    for (const [stat, ch] of mv.st || []) {
      const who = statTarget(mv, ch) === "self" ? i : "b";
      if (F(who).hp <= 0) continue;
      if (rng() * 100 < (mv.sc || 100)) applyStat(who, stat, ch);
    }
  };

  /** 보스가 기술 하나를 서 있는 아이 모두에게 쓴다 */
  const actBoss = (mv) => {
    moveEv("b", mv);
    const selfMove = mv.c === "status" && /user|ally/.test(mv.tg || "");
    const targets = A.map((_, i) => i).filter((i) => A[i].hp > 0);
    if (selfMove) {
      if (mv.hl) heal("b", mv.hl);
      for (const [stat, ch] of mv.st || []) applyStat("b", stat, ch);
      if (!mv.hl && !(mv.st || []).length) say({ t: "info", who: "b", text: "하지만 아무 일도 일어나지 않았다!" });
      return;
    }
    let dealt = 0;
    for (const i of targets) {
      const foe = A[i];
      if (mv.a != null && rng() * 100 >= mv.a * stageMul(B.stage.acc - foe.stage.eva, true)) {
        say({ t: "info", who: i, text: `${nm(i)}에게는 맞지 않았다!` });
        continue;
      }
      if (mv.c === "status") {
        if (mv.ail) applyAilment(i, mv.ail);
        for (const [stat, ch] of mv.st || []) applyStat(i, stat, ch);
        continue;
      }
      const n = mv.hits ? mv.hits[0] + Math.floor(rng() * (mv.hits[1] - mv.hits[0] + 1)) : 1;
      let lastE = 1;
      for (let h = 0; h < n && foe.hp > 0; h++) {
        const crit = rng() < critChance(mv);
        const { amount, e } = damage(B, foe, mv, rng, crit);
        lastE = e;
        if (e === 0) break;
        dealt += Math.min(amount, foe.hp);
        setHp(i, foe.hp - amount, [`${nm(i)}에게`, crit ? "급소에 맞았다!" : "", effText(e)].filter(Boolean).join(" "));
      }
      if (lastE === 0) { say({ t: "info", who: i, text: `${nm(i)}에게는 효과가 없는 것 같다...` }); continue; }
      if (foe.hp > 0) {
        if (mv.ail && rng() * 100 < (mv.ac || 100)) applyAilment(i, mv.ail);
        if (mv.fl && rng() * 100 < mv.fl) foe.flinch = true;
      }
      for (const [stat, ch] of mv.st || []) {
        if (statTarget(mv, ch) === "self") continue;
        if (foe.hp > 0 && rng() * 100 < (mv.sc || 100)) applyStat(i, stat, ch);
      }
    }
    // 보스 자신에게 오는 것(흡수·반동·랭크)은 한 번만 — 맞힌 아이 수로 나눠 1:1 한 번만큼
    const per1 = Math.max(1, targets.length);
    if (mv.dr > 0 && dealt) setHp("b", B.hp + Math.max(1, Math.floor((dealt * mv.dr) / 100 / per1)), `${josa(nm("b"), "은는")} 체력을 흡수했다!`);
    if (mv.dr < 0 && dealt) setHp("b", B.hp - Math.max(1, Math.floor((dealt * -mv.dr) / 100 / per1)), `${josa(nm("b"), "은는")} 반동으로 데미지를 입었다!`);
    if (mv.c !== "status" && B.hp > 0) {
      for (const [stat, ch] of mv.st || []) if (statTarget(mv, ch) === "self" && rng() * 100 < (mv.sc || 100)) applyStat("b", stat, ch);
    }
  };

  const alive = () => A.some((f) => f.hp > 0);
  say({ t: "info", who: null, text: `길드원 ${A.length}명의 포켓몬 VS ${nm("b")} Lv.${B.level}` });

  let turn = 0;
  let stopped = false;
  let over = false;
  const myDown = () => my < 0 || A[my].hp <= 0;

  /** 한 턴 */
  function oneTurn() {
    turn++;
    say({ t: "turn", who: null, n: turn, text: `— ${turn}턴 —` });
    const live = A.map((_, i) => i).filter((i) => A[i].hp > 0);
    const focus = live[Math.floor(rng() * live.length)];
    const picks = new Map(live.map((i) => [i, choose(A[i], B, rng, true)]));
    picks.set("b", choose(B, A[focus], rng));
    // 우선도 → 스피드 → 동률이면 미리 뽑아 둔 수로
    const actors = [...picks.keys()].map((who) => ({ who, pr: picks.get(who) ? picks.get(who).pr || 0 : 0, spe: eff(F(who), "spe"), tie: rng() }));
    actors.sort((x, y) => y.pr - x.pr || y.spe - x.spe || y.tie - x.tie);
    for (const { who } of actors) {
      if (B.hp <= 0 || !alive()) break;
      if (F(who).hp <= 0) continue;
      const mv = picks.get(who);
      if (!mv) { say({ t: "info", who, text: `${josa(nm(who), "은는")} 쓸 수 있는 기술이 없다!` }); continue; }
      if (who === "b") actBoss(mv);
      else actAlly(who, mv);
    }
    A.forEach((f) => (f.flinch = false));
    for (const i of live) {
      const f = A[i];
      if (f.hp <= 0 || B.hp <= 0 || (f.status !== "poison" && f.status !== "burn")) continue;
      setHp(i, f.hp - Math.max(1, Math.floor(f.maxHp / 8)), `${josa(nm(i), "은는")} ${f.status === "burn" ? "화상" : "독"} 데미지를 입었다!`);
    }
  }

  /** 다음 토막 — 끝나거나 내 아이가 쓰러질 때까지 */
  function step() {
    while (!over) {
      if (stopped || B.hp <= 0 || turn >= RAID_TURNS || !alive()) { over = true; break; }
      oneTurn();
      if (myDown() && B.hp > 0 && turn < RAID_TURNS) break; // 내 아이가 쓰러졌다 — 이 턴이 끝난 뒤 멈추고 다음 아이를 기다린다
    }
    if (over) {
      if (B.hp > 0 && turn >= RAID_TURNS) say({ t: "info", who: null, text: `${RAID_TURNS}턴이 지나 ${josa(nm("b"), "이가")} 물러났다!` });
      else if (B.hp > 0 && !alive()) say({ t: "info", who: null, text: "길드원의 포켓몬이 모두 쓰러졌다…" });
      else if (B.hp > 0 && stopped) say({ t: "info", who: null, text: "도전을 마쳤다." });
    }
    const seg = log.splice(0);
    return { log: seg, need: !over && my >= 0 && A[my].hp <= 0, over };
  }

  function swap(a) {
    const f = fighter(a.mon, a.grown, level);
    if (!f || over) return false;
    team.push({ a, f });
    A.push(f);
    dealtBy.push(0);
    my = A.length - 1;
    say({ t: "enter", who: my, text: `가랏, ${f.name}!` });
    return true;
  }

  const per = (hp) => Math.round((hp / bar) * 1000); // HP → 천분율(1000 = 한 칸)
  const result = () => ({
    turns: turn,
    defeated: B.hp <= 0,
    dealt: B.hp <= 0 ? per(pool) : Math.max(0, per(pool - B.hp)),
    allies: A.map((f, i) => ({ id: f.id, name: f.name, owner: team[i].a.owner || "", member: team[i].a.member || null, me: Boolean(team[i].a.me), dexId: f.dexId, shiny: f.shiny, level: f.level, maxHp: f.maxHp, hp: f.maxHp, dealt: per(dealtBy[i]), left: A[i].hp })),
    boss: { id: B.id, name: B.name, dexId: B.dexId, level: B.level, bar, hp: pool, max: pool },
  });

  return { step, swap, stop: () => (stopped = true), result };
}

/** 고르지 않고 끝까지 — 내 아이가 쓰러지면 그만둔다(시뮬레이션용) */
function run(allies, boss, rng, opts = {}) {
  const b = start(allies, boss, rng, opts);
  if (!b) return null;
  const log = [];
  for (;;) {
    const seg = b.step();
    log.push(...seg.log);
    if (seg.over) break;
    if (seg.need) b.stop();
  }
  return { ...b.result(), log };
}

module.exports = { start, run, parseTeam, RAID_TURNS };
