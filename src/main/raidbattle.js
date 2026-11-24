"use strict";
/**
 * 길드 레이드 결투 — 길드원 모두의 포켓몬이 함께 보스 하나와 싸운다(server/src/raid.js).
 *
 * 데미지 공식·상성·급소·랭크·상태이상·✨ 특성·🌦️ 날씨는 battle.js 의 1:1 규칙 그대로다. 판만 여럿 대 하나로 넓힌다.
 *  - 길드원마다 한 마리씩 나온다. 도전한 사람(나)의 아이가 쓰러지면 그 턴이 끝난 뒤 판이 멈추고(step 의
 *    need), 내가 다른 아이를 골라 내보내면(swap) 이어서 싸운다. 다른 길드원은 지금 없어서 고를 수 없다 —
 *    올려 둔 후보(bench)가 있으면 쓰러진 턴이 끝날 때 다음 후보가 그 자리에 저절로 나온다(올린 순서대로).
 *  - 보스의 체력은 "칸"으로 쌓여 있다. 한 칸은 1:1 에서 한 번 쓰러뜨릴 만큼(그 보스의 최대 HP)이다.
 *  - 보스는 한 턴에 기술 하나를 골라 서 있는 아이 모두에게 쓴다. 그래서 아이 하나하나는 1:1 과 비슷하게
 *    버티고, 여럿이 나오면 그만큼 더 깎는다(한 마리씩만 때리면 뒤에 선 아이들이 공짜로 오래 때린다).
 *  - 보스는 상태이상·혼란·풀죽음에 걸리지 않고, 능력치는 BOSS_FLOOR 단계까지만 떨어진다 — 서른 마리가
 *    번갈아 걸면 보스가 한 번도 못 움직인다.
 *  - 아이가 모두 쓰러지거나, 남은 체력을 다 깎거나, RAID_TURNS 턴이 지나면 끝난다.
 *
 * ✨ 특성 (0.20.0) — 1:1 의 특성을 여럿 대 하나에 맞춰 옮겼다.
 *  - 데미지에 끼는 특성(천하장사 · 적응력 · 두꺼운지방 · 멀티스케일 · 스킨 …)은 battle.damage 가 그대로 센다
 *  - 나올 때: 위협은 아이가 나오면 보스에게, 보스가 나오면 서 있는 아이 모두에게. 날씨 특성 · 다운로드 · 트레이스 ·
 *    괴짜 · 슬로스타트 · 위험예지 · 예지몽 · 프레셔 · 틀깨기
 *  - 막기(부유 · 축전 · 피뢰침 …) · 옹골참(아이만) · 상태이상 막기 · 능력치 하락 막기 · 오기 · 승기 · 심술꾸러기 · 단순
 *  - 맞으면: 까칠한피부 · 철가시 · 유폭 · 내용물분출은 보스에게도 — 한 칸(1:1 의 최대 HP)을 기준으로 깎고, 깎은 몫은 그 아이 것.
 *    정전기 · 불꽃몸 · 독가시 · 포자는 보스가 상태이상에 걸리지 않아서 아이에게만
 *  - 턴 끝: 가속 · 변덕쟁이 · 포이즌힐 · 탈피 · 촉촉바디 · 젖은접시 · 아이스바디 · 건조피부 · 선파워 · 나이트메어
 *  - 🌦️ 날씨 5턴은 판 전체에 하나. 모래바람 · 싸라기눈은 보스도 한 칸의 1/16 씩 깎는다
 *  - 화학변화가스는 레이드에서 움직이지 않는다(서른 마리의 특성을 한꺼번에 끄게 된다)
 *
 * battle.js 의 1:1 진행(run)은 쓰지 않는다 — 도우미(battle.abil)만 빌린다.
 */
const battle = require("./battle");
const { effectiveness, damage, josa, fighter } = battle;
const { has, guard, moveAs, absorbOf, critChance, effOf, ailGuardOf, dropGuardOf, weather, moveWeather, isType, WEATHER_KO, WEATHER_TURNS } = battle.abil;
const speedOf = (f) => battle.abil.eff(f, "spe");
const AB = require("./ability");
const K = AB.K;
const friend = require("./friend");
const mega = require("./mega");
const poke = require("./pokemon");

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
  return key === "spe" ? speedOf(f) : f.stats[key] * stageMul(f.stage[key]);
}
function statTarget(mv, change) {
  if (mv.c === "status") return /user|ally/.test(mv.tg || "") ? "self" : "foe";
  if (change > 0) return "self";
  return !mv.sc || mv.sc >= 100 ? "self" : "foe";
}
/** 나에게 쓰는 변화 기술(날씨 기술도 — 판 전체에 건다) */
const selfMove = (mv) => mv.c === "status" && /user|ally|entire-field/.test(mv.tg || "");
/**
 * 기술 고르기 — battle.js choose 와 같다(잡을 때의 gentle 만 뺐다). foeImmune 이면 상태이상 기술은 고르지 않는다.
 * ✨ 상대의 특성이 막는 기술(부유에게 지진)은 고르지 않는다
 */
function choose(me, foe, rng, foeImmune = false) {
  const scored = me.moves.map((mv0) => {
    const mv = moveAs(me, mv0);
    if (absorbOf(me, foe, mv)) return [mv0, 0];
    if (mv.c !== "status") {
      const e = effOf(me, foe, mv);
      if (e === 0) return [mv0, 0];
      const stab = me.types.includes(mv.t) ? (has(me, K.적응력) ? 2 : 1.5) : 1;
      const phys = mv.c === "physical";
      const ratio = eff(me, phys ? "atk" : "spa") / Math.max(1, eff(foe, phys ? "def" : "spd"));
      const hits = mv.hits ? (mv.hits[0] + mv.hits[1]) / 2 : 1;
      let sc = powerOf(mv) * hits * stab * e * ratio * ((mv.a || 100) / 100);
      if (mv.dr < 0 && me.hp < me.maxHp * 0.3) sc *= 0.5;
      return [mv0, sc];
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
    return [mv0, sc];
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
  const [line, nature, shiny, ivs, g, ability, eggMoves, tmMoves, grown, lv, plain, stone, moveSet, forgot] = d;
  const mon = { line, nature, shiny: Boolean(shiny), ivs, gender: GENDERS[g], ability, eggMoves, tmMoves };
  if (lv) mon.lvGrown = lv;
  if (plain === 1) mon.plain = true;
  if (Array.isArray(moveSet) && moveSet.length) mon.moveSet = moveSet; // 💿 고른 기술
  if (Array.isArray(forgot) && forgot.length) mon.moveForgot = forgot; // 🗑 잊은 레벨업 기술
  // 고른 기술 · 잊은 기술만 틀렸으면 그것만 버리고 자동으로
  if (friend.validate(mon, grown)) { delete mon.moveSet; delete mon.moveForgot; if (friend.validate(mon, grown)) return null; }
  // 💎 지닌 메가스톤(0.16.0~ 의 코드) — 그 라인에 맞지 않으면 돌만 버린다(아이는 그대로 싸운다)
  if (stone && mega.isStone(stone) && poke.LINES[line] && mega.lineFits(poke.LINES[line].ids, stone)) mon.hold = stone;
  return { mon, grown };
}

/* ---------------- 한 판 ---------------- */

/**
 * 판을 연다. step() 으로 한 토막씩 싸운다 — 내 아이가 쓰러지면 멈춘다.
 *   allies  [{ mon, grown, owner, member, me, bench }]  — 함께 싸우는 아이들(member: 주인의 길드원 번호). 나는 0번
 *           bench: [{ mon, grown }] 다른 길드원의 후보 — 앞 아이가 쓰러지면 차례로 그 자리에 나온다
 *   boss    { mon, grown }
 *   opts    { level, bars, megaBudget } — bars: 보스가 시작할 때 남은 칸(소수)
 *           💎 a.mega(폼)를 들고 나오면 메가진화한다. 자리마다 한 번에 하나 — 메가진화한 아이가 쓰러지고 다음 아이가
 *           나오면(swap · 후보) 그 아이가 다시 할 수 있다. 내 아이(a.me)는 megaBudget(⚡ 메가 에너지)만큼만,
 *           길드원의 아이는 에너지 없이(코드에 실린 돌만 있으면 — 친선 결투와 같다). 보스는 하지 않는다
 *
 *   step()   → { log, need, over }   need: 내 아이가 쓰러졌다 — swap 이나 stop 을 기다린다
 *   swap(a)  내 다음 아이를 내보낸다({ mon, grown, owner, member, me: true })
 *   stop()   그만 싸운다 — 다음 step() 이 끝을 낸다
 *   result() → { turns, defeated, dealt, allies, boss, megaUsed }
 *
 * 사건(ev)의 who 는 아이 번호(0..) 또는 "b"(보스), 판 전체 글이면 null.
 *   { t: "turn", n, text }
 *   { t: "enter", who, slot, text }  다음 아이가 나왔다(내가 골랐거나 길드원의 후보) — slot 자리에 선다
 *   { t: "move", who, move:{name,typeKey,damageClass,power}, text }
 *   { t: "hp",   who, hp, max, text }
 *   { t: "info", who, text, eff?, status?, transform?, mega?, ability?, weather? }   mega: { key, id, name } 💎 · ability: 움직인 특성 이름 ✨
 *   { t: "faint", who, text }
 */
function start(allies, boss, rng, opts = {}) {
  const level = opts.level || 50;
  const team = allies.map((a) => ({ a, f: fighter(a.mon, a.grown, level) })).filter((x) => x.f);
  team.forEach((x, i) => (x.slot = i)); // 자리 — 쓰러지면 다음 아이가 같은 자리에 선다
  const A = team.map((x) => x.f);
  const cur = team.map((_, i) => i); // 자리마다 지금 나가 있는 아이 번호
  const bench = team.map((x) => (!x.a.me && Array.isArray(x.a.bench) ? x.a.bench.slice() : [])); // 자리마다 남은 후보
  const B = fighter(boss.mon, boss.grown, level);
  if (!A.length || !B) return null;
  const bar = B.maxHp;
  const pool = Math.max(1, Math.round(bar * (opts.bars || 1)));
  B.hp = B.maxHp = pool;
  B.bar = bar;
  B.moves = B.moves.filter((mv) => mv.id !== TRANSFORM);
  const dealtBy = A.map(() => 0);
  let my = team.findIndex((x) => x.a.me); // 지금 나가 있는 내 아이

  // 🌦️ 날씨는 판 전체에 하나 — battle.js 의 weather(f) 가 f.field 를 본다(F 는 날씨부정 · 에어록을 찾는 곳)
  const field = { w: null, wt: 0, F: [] };
  const join = (f) => { f.field = field; field.F.push(f); };
  join(B);
  A.forEach(join);

  const log = [];
  const say = (e) => log.push(e);
  const F = (who) => (who === "b" ? B : A[who]);
  const nm = (who) => (who === "b" ? `보스 ${B.name}` : A[who].name);
  const typeKey = (mv) => (TYPES[mv.t] ? TYPES[mv.t].k : "normal");
  const fainted = new Set();
  const living = () => A.map((_, i) => i).filter((i) => A[i].hp > 0);
  /** ✨ 특성이 움직였다 — 기본 문장은 "○○의 위협!" */
  const pop = (who, text) => {
    const n = AB.name(F(who).ab);
    say({ t: "info", who, ability: n, text: text || `${nm(who)}의 ${n}!` });
  };

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
  /** 비율로 깎는다 — 보스는 한 칸 기준. 깎은 만큼 돌려준다. by 가 아이면 보스를 깎은 몫이 그 아이 것 */
  const hurt = (who, frac, text, by = null) => {
    const f = F(who);
    const n = Math.min(f.hp, Math.max(1, Math.floor((who === "b" ? bar : f.maxHp) * frac)));
    setHp(who, f.hp - n, text);
    if (who === "b" && by != null && by !== "b") dealtBy[by] += n;
    return n;
  };

  /**
   * 능력치 변화. by 는 일으킨 쪽 — 상대가 떨어뜨리면 막는 특성(클리어바디 · 괴력집게 …) · 오기 · 승기가 본다.
   * 심술꾸러기 · 단순은 늘
   */
  const applyStat = (who, stat, ch, by = who) => {
    const k = STAT_OF[stat];
    if (!k) return false;
    const f = F(who);
    const byFoe = by !== who && (by === "b") !== (who === "b");
    if (has(f, K.심술꾸러기)) ch = -ch;
    if (has(f, K.단순)) ch *= 2;
    if (ch < 0 && byFoe) {
      const blk = dropGuardOf(f, k, F(by));
      if (blk) {
        say({ t: "info", who, ability: AB.name(blk), text: `${nm(who)}의 ${AB.name(blk)}! ${josa(STAT_KO[k], "은는")} 떨어지지 않는다!` });
        return false;
      }
    }
    const before = f.stage[k];
    f.stage[k] = Math.max(who === "b" ? BOSS_FLOOR : -6, Math.min(6, before + ch));
    if (f.stage[k] === before) {
      say({ t: "info", who, text: `${nm(who)}의 ${josa(STAT_KO[k], "은는")} 더 ${ch > 0 ? "오르지" : "떨어지지"} 않는다!` });
      return false;
    }
    const how = Math.abs(ch) >= 3 ? "극적으로" : Math.abs(ch) === 2 ? "크게" : "";
    say({ t: "info", who, stat: k, change: ch, text: `${nm(who)}의 ${josa(STAT_KO[k], "이가")} ${how ? how + " " : ""}${ch > 0 ? "올랐다" : "떨어졌다"}!` });
    if (ch < 0 && byFoe && f.hp > 0) {
      if (has(f, K.오기)) { pop(who); applyStat(who, "attack", 2, who); }
      if (has(f, K.승기)) { pop(who); applyStat(who, "special-attack", 2, who); }
    }
    return true;
  };

  /** 상태이상 — 아이에게만 걸린다. 타입 면역은 5세대 그대로, 막는 특성(불면 · 유연 …)은 보스의 틀깨기가 무시한다 */
  const applyAilment = (i, ail, loud = false) => {
    const f = A[i];
    if (f.hp <= 0) return false;
    const blk = ailGuardOf(f, ail, B);
    if (blk && ((ail === "confusion" && !f.confused) || (MAJOR.has(ail) && !f.status))) {
      if (loud) say({ t: "info", who: i, ability: AB.name(blk), text: `${nm(i)}의 ${AB.name(blk)}! ${AIL_KO[ail]} 상태가 되지 않는다!` });
      return false;
    }
    if (ail === "confusion") {
      if (f.confused) return false;
      f.confused = 1 + Math.floor(rng() * 4);
      say({ t: "info", who: i, status: "confusion", text: `${josa(nm(i), "은는")} 혼란에 빠졌다!` });
      return true;
    }
    if (!MAJOR.has(ail) || f.status) return false;
    const tk = f.types.map((t) => TYPES[t] && TYPES[t].k);
    if ((ail === "burn" && tk.includes("fire")) || (ail === "freeze" && tk.includes("ice")) ||
        (ail === "poison" && (tk.includes("poison") || tk.includes("steel"))) || (ail === "paralysis" && tk.includes("electric"))) return false;
    f.status = ail;
    if (ail === "sleep") f.sleep = 1 + Math.floor(rng() * 3);
    say({ t: "info", who: i, status: ail, text: `${josa(nm(i), "은는")} ${AIL_KO[ail]} 상태가 되었다!` });
    return true;
  };

  /* ---------- 🌦️ 날씨 ---------- */
  const setWeather = (w, turns) => {
    if (field.w === w || (field.w === "wind" && w !== "wind")) return false;
    field.w = w;
    field.wt = turns;
    say({ t: "info", who: null, weather: w, text: WEATHER_KO[w][0] });
    return true;
  };
  const endWeather = () => {
    const w = field.w;
    field.w = null;
    say({ t: "info", who: null, weather: null, text: WEATHER_KO[w][1] });
  };

  /* ---------- 변신 ---------- */
  const transform = (i) => {
    const me = A[i];
    me.types = [...B.types];
    me.stats = { ...B.stats, hp: me.stats.hp };
    me.stage = { ...B.stage };
    me.moves = B.moves.map((m) => ({ ...m }));
    me.ab = B.ab;
    me.transformed = true;
    say({ t: "info", who: i, transform: { dexId: B.dexId, shiny: B.shiny }, text: `${josa(nm(i), "은는")} ${nm("b")}(으)로 변신했다!` });
  };

  /** ✨ 나올 때 움직이는 특성. 보스면 상대는 서 있는 아이 모두, 아이면 보스 */
  const entry = (who, depth = 0) => {
    const me = F(who);
    if (me.noAb || me.hp <= 0) return;
    const boss = who === "b";
    const foes = boss ? living() : ["b"];
    if (!foes.length) return;
    const foe0 = F(foes[0]);
    switch (me.ab) {
      case K.괴짜:
        if (!boss && !me.transformed) { pop(who); transform(who); entry(who, depth + 1); }
        break;
      case K.트레이스:
        if (!boss && depth === 0 && B.ab && !AB.NO_TRACE.has(B.ab)) {
          pop(who, `${nm(who)}의 트레이스! ${nm("b")}의 ${josa(AB.name(B.ab), "을를")} 복사했다!`);
          me.ab = B.ab;
          entry(who, 1);
        }
        break;
      case K.위협:
        pop(who);
        for (const j of foes) applyStat(j, "attack", -1, who);
        break;
      case K.다운로드: {
        const d = foes.reduce((s, j) => s + F(j).stats.def * stageMul(F(j).stage.def), 0);
        const sd = foes.reduce((s, j) => s + F(j).stats.spd * stageMul(F(j).stage.spd), 0);
        pop(who);
        applyStat(who, d < sd ? "attack" : "special-attack", 1, who);
        break;
      }
      case K.잔비: case K.가뭄: case K.모래날림: case K.눈퍼뜨리기: {
        const w = { [K.잔비]: "rain", [K.가뭄]: "sun", [K.모래날림]: "sand", [K.눈퍼뜨리기]: "hail" }[me.ab];
        if (field.w !== w && field.w !== "wind") { pop(who); setWeather(w, WEATHER_TURNS); }
        break;
      }
      case K.델타스트림:
        if (field.w !== "wind") { pop(who); field.w = null; setWeather("wind", Infinity); }
        break;
      case K.날씨부정: case K.에어록:
        pop(who, `${nm(who)}의 ${AB.name(me.ab)}! 날씨의 영향이 없어졌다!`);
        break;
      case K.프레셔:
        pop(who, `${josa(nm(who), "은는")} 프레셔를 발산하고 있다!`);
        break;
      case K.틀깨기:
        pop(who, `${josa(nm(who), "은는")} 틀을 깼다!`);
        break;
      case K.터보블레이즈:
        pop(who, `${josa(nm(who), "은는")} 활활 타오르는 오라를 발산하고 있다!`);
        break;
      case K.테라볼티지:
        pop(who, `${josa(nm(who), "은는")} 튀는 오라를 발산하고 있다!`);
        break;
      case K.슬로스타트:
        me.slow = 5;
        pop(who, `${josa(nm(who), "은는")} 제 컨디션이 아니다!`);
        break;
      case K.위험예지:
        if (!boss && B.moves.some((m) => m.c !== "status" && effOf(B, me, moveAs(B, m)) > 1)) pop(who, `${josa(nm(who), "은는")} 몸을 떨었다!`);
        break;
      case K.예지몽: {
        if (boss) break;
        const top = B.moves.filter((m) => m.c !== "status").sort((a, b) => powerOf(b) - powerOf(a))[0];
        if (top) pop(who, `${nm(who)}의 예지몽! ${nm("b")}의 ${josa(top.n, "을를")} 꿰뚫어 보았다!`);
        break;
      }
      default:
    }
  };

  /** 받는 쪽 특성이 기술을 통째로 막았다 — 회복 · 랭크업 · 불꽃 받기 */
  const absorbed = (who, k) => {
    const f = F(who);
    pop(who);
    const none = () => say({ t: "info", who, text: `${nm(who)}에게는 효과가 없는 것 같다...` });
    if (k === K.축전 || k === K.저수 || k === K.건조피부) {
      if (f.hp < f.maxHp) heal(who, 25); else none();
    } else if (k === K.피뢰침 || k === K.마중물) applyStat(who, "special-attack", 1, who);
    else if (k === K.전기엔진) applyStat(who, "speed", 1, who);
    else if (k === K.초식) applyStat(who, "attack", 1, who);
    else if (k === K.타오르는불꽃) {
      if (!f.flashFire) { f.flashFire = true; say({ t: "info", who, text: `${nm(who)}의 불꽃 기술의 위력이 올라갔다!` }); } else none();
    } else none();
  };

  /** 명중 — 1:1 과 같은 보정(노가드 · 복안 · 의욕 · 승리의별 · 모래숨기 · 눈숨기 · 번개 · 눈보라 · 날카로운눈) */
  const hits = (att, def, mv) => {
    if (mv.a == null || has(att, K.노가드) || has(def, K.노가드)) return true;
    const w = moveWeather(att);
    let a = mv.a;
    if (AB.RAIN_SURE.has(mv.id)) { if (w === "rain") return true; if (w === "sun") a = 50; }
    if (AB.HAIL_SURE.has(mv.id) && w === "hail") return true;
    if (mv.c === "status" && guard(def, K.미라클스킨, att)) a = Math.min(a, 50);
    if (has(att, K.복안)) a *= 1.3;
    if (has(att, K.승리의별)) a *= 1.1;
    if (has(att, K.의욕) && mv.c === "physical") a *= 0.8;
    const dw = weather(def);
    if ((dw === "sand" && guard(def, K.모래숨기, att)) || (dw === "hail" && guard(def, K.눈숨기, att))) a *= 0.8;
    if (def.confused && guard(def, K.갈지자걸음, att)) a *= 0.5;
    const ev = has(att, K.날카로운눈) ? Math.min(0, def.stage.eva) : def.stage.eva;
    return rng() * 100 < a * stageMul(att.stage.acc - ev, true);
  };
  /** 몇 번 때리나 — 스킬링크는 최대, 부자유친은 한 번 때리는 기술이 두 번(두 번째 1/4) */
  const hitCount = (me, mv) => (mv.hits ? (has(me, K.스킬링크) ? mv.hits[1] : mv.hits[0] + Math.floor(rng() * (mv.hits[1] - mv.hits[0] + 1))) : has(me, K.부자유친) ? 2 : 1);
  const hitMove = (me, mv, h) => (h === 1 && !mv.hits && has(me, K.부자유친) ? { ...mv, pb: 0.25 } : mv);

  /**
   * 맞은 뒤 — 맞은 쪽(def) 특성과 접촉으로 움직이는 특성. att · def 는 아이 번호나 "b".
   * lost: 이번 공격으로 def 가 잃은 체력(내용물분출)
   */
  const afterHit = (att, def, mv, crit, touch, lost) => {
    const me = F(att);
    const foe = F(def);
    const tk = typeKey(mv);
    const allyOf = att === "b" ? def : att; // 보스를 깎은 몫이 가는 아이
    if (foe.hp > 0) {
      if (crit && has(foe, K.분노의경혈) && foe.stage.atk < 6) {
        pop(def);
        foe.stage.atk = 6;
        say({ t: "info", who: def, stat: "atk", change: 12, text: `${nm(def)}의 공격이 최대로 올랐다!` });
      }
      if (tk === "dark" && has(foe, K.정의의마음)) { pop(def); applyStat(def, "attack", 1, def); }
      if ((tk === "bug" || tk === "ghost" || tk === "dark") && has(foe, K.주눅)) { pop(def); applyStat(def, "speed", 1, def); }
      if (mv.c === "physical" && has(foe, K.깨어진갑옷)) { pop(def); applyStat(def, "defense", -1, def); applyStat(def, "speed", 1, def); }
    }
    if (me.hp <= 0) return;
    // 내용물분출 — 접촉이 아니어도
    if (foe.hp <= 0 && has(foe, K.내용물분출) && !has(me, K.매직가드) && lost > 0) {
      pop(def);
      const before = me.hp;
      setHp(att, me.hp - lost, `${josa(nm(att), "은는")} 데미지를 입었다!`);
      if (att === "b") dealtBy[allyOf] += before - me.hp;
      if (me.hp <= 0) return;
    }
    if (!touch) return;
    if ((has(foe, K.까칠한피부) || has(foe, K.철가시)) && !has(me, K.매직가드)) {
      pop(def);
      hurt(att, 1 / 8, `${josa(nm(att), "은는")} 상처를 입었다!`, att === "b" ? allyOf : null);
      if (me.hp <= 0) return;
    }
    if (att !== "b") {
      for (const [k, ail] of [[K.정전기, "paralysis"], [K.불꽃몸, "burn"], [K.독가시, "poison"]]) {
        if (has(foe, k) && rng() < 0.3 && !me.status) { const before = me.status; applyAilment(att, ail); if (me.status !== before) pop(def, `${nm(def)}의 ${AB.name(k)}!`); }
      }
      if (has(foe, K.포자) && !me.status && !has(me, K.방진) && rng() < 0.3) {
        const ail = ["poison", "paralysis", "sleep"][Math.floor(rng() * 3)];
        if (applyAilment(att, ail)) pop(def);
      }
    }
    if (foe.hp <= 0 && has(foe, K.유폭) && !has(me, K.매직가드) && ![B, ...A].some((x) => x.hp > 0 && has(x, K.습기))) {
      pop(def);
      hurt(att, 1 / 4, `${josa(nm(att), "은는")} 데미지를 입었다!`, att === "b" ? allyOf : null);
    }
  };

  const stuck = (i, text) => {
    say({ t: "info", who: i, text });
    return false;
  };
  /** 움직일 수 있나 — 게으름 · 잠듦 · 얼음 · 풀죽음 · 마비 · 혼란(보스는 게으름만). 못 움직이면 false */
  const canMove = (who) => {
    const me = F(who);
    if (has(me, K.게으름)) {
      if (me.loaf) { me.loaf = false; pop(who, `${josa(nm(who), "은는")} 게으름을 피우고 있다!`); return false; }
      me.loaf = true;
    }
    if (who === "b") return true;
    const i = who;
    if (me.status === "sleep") {
      me.sleep -= has(me, K.일찍기상) ? 2 : 1;
      if (me.sleep > 0) return stuck(i, `${josa(nm(i), "은는")} 쿨쿨 잠들어 있다.`);
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
      stuck(i, `${josa(nm(i), "은는")} 풀이 죽어 움직일 수 없었다!`);
      if (has(me, K.불굴의마음)) { pop(i); applyStat(i, "speed", 1, i); }
      return false;
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
  /** 반동 · 흡수 — 돌머리 · 매직가드는 반동을 받지 않는다 */
  const recoilSafe = (f) => has(f, K.돌머리) || has(f, K.매직가드);

  /** 아이 i 가 보스에게 기술을 쓴다 */
  const actAlly = (i, mv0) => {
    const me = A[i];
    if (me.hp <= 0 || !canMove(i)) return;
    const mv = moveAs(me, mv0);
    moveEv(i, mv);
    if (AB.WEATHER_MOVE[mv.id]) {
      if (!setWeather(AB.WEATHER_MOVE[mv.id], WEATHER_TURNS)) say({ t: "info", who: i, text: "하지만 아무 일도 일어나지 않았다!" });
      return;
    }
    const self = selfMove(mv);
    const abs = self ? 0 : absorbOf(me, B, mv);
    if (abs) return void absorbed("b", abs);
    if (!self && !hits(me, B, mv)) return void say({ t: "info", who: i, text: `그러나 ${nm("b")}에게는 맞지 않았다!` });
    if (mv.id === TRANSFORM) return void transform(i);
    if (mv.c === "status") {
      let did = false;
      if (mv.hl) {
        let pct = mv.hl;
        const w = moveWeather(me);
        if (AB.MOON_HEAL.has(mv.id) && w && w !== "wind") pct = w === "sun" ? 200 / 3 : 25;
        heal(i, pct);
        did = true;
      }
      if (mv.ail && !self) { say({ t: "info", who: "b", text: `${nm("b")}에게는 통하지 않았다!` }); did = true; }
      // 매직미러 — 보스가 되받아친다(능력치를 떨어뜨리는 기술이면 내게 돌아온다)
      const bounce = !self && guard(B, K.매직미러, me);
      if (bounce && (mv.st || []).length) pop("b", `${nm("b")}의 매직미러! ${josa(mv.n, "을를")} 되받아쳤다!`);
      for (const [stat, ch] of mv.st || []) {
        const toSelf = statTarget(mv, ch) === "self";
        applyStat(toSelf || bounce ? i : "b", stat, ch, toSelf ? i : bounce ? "b" : i);
        did = true;
      }
      if (!did) say({ t: "info", who: i, text: "하지만 아무 일도 일어나지 않았다!" });
      return;
    }
    const n = hitCount(me, mv);
    const touch = AB.contact(mv);
    let dealt = 0;
    let lastE = 1;
    let count = 0;
    for (let h = 0; h < n && B.hp > 0 && me.hp > 0; h++) {
      const hm = hitMove(me, mv, h);
      const crit = rng() < critChance(hm, me, B);
      const { amount, e } = damage(me, B, hm, rng, crit);
      lastE = e;
      if (e === 0) break;
      const lost = Math.min(amount, B.hp);
      dealt += lost;
      count++;
      setHp("b", B.hp - amount, [crit ? "급소에 맞았다!" : "", h === n - 1 || B.hp - amount <= 0 ? effText(e) : ""].filter(Boolean).join(" "));
      afterHit(i, "b", hm, crit, touch, lost);
    }
    if (lastE === 0) return void say({ t: "info", who: "b", text: `${nm("b")}에게는 효과가 없는 것 같다...` });
    dealtBy[i] += dealt;
    if (n > 1 && count > 1 && !(has(me, K.부자유친) && !mv.hits)) say({ t: "info", who: "b", text: `${count}번 맞았다!` });
    if (me.hp <= 0) return;
    if (mv.dr > 0 && dealt) setHp(i, me.hp + Math.max(1, Math.floor((dealt * mv.dr) / 100)), `${nm("b")}에게서 체력을 흡수했다!`);
    if (mv.dr < 0 && dealt && !recoilSafe(me)) setHp(i, me.hp - Math.max(1, Math.floor((dealt * -mv.dr) / 100)), `${josa(nm(i), "은는")} 반동으로 데미지를 입었다!`);
    if (has(me, K.우격다짐)) return; // 추가 효과가 없다
    for (const [stat, ch] of mv.st || []) {
      const who = statTarget(mv, ch) === "self" ? i : "b";
      if (F(who).hp <= 0) continue;
      if (rng() * 100 < (mv.sc || 100) * (has(me, K.하늘의은총) && who === "b" ? 2 : 1)) applyStat(who, stat, ch, i);
    }
  };

  /** 보스가 기술 하나를 서 있는 아이 모두에게 쓴다 */
  const actBoss = (mv0) => {
    if (!canMove("b")) return;
    const mv = moveAs(B, mv0);
    moveEv("b", mv);
    if (AB.WEATHER_MOVE[mv.id]) {
      if (!setWeather(AB.WEATHER_MOVE[mv.id], WEATHER_TURNS)) say({ t: "info", who: "b", text: "하지만 아무 일도 일어나지 않았다!" });
      return;
    }
    const self = selfMove(mv);
    const targets = living();
    if (self) {
      if (mv.hl) {
        let pct = mv.hl;
        const w = moveWeather(B);
        if (AB.MOON_HEAL.has(mv.id) && w && w !== "wind") pct = w === "sun" ? 200 / 3 : 25;
        heal("b", pct);
      }
      for (const [stat, ch] of mv.st || []) applyStat("b", stat, ch, "b");
      if (!mv.hl && !(mv.st || []).length) say({ t: "info", who: "b", text: "하지만 아무 일도 일어나지 않았다!" });
      return;
    }
    const touch = AB.contact(mv);
    const sheer = has(B, K.우격다짐);
    const luck = has(B, K.하늘의은총) ? 2 : 1;
    let dealt = 0;
    for (const i of targets) {
      const foe = A[i];
      if (B.hp <= 0) break;
      const abs = absorbOf(B, foe, mv);
      if (abs) { absorbed(i, abs); continue; }
      if (!hits(B, foe, mv)) {
        say({ t: "info", who: i, text: `${nm(i)}에게는 맞지 않았다!` });
        continue;
      }
      if (mv.c === "status") {
        // 매직미러 — 아이가 되받아친다. 보스는 상태이상에 걸리지 않고, 능력치 하락은 보스에게 간다
        if (guard(foe, K.매직미러, B)) {
          pop(i, `${nm(i)}의 매직미러! ${josa(mv.n, "을를")} 되받아쳤다!`);
          if (mv.ail) say({ t: "info", who: "b", text: `${nm("b")}에게는 통하지 않았다!` });
          for (const [stat, ch] of mv.st || []) applyStat("b", stat, ch, i);
          continue;
        }
        if (mv.ail) applyAilment(i, mv.ail, true);
        for (const [stat, ch] of mv.st || []) applyStat(i, stat, ch, "b");
        continue;
      }
      const n = hitCount(B, mv);
      let lastE = 1;
      for (let h = 0; h < n && foe.hp > 0 && B.hp > 0; h++) {
        const hm = hitMove(B, mv, h);
        const crit = rng() < critChance(hm, B, foe);
        let { amount, e } = damage(B, foe, hm, rng, crit);
        lastE = e;
        if (e === 0) break;
        // 옹골참 — 가득한 체력에서 한 방이면 1 남기고 버틴다(아이만)
        let sturdy = false;
        if (amount >= foe.hp && foe.hp === foe.maxHp && foe.maxHp > 1 && guard(foe, K.옹골참, B)) { amount = foe.hp - 1; sturdy = true; }
        const lost = Math.min(amount, foe.hp);
        dealt += lost;
        setHp(i, foe.hp - amount, [`${nm(i)}에게`, crit ? "급소에 맞았다!" : "", effText(e)].filter(Boolean).join(" "));
        if (sturdy) pop(i, `${nm(i)}의 옹골참! 공격을 버텼다!`);
        afterHit("b", i, hm, crit, touch, lost);
      }
      if (lastE === 0) { say({ t: "info", who: i, text: `${nm(i)}에게는 효과가 없는 것 같다...` }); continue; }
      if (foe.hp > 0 && !sheer && !guard(foe, K.인분, B)) {
        if (mv.ail && rng() * 100 < (mv.ac || 100) * luck) applyAilment(i, mv.ail);
        if (mv.fl && rng() * 100 < mv.fl * luck && !guard(foe, K.정신력, B)) foe.flinch = true;
      }
      if (sheer) continue;
      for (const [stat, ch] of mv.st || []) {
        if (statTarget(mv, ch) === "self") continue;
        if (foe.hp > 0 && !guard(foe, K.인분, B) && rng() * 100 < (mv.sc || 100) * luck) applyStat(i, stat, ch, "b");
      }
    }
    if (B.hp <= 0) return;
    // 보스 자신에게 오는 것(흡수·반동·랭크)은 한 번만 — 맞힌 아이 수로 나눠 1:1 한 번만큼
    const per1 = Math.max(1, targets.length);
    if (mv.dr > 0 && dealt) setHp("b", B.hp + Math.max(1, Math.floor((dealt * mv.dr) / 100 / per1)), `${josa(nm("b"), "은는")} 체력을 흡수했다!`);
    if (mv.dr < 0 && dealt && !recoilSafe(B)) setHp("b", B.hp - Math.max(1, Math.floor((dealt * -mv.dr) / 100 / per1)), `${josa(nm("b"), "은는")} 반동으로 데미지를 입었다!`);
    if (mv.c !== "status" && B.hp > 0 && !sheer) {
      for (const [stat, ch] of mv.st || []) if (statTarget(mv, ch) === "self" && rng() * 100 < (mv.sc || 100)) applyStat("b", stat, ch, "b");
    }
  };

  const alive = () => A.some((f) => f.hp > 0);
  say({ t: "info", who: null, text: `길드원 ${A.length}명의 포켓몬 VS ${nm("b")} Lv.${B.level}` });

  /**
   * 💎 아이 i 가 메가진화한다 — 그 종에 맞는 돌일 때. 내 아이는 에너지가 남았을 때만(megaUsed 가 쓴 만큼).
   * 마스터는 늘 메가진화해 있다 — 에너지 없이, 사건 없이 메가인 채로 나온다(allies[i].mega.pre)
   */
  let megaUsed = 0;
  const tryMega = (i, form) => {
    const f = A[i];
    const me = Boolean(team[i].a.me);
    if (!form || form.dex !== f.dexId) return;
    if (poke.isMaster(team[i].a.grown, team[i].a.mon.line)) {
      if (mega.evolve(f, form)) f.megaPre = true;
      return;
    }
    if (me && megaUsed >= (opts.megaBudget || 0)) return;
    const before = f.name;
    if (!mega.evolve(f, form)) return;
    if (me) megaUsed++;
    say({ t: "info", who: i, mega: { key: form.key, id: form.id, name: form.name }, text: `${before}의 ${josa(form.stoneName, "이가")} 반응했다!` });
    say({ t: "info", who: i, text: `${josa(before, "은는")} ${form.name}(으)로 메가진화했다!` });
  };
  team.forEach((x, i) => tryMega(i, x.a.mega)); // 나(0번)부터 자리 순서대로
  // ✨ 나올 때 특성 — 보스 먼저, 그다음 자리 순서대로(메가진화한 뒤의 특성으로)
  entry("b");
  A.forEach((_, i) => entry(i));

  let turn = 0;
  let stopped = false;
  let over = false;
  const myDown = () => my < 0 || A[my].hp <= 0;

  /** 턴 끝 — 날씨 · 특성 · 독 · 화상. 아이들 먼저, 보스는 마지막 */
  function endOfTurn(live) {
    for (const who of [...live, "b"]) {
      const f = F(who);
      if (f.hp <= 0 || B.hp <= 0) continue;
      const w = weather(f);
      const sandSafe = isType(f, "rock") || isType(f, "ground") || isType(f, "steel") || has(f, K.모래숨기) || has(f, K.모래헤치기) || has(f, K.모래의힘);
      const hailSafe = isType(f, "ice") || has(f, K.눈숨기) || has(f, K.아이스바디) || has(f, K.눈치우기);
      if (((w === "sand" && !sandSafe) || (w === "hail" && !hailSafe)) && !has(f, K.매직가드) && !has(f, K.방진)) {
        hurt(who, 1 / 16, `${w === "sand" ? "모래바람" : "싸라기눈"}이 ${josa(nm(who), "을를")} 덮쳤다!`);
        if (f.hp <= 0) continue;
      }
      const room = f.hp < f.maxHp;
      if (w === "rain" && has(f, K.젖은접시) && room) { pop(who); heal(who, 100 / 16); }
      if (w === "hail" && has(f, K.아이스바디) && room) { pop(who); heal(who, 100 / 16); }
      if (w === "rain" && has(f, K.건조피부) && room) { pop(who); heal(who, 100 / 8); }
      if (w === "sun" && (has(f, K.건조피부) || has(f, K.선파워)) && !has(f, K.매직가드)) {
        pop(who);
        hurt(who, 1 / 8, `${josa(nm(who), "은는")} 햇살에 데미지를 입었다!`);
        if (f.hp <= 0) continue;
      }
      if (f.status && ((w === "rain" && has(f, K.촉촉바디)) || (has(f, K.탈피) && rng() < 0.3))) {
        pop(who);
        f.status = null;
        f.sleep = 0;
        say({ t: "info", who, status: null, text: `${nm(who)}의 상태이상이 나았다!` });
      }
      if (f.status === "poison" || f.status === "burn") {
        if (f.status === "poison" && has(f, K.포이즌힐)) {
          if (room) { pop(who); heal(who, 100 / 8); }
        } else if (!has(f, K.매직가드)) {
          const frac = f.status === "burn" && has(f, K.내열) ? 1 / 16 : 1 / 8;
          hurt(who, frac, `${josa(nm(who), "은는")} ${f.status === "burn" ? "화상" : "독"} 데미지를 입었다!`);
          if (f.hp <= 0) continue;
        }
      }
      // 나이트메어 — 보스가 잠든 아이들을 깎는다(보스는 잠들지 않는다)
      if (who === "b" && has(f, K.나이트메어)) {
        const sleepers = living().filter((i) => A[i].status === "sleep" && !has(A[i], K.매직가드));
        if (sleepers.length) { pop("b"); for (const i of sleepers) hurt(i, 1 / 8, `${josa(nm(i), "은는")} 악몽에 시달리고 있다!`); }
      }
      if (has(f, K.가속) && f.stage.spe < 6) { pop(who); applyStat(who, "speed", 1, who); }
      if (has(f, K.변덕쟁이)) {
        const ks = ["attack", "defense", "special-attack", "special-defense", "speed"];
        const ups = ks.filter((s) => f.stage[STAT_OF[s]] < 6);
        if (ups.length) {
          const u = ups[Math.floor(rng() * ups.length)];
          const downs = ks.filter((s) => s !== u && f.stage[STAT_OF[s]] > (who === "b" ? BOSS_FLOOR : -6));
          pop(who);
          applyStat(who, u, 2, who);
          if (downs.length) applyStat(who, downs[Math.floor(rng() * downs.length)], -1, who);
        }
      }
      if (f.slow > 0 && --f.slow === 0 && has(f, K.슬로스타트)) pop(who, `${josa(nm(who), "은는")} 컨디션을 되찾았다!`);
    }
    // 날씨가 끝난다 — 5턴, 또는 난기류를 일으킨 아이가 모두 쓰러졌을 때
    if (field.w === "wind" && !field.F.some((x) => x.hp > 0 && has(x, K.델타스트림))) endWeather();
    else if (field.w && field.wt !== Infinity && --field.wt <= 0) endWeather();
  }

  /** 한 턴 */
  function oneTurn() {
    turn++;
    say({ t: "turn", who: null, n: turn, text: `— ${turn}턴 —` });
    const live = living();
    const focus = live[Math.floor(rng() * live.length)];
    const picks = new Map(live.map((i) => [i, choose(A[i], B, rng, true)]));
    picks.set("b", choose(B, A[focus], rng));
    // 우선도(짓궂은마음은 변화 기술 +1) → 시간벌기는 늦게 → 스피드 → 동률이면 미리 뽑아 둔 수로
    const prOf = (who) => {
      const p = picks.get(who);
      if (!p) return 0;
      return (p.pr || 0) + (p.c === "status" && has(F(who), K.짓궂은마음) ? 1 : 0);
    };
    const actors = [...picks.keys()].map((who) => ({ who, pr: prOf(who), stall: has(F(who), K.시간벌기) ? 1 : 0, spe: eff(F(who), "spe"), tie: rng() }));
    actors.sort((x, y) => y.pr - x.pr || x.stall - y.stall || y.spe - x.spe || y.tie - x.tie);
    for (const { who } of actors) {
      if (B.hp <= 0 || !alive()) break;
      if (F(who).hp <= 0) continue;
      const mv = picks.get(who);
      if (!mv) { say({ t: "info", who, text: `${josa(nm(who), "은는")} 쓸 수 있는 기술이 없다!` }); continue; }
      if (who === "b") actBoss(mv);
      else actAlly(who, mv);
    }
    A.forEach((f) => (f.flinch = false));
    if (B.hp > 0) endOfTurn(live);
    if (B.hp > 0 && turn < RAID_TURNS) relieve();
  }

  /** 새로 나온 아이를 판에 세운다 — 날씨 판 · 메가진화 · 나올 때 특성 */
  const enter = (i, form) => {
    join(A[i]);
    tryMega(i, form);
    entry(i);
  };

  /** 쓰러진 길드원의 자리에 그 사람의 다음 후보를 내보낸다 — 턴이 끝날 때, 자리 순서대로 */
  function relieve() {
    for (let s = 0; s < cur.length; s++) {
      if (A[cur[s]].hp > 0) continue;
      while (bench[s].length) {
        const nx = bench[s].shift();
        const base = team[cur[s]].a;
        const a = { mon: nx.mon, grown: nx.grown, owner: base.owner, member: base.member, mega: nx.mega || null };
        const f = fighter(a.mon, a.grown, level);
        if (!f) continue;
        team.push({ a, f, slot: s });
        A.push(f);
        dealtBy.push(0);
        cur[s] = A.length - 1;
        say({ t: "enter", who: cur[s], slot: s, text: `${a.owner ? a.owner + "의 " : ""}${josa(f.name, "이가")} 나왔다!` });
        enter(cur[s], a.mega);
        break;
      }
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
    const slot = my >= 0 ? team[my].slot : 0;
    team.push({ a, f, slot });
    A.push(f);
    dealtBy.push(0);
    my = A.length - 1;
    say({ t: "enter", who: my, slot, text: `가랏, ${f.name}!` });
    enter(my, a.mega); // 앞 아이가 쓰러졌으니 이 아이가 메가진화할 수 있다
    return true;
  }

  const per = (hp) => Math.round((hp / bar) * 1000); // HP → 천분율(1000 = 한 칸)
  const result = () => ({
    turns: turn,
    defeated: B.hp <= 0,
    dealt: B.hp <= 0 ? per(pool) : Math.max(0, per(pool - B.hp)),
    megaUsed,
    allies: A.map((f, i) => ({ id: f.id, name: f.name, mega: f.mega ? { key: f.mega, id: f.megaId, pre: Boolean(f.megaPre) } : null, owner: team[i].a.owner || "", member: team[i].a.member || null, me: Boolean(team[i].a.me), slot: team[i].slot, dexId: f.dexId, shiny: f.shiny, level: f.level, maxHp: f.maxHp, hp: f.maxHp, dealt: per(dealtBy[i]), left: A[i].hp })),
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
