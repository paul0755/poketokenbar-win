"use strict";
/**
 * 결투 — 박스의 두 아이를 싸움 붙인다.
 *
 * ── 어디까지가 원작인가 ──
 * 데미지 공식·자속·상성·급소·난수·랭크·주요 상태이상·우선도는 5세대 그대로다.
 * 숫자는 전부 PokéAPI 에서 받은 것(위력·명중·효과 확률·흡수량)이고, 우리가 정한
 * 건 "어느 기술을 고르나"(AI)뿐이다.
 *
 * 💎 메가진화는 있다(mega.js) — opts.mega 로 받은 쪽이 첫 턴 전에 타입 · 능력치 · 특성을 바꾼다.
 *
 * ✨ 특성(ability.js)과 날씨도 있다. 1:1 에서 뜻이 있는 것(위협 · 부유 · 옹골참 · 쓱쓱 · 천하장사 …)만
 * 원작 숫자대로 넣었다. 교체 · 지닌 물건 · PP · 동료에 쓰는 특성은 효과가 없다. 날씨는 5턴(6세대).
 *
 * 빠진 것: 지닌 물건(메가스톤 말고), 교체, PP, 기술 고유 효과(카운터·대타출동처럼 숫자로 안 오는 것).
 * 그런 기술은 효과 없이 지나가고, AI 가 웬만하면 고르지 않는다.
 *
 * ── 왜 결과를 한꺼번에 내나 ──
 * 메인에서 끝까지 계산해 사건 목록(log)을 넘기고, 화면은 그걸 차례로 재생만 한다.
 * 화면이 계산까지 하면 보상(나무열매)을 렌더러가 정하게 된다 — 렌더러가 보낸
 * 승패를 믿을 이유가 없다.
 */
const profile = require("./profile");
const mega = require("./mega");
const AB = require("./ability");
const poke = require("./world").pack; // 🌏 지금 세계의 종 데이터(포켓몬이면 pokemon.js 그대로)

const SPECIES = require("./species.json");
const MOVES = require("./moves.json");
const TYPES = require("./types.json");

const MAX_TURNS = 60;
const K = AB.K;

/* ---------------- 참가자 ---------------- */

const STAT_OF = { attack: "atk", defense: "def", "special-attack": "spa", "special-defense": "spd", speed: "spe", accuracy: "acc", evasion: "eva" };
const STAT_KO = { atk: "공격", def: "방어", spa: "특수공격", spd: "특수방어", spe: "스피드", acc: "명중률", eva: "회피율" };
const AIL_KO = { paralysis: "마비", burn: "화상", poison: "독", sleep: "잠듦", freeze: "얼음", confusion: "혼란" };
const MAJOR = new Set(["paralysis", "burn", "poison", "sleep", "freeze"]);
const TRANSFORM = 144; // 변신 — 메타몽

/** 날씨 — [시작, 끝] 문장 */
const WEATHER_KO = {
  rain: ["비가 내리기 시작했다!", "비가 그쳤다!"],
  sun: ["햇살이 강해졌다!", "햇살이 원래대로 되돌아왔다!"],
  sand: ["모래바람이 불기 시작했다!", "모래바람이 가라앉았다!"],
  hail: ["싸라기눈이 내리기 시작했다!", "싸라기눈이 그쳤다!"],
  wind: ["수수께끼의 난기류가 비행 포켓몬을 지킨다!", "수수께끼의 난기류가 사라졌다!"],
};
/** 앞 판에서 이어지는 날씨(체육관 연전) */
const WEATHER_STILL = {
  rain: "비가 계속 내리고 있다.",
  sun: "햇살이 강하다.",
  sand: "모래바람이 세차게 분다.",
  hail: "싸라기눈이 계속 내리고 있다.",
  wind: "수수께끼의 난기류가 계속 불고 있다.",
};
const WEATHER_TURNS = 5;

/**
 * 조사. "방어이(가)"처럼 둘 다 적으면 로그가 읽히지 않는다. 마지막 글자에 받침이
 * 있는지로 고른다. 한글이 아니면(폴리곤2) 둘 다 적는 쪽으로 물러난다.
 */
function josa(word, pair) {
  const [withF, noF] = [pair[0], pair[1]];
  const c = String(word).charCodeAt(String(word).length - 1);
  if (/[XY]$/.test(String(word))) return word + noF; // 💎 리자몽나이트X(엑스) · 메가뮤츠Y(와이) — 받침이 없다
  if (c < 0xac00 || c > 0xd7a3) return `${word}${withF}(${noF})`;
  return word + ((c - 0xac00) % 28 ? withF : noF);
}

/**
 * 박스의 개체 하나를 싸울 수 있는 꼴로. 기술은 펫이 쓰는 것과 같다(profile.activeMoveIds) —
 * 💿 기술 관리에서 고른 넷 + 패시브스킬(알기술). 고르지 않았으면 레벨업 넷 + 패시브스킬 + 기술머신.
 *
 * level 을 주면 그 레벨로 맞춘다 — 원작 배틀시설의 "Lv.50 고정"과 같다.
 * 능력치만 그 레벨로 다시 계산하고 기술은 아는 그대로 둔다. 개체값·성격은
 * 그대로라 레벨을 맞추면 그 차이로 승부가 갈린다.
 *
 * ab 는 특성 번호 — 개체가 가진 특성 칸(mon.ability)을 지금 모습의 종에서 찾는다(진화하면 같은 칸의 특성).
 */
function fighter(mon, grown, level = null) {
  const p = profile.build(mon, grown);
  if (!p) return null;
  const s = SPECIES[p.dexId];
  const moves = profile.activeMoveIds(mon, grown).map((id) => ({ id, ...MOVES[id] }));
  const st = level
    ? profile.statsOf(p.dexId, level, mon.ivs, mon.nature)
    : Object.fromEntries(p.stats.map((x) => [x.key, x.value]));
  const d = poke.describe(grown, mon.line, poke.look(mon));
  const slots = profile.abilitySlots(mon.line, p.dexId); // 진화해도 같은 종류의 칸(일반 → 일반 · 숨김 → 숨김)
  const ab = (slots[mon.ability ?? 0] || slots[0] || {}).id || 0;
  return {
    id: mon.id,
    name: d.name,
    dexId: p.dexId, // 변신하면 상대 모습을 그린다
    shiny: d.isShiny,
    level: level || p.level,
    ivs: mon.ivs, // 메가진화하면 이걸로 능력치를 다시 센다
    nature: mon.nature,
    gender: mon.gender || "무성", // 투쟁심
    types: s.types,
    stats: st,
    maxHp: st.hp,
    hp: st.hp,
    moves,
    ab,
    stage: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
    status: null, // 주요 상태이상
    sleep: 0,
    confused: 0,
    flinch: false,
  };
}

/* ---------------- 특성 · 날씨 도우미 ---------------- */

/** 이 아이가 지금 이 특성인가. noAb — 화학변화가스(레이드도 0.20.0 부터 특성이 있다) */
const has = (f, k) => Boolean(f && !f.noAb && f.ab === k);
const breaks = (f) => Boolean(f && !f.noAb && AB.BREAKER.has(f.ab));
/** 상대(by)의 기술을 막거나 줄이는 특성 — by 가 틀깨기면 없는 셈 */
const guard = (f, k, by) => has(f, k) && !(by && by !== f && breaks(by));
const typeK = (id) => (TYPES[id] ? TYPES[id].k : null);
const isType = (f, k) => f.types.some((t) => typeK(t) === k);

/** 지금 날씨. 날씨부정 · 에어록이 나와 있으면 없다 */
function weather(f) {
  const fd = f && f.field;
  if (!fd || !fd.w) return null;
  if (fd.F.some((x) => x.hp > 0 && (has(x, K.날씨부정) || has(x, K.에어록)))) return null;
  return fd.w;
}

/** 내가 쓰는 기술이 받는 날씨 — 💎 메가솔라는 날씨와 상관없이 햇살(Z-A 메가메가니움) */
const moveWeather = (f) => (has(f, K.메가솔라) ? "sun" : weather(f));

/** 위급할 때 1.5배가 되는 타입 */
const PINCH = { [K.심록]: "grass", [K.맹화]: "fire", [K.급류]: "water", [K.벌레의알림]: "bug" };

/** 추가 효과가 있는 공격 기술인가 — 우격다짐 */
function sheerable(mv) {
  if (mv.c === "status") return false;
  if (mv.fl) return true;
  if (mv.ail && (MAJOR.has(mv.ail) || mv.ail === "confusion")) return true;
  return (mv.st || []).some(([, ch]) => ch > 0 || (mv.sc && mv.sc < 100));
}

/** 쓰는 쪽 특성 · 날씨로 바뀐 기술(타입 · 위력). 원래 기술(me.moves)은 건드리지 않는다 */
function moveAs(me, mv) {
  if (!mv || mv.t === -1) return mv;
  if (mv.id === AB.WEATHER_BALL) {
    const t = { sun: 10, rain: 11, sand: 6, hail: 15 }[moveWeather(me)];
    if (t) return { ...mv, t, p: 100 };
  }
  if (has(me, K.노말스킨)) return mv.t === 1 ? mv : { ...mv, t: 1 };
  // 6세대 스킨은 1.3배, Z-A 의 드래곤스킨은 1.2배(7세대부터의 스킨 배율)
  const skin = has(me, K.스카이스킨) ? 3 : has(me, K.페어리스킨) ? 18 : has(me, K.프리즈스킨) ? 15 : has(me, K.드래곤스킨) ? 16 : 0;
  if (skin && mv.t === 1 && mv.c !== "status") return { ...mv, t: skin, skin: skin === 16 ? 1.2 : 1.3 };
  return mv;
}

/** 나에게 쓰는 변화 기술인가(명중 · 막는 특성을 따지지 않는다) */
const selfMove = (mv) => mv.c === "status" && /user|ally|entire-field/.test(mv.tg || "");

/** 받는 쪽(foe)의 특성이 이 기술을 통째로 막나 — 막는 특성 번호 */
function absorbOf(me, foe, mv) {
  if (mv.t === -1 || selfMove(mv)) return 0;
  const g = (k) => (guard(foe, k, me) ? k : 0);
  if (AB.SOUND.has(mv.id) && g(K.방음)) return K.방음;
  if (AB.POWDER.has(mv.id) && g(K.방진)) return K.방진;
  const tk = typeK(mv.t);
  if (tk === "ground" && mv.c !== "status") return g(K.부유);
  if (tk === "electric") return g(K.축전) || g(K.피뢰침) || g(K.전기엔진);
  if (tk === "water") return g(K.저수) || g(K.건조피부) || g(K.마중물);
  if (tk === "fire") return g(K.타오르는불꽃);
  if (tk === "grass") return g(K.초식);
  return 0;
}

/** 상태이상을 막는 특성 번호. by 는 거는 쪽(틀깨기를 본다) */
function ailGuardOf(f, ail, by) {
  const g = (k) => ((by && by !== f ? guard(f, k, by) : has(f, k)) ? k : 0);
  if (ail === "confusion") return g(K.마이페이스);
  if (!MAJOR.has(ail)) return 0;
  if (weather(f) === "sun" && g(K.리프가드)) return K.리프가드;
  if (ail === "paralysis") return g(K.유연);
  if (ail === "sleep") return g(K.불면) || g(K.의기양양);
  if (ail === "poison") return g(K.면역);
  if (ail === "burn") return g(K.수의베일);
  if (ail === "freeze") return g(K.마그마의무장);
  return 0;
}

/** 타입 면역: 불꽃은 화상, 얼음은 얼음, 독·강철은 독, 전기는 마비 (5세대) */
function typeImmune(f, ail) {
  return (ail === "burn" && isType(f, "fire")) || (ail === "freeze" && isType(f, "ice")) ||
    (ail === "poison" && (isType(f, "poison") || isType(f, "steel"))) || (ail === "paralysis" && isType(f, "electric"));
}

/** 이 상태이상이 걸릴 수 있나(아무것도 바꾸지 않는다) */
function canAil(f, ail, by) {
  if (ail === "confusion") return !f.confused && !ailGuardOf(f, ail, by);
  if (!MAJOR.has(ail) || f.status) return false;
  return !typeImmune(f, ail) && !ailGuardOf(f, ail, by);
}

/** 상대가 내 능력치를 떨어뜨리려 할 때 막는 특성 번호 */
function dropGuardOf(f, k, by) {
  const g = (x) => (guard(f, x, by) ? x : 0);
  return g(K.클리어바디) || g(K.하얀연기) || (k === "atk" && g(K.괴력집게)) || (k === "acc" && g(K.날카로운눈)) || (k === "def" && g(K.부풀린가슴)) || 0;
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

/** 특성까지 본 상성 — 배짱(고스트에게 노말 · 격투), 델타스트림(비행 약점 없음) */
function effOf(att, def, mv) {
  const t = TYPES[mv.t];
  if (!t) return 1;
  const scrappy = has(att, K.배짱) && (mv.t === 1 || mv.t === 2);
  const wind = weather(def) === "wind";
  let m = 1;
  for (const d of def.types) {
    let x = (t.zero || []).includes(d) ? 0 : (t.x2 || []).includes(d) ? 2 : (t.half || []).includes(d) ? 0.5 : 1;
    if (x === 0 && scrappy && typeK(d) === "ghost") x = 1;
    if (x === 2 && wind && typeK(d) === "flying") x = 1;
    m *= x;
  }
  return m;
}

/**
 * 위력이 숫자로 안 오는 공격 기술(지구던지기·용의분노·카운터 등).
 * 저마다 고유 규칙이라 다 구현하지 않고 고정 위력으로 친다.
 */
const powerOf = (mv) => mv.p || 50;

/** 실효 능력치. 마비는 스피드 1/4 (5세대). 스피드는 특성 · 날씨도 본다 */
function eff(f, key) {
  let v = f.stats[key] * stageMul(f.stage[key]);
  if (key === "spe") {
    if (f.status === "paralysis" && !has(f, K.속보)) v /= 4;
    if (f.status && has(f, K.속보)) v *= 1.5;
    const w = weather(f);
    if ((w === "rain" && has(f, K.쓱쓱)) || (w === "sun" && has(f, K.엽록소)) || (w === "sand" && has(f, K.모래헤치기)) || (w === "hail" && has(f, K.눈치우기))) v *= 2;
    if (f.slow > 0 && has(f, K.슬로스타트)) v /= 2;
  }
  return v;
}

/** 위력 보정 — 쓰는 쪽 · 받는 쪽 특성과 날씨 */
function bpMul(att, def, mv) {
  let m = 1;
  const tk = typeK(mv.t);
  if (has(att, K.테크니션) && powerOf(mv) <= 60) m *= 1.5;
  if (has(att, K.철주먹) && AB.PUNCH.has(mv.id)) m *= 1.2;
  if (has(att, K.이판사판) && mv.dr < 0) m *= 1.2;
  if (has(att, K.우격다짐) && sheerable(mv)) m *= 1.3;
  if (has(att, K.단단한발톱) && AB.contact(mv)) m *= 1.3;
  if (has(att, K.메가런처) && AB.PULSE.has(mv.id)) m *= 1.5;
  if (has(att, K.옹골찬턱) && AB.BITE.has(mv.id)) m *= 1.5;
  if (mv.skin) m *= mv.skin;
  if (!att.noAb && PINCH[att.ab] === tk && att.hp * 3 <= att.maxHp) m *= 1.5;
  if (has(att, K.투쟁심) && att.gender !== "무성" && def.gender !== "무성") m *= att.gender === def.gender ? 1.25 : 0.75;
  if (has(att, K.애널라이즈) && mv.last) m *= 1.3;
  if (has(att, K.열폭주) && att.status === "burn" && mv.c === "special") m *= 1.5;
  if (has(att, K.독폭주) && att.status === "poison" && mv.c === "physical") m *= 1.5;
  if (att.flashFire && tk === "fire" && has(att, K.타오르는불꽃)) m *= 1.5;
  if (has(att, K.모래의힘) && weather(att) === "sand" && (tk === "rock" || tk === "ground" || tk === "steel")) m *= 1.3;
  if (tk === "fire" && guard(def, K.내열, att)) m *= 0.5;
  if (tk === "fire" && guard(def, K.건조피부, att)) m *= 1.25;
  return m;
}

/** 공격 · 특수공격 보정 */
function aMul(att, def, mv) {
  const phys = mv.c === "physical";
  let m = 1;
  if (phys && (has(att, K.천하장사) || has(att, K.순수한힘))) m *= 2;
  if (phys && att.status && has(att, K.근성)) m *= 1.5;
  if (phys && has(att, K.의욕)) m *= 1.5;
  if (phys && att.slow > 0 && has(att, K.슬로스타트)) m *= 0.5;
  if (att.hp * 2 <= att.maxHp && has(att, K.무기력)) m *= 0.5;
  const w = moveWeather(att);
  if (!phys && w === "sun" && has(att, K.선파워)) m *= 1.5;
  if (phys && w === "sun" && has(att, K.플라워기프트)) m *= 1.5;
  const tk = typeK(mv.t);
  if ((tk === "fire" || tk === "ice") && guard(def, K.두꺼운지방, att)) m *= 0.5;
  return m;
}

/** 방어 · 특수방어 보정 */
function dMul(att, def, mv) {
  const phys = mv.c === "physical";
  let m = 1;
  if (phys && def.status && guard(def, K.이상한비늘, att)) m *= 1.5;
  const w = weather(def);
  if (!phys && w === "sand" && isType(def, "rock")) m *= 1.5;
  if (!phys && w === "sun" && guard(def, K.플라워기프트, att)) m *= 1.5;
  return m;
}

/** 마지막 보정 — 색안경 · 하드록 · 멀티스케일 · 날씨 */
function finalMul(att, def, mv, e) {
  let m = 1;
  if (e > 0 && e < 1 && has(att, K.색안경)) m *= 2;
  if (e > 1 && (guard(def, K.하드록, att) || guard(def, K.필터, att))) m *= 0.75;
  if (def.hp === def.maxHp && guard(def, K.멀티스케일, att)) m *= 0.5;
  const w = moveWeather(att);
  const tk = typeK(mv.t);
  if (w === "rain") m *= tk === "water" ? 1.5 : tk === "fire" ? 0.5 : 1;
  if (w === "sun") m *= tk === "fire" ? 1.5 : tk === "water" ? 0.5 : 1;
  return m;
}

/**
 * 5세대 데미지 공식.
 *   floor(floor(floor(2L/5+2) × 위력 × A/D) / 50) + 2
 *   × 급소(2) × 난수(0.85~1) × 자속(1.5) × 상성 × 화상(물리 0.5)
 * 급소면 내 쪽 하락 랭크와 상대 상승 랭크를 무시한다.
 * 특성 · 날씨 보정은 위력 · 능력치 · 마지막에 곱한다. 혼란으로 자기를 때릴 때(t:-1)는 특성을 타지 않는다.
 */
function damage(att, def, mv, rng, crit) {
  const phys = mv.c === "physical";
  const ak = phys ? "atk" : "spa";
  const dk = phys ? "def" : "spd";
  const plain = mv.t === -1;
  let as = att.stage[ak];
  let ds = def.stage[dk];
  if (!plain && guard(def, K.천진, att)) as = 0;
  if (!plain && has(att, K.천진)) ds = 0;
  let A = att.stats[ak] * stageMul(crit ? Math.max(0, as) : as);
  let D = def.stats[dk] * stageMul(crit ? Math.min(0, ds) : ds);
  let bp = powerOf(mv) * (mv.pb || 1);
  if (!plain) {
    bp = Math.max(1, Math.floor(bp * bpMul(att, def, mv)));
    A *= aMul(att, def, mv);
    D *= dMul(att, def, mv);
  }
  let base = Math.floor(Math.floor((Math.floor((2 * att.level) / 5 + 2) * bp * A) / D) / 50) + 2;
  if (crit) base *= !plain && has(att, K.스나이퍼) ? 3 : 2;
  base = Math.floor(base * (0.85 + rng() * 0.15));
  if (att.types.includes(mv.t)) base = Math.floor(base * (!plain && has(att, K.적응력) ? 2 : 1.5));
  const e = plain ? effectiveness(mv.t, def.types) : effOf(att, def, mv);
  base = Math.floor(base * e);
  if (!plain) base = Math.floor(base * finalMul(att, def, mv, e));
  if (phys && att.status === "burn" && !has(att, K.근성)) base = Math.floor(base / 2);
  return { amount: e === 0 ? 0 : Math.max(1, base), e };
}

/** 급소 확률. 랭크 0이 1/16, 급소율이 높은 기술은 1/8 (5세대). 대운 +1, 전투무장 · 조가비갑옷은 0 */
function critChance(mv, att, def) {
  if (att && def && (guard(def, K.전투무장, att) || guard(def, K.조가비갑옷, att))) return 0;
  return [1 / 16, 1 / 8, 1 / 4, 1 / 3, 1 / 2][Math.min(4, (mv.cr || 0) + (has(att, K.대운) ? 1 : 0))];
}

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

/** 이 날씨가 나에게 좋은가 — 날씨 기술을 고를 때 */
function wantsWeather(me, foe, w) {
  const fd = me.field;
  if (!fd || fd.w === w || fd.w === "wind" || fd.F.some((x) => has(x, K.날씨부정) || has(x, K.에어록))) return false;
  const speed = { rain: K.쓱쓱, sun: K.엽록소, sand: K.모래헤치기, hail: K.눈치우기 }[w];
  if (has(me, speed)) return true;
  const perk = {
    rain: [K.젖은접시, K.촉촉바디, K.건조피부], sun: [K.선파워, K.리프가드, K.플라워기프트], sand: [K.모래숨기, K.모래의힘], hail: [K.눈숨기, K.아이스바디],
  }[w];
  if (perk.some((k) => has(me, k))) return true;
  const mine = { rain: "water", sun: "fire", sand: "rock", hail: "ice" }[w];
  return isType(me, mine) && !isType(foe, mine) && me.moves.some((m) => m.c !== "status" && typeK(m.t) === mine);
}

/* ---------------- 기술 고르기 ---------------- */

/**
 * 그럴듯하게 고른다. 원작 트레이너 AI 처럼 "세게 때릴 수 있으면 때리고,
 * 할 만한 보조가 있으면 가끔 쓴다". 늘 최선만 고르면 매번 같은 기술만 나와서
 * 보는 재미가 없다 — 점수에 비례해 뽑는다.
 * 상대의 특성은 안다 — 부유에게 지진을 계속 쓰면 보는 사람이 답답하다.
 */
function choose(me, foe, rng, gentle = false) {
  const scored = me.moves.map((mv0) => {
    const mv = moveAs(me, mv0);
    if (AB.EXPLODE.has(mv.id) && (has(me, K.습기) || has(foe, K.습기))) return [mv0, 0];
    if (mv.c !== "status") {
      if (absorbOf(me, foe, mv)) return [mv0, 0];
      const e = effOf(me, foe, mv);
      if (e === 0) return [mv0, 0];
      /*
       * 잡으려고 약하게만 만들 때(gentle) — 쓰러뜨릴 것 같은 기술은 거의 안 고른다.
       * 원작에서 사람이 약한 기술을 골라 쓰는 것과 같다. 그래도 급소·난수로 넘칠 수 있다.
       */
      if (gentle && damage(me, foe, mv, () => 1, false).amount >= foe.hp) return [mv0, 1];
      const stab = me.types.includes(mv.t) || has(me, K.변환자재) ? (has(me, K.적응력) ? 2 : 1.5) : 1;
      const phys = mv.c === "physical";
      const ratio = (eff(me, phys ? "atk" : "spa") * aMul(me, foe, mv)) / Math.max(1, eff(foe, phys ? "def" : "spd") * dMul(me, foe, mv));
      const hits = mv.hits ? (has(me, K.스킬링크) ? mv.hits[1] : (mv.hits[0] + mv.hits[1]) / 2) : has(me, K.부자유친) ? 1.25 : 1;
      let sc = powerOf(mv) * bpMul(me, foe, mv) * hits * stab * e * finalMul(me, foe, mv, e) * ratio * ((mv.a || 100) / 100);
      if (mv.dr < 0 && me.hp < me.maxHp * 0.3 && !has(me, K.돌머리) && !has(me, K.매직가드)) sc *= 0.5; // 반동으로 쓰러지기 싫다
      return [mv0, sc];
    }
    // 보조 기술 — 지금 쓸 의미가 있을 때만
    const wk = AB.WEATHER_MOVE[mv.id];
    if (wk) return [mv0, wantsWeather(me, foe, wk) ? 60 : 0];
    if (absorbOf(me, foe, mv)) return [mv0, 0];
    const bounce = !selfMove(mv) && guard(foe, K.매직미러, me);
    let sc = 0;
    if (mv.hl && me.hp < me.maxHp * 0.5) sc = 120;
    if (!bounce) {
      if (mv.ail && MAJOR.has(mv.ail) && canAil(foe, mv.ail, me)) sc = Math.max(sc, gentle ? 140 : 70); // 잡을 땐 상태이상이 제일 좋다
      if (mv.ail === "confusion" && canAil(foe, "confusion", me)) sc = Math.max(sc, 45);
    }
    for (const [stat, ch] of mv.st || []) {
      const self = statTarget(mv, ch) === "self";
      const who = self ? me : foe;
      const k = STAT_OF[stat];
      if (!k) continue;
      if (!self && (bounce || (ch < 0 && dropGuardOf(foe, k, me)))) continue;
      const up = has(who, K.심술꾸러기) ? ch < 0 : ch > 0;
      const room = up ? who.stage[k] < 2 : who.stage[k] > -2;
      if (room && me.hp > me.maxHp * 0.5) sc = Math.max(sc, 35 + Math.abs(ch) * 15);
    }
    if (sc && mv.a != null && !selfMove(mv) && guard(foe, K.미라클스킨, me)) sc *= 0.5;
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
 *   { t: "info",  side, mega:{key,id,name}, text } 💎 메가진화 — 화면은 3D 그림으로 바꾼다
 *   { t: "info",  side, ability, text }            ✨ 특성이 움직였다 — 화면은 그쪽에 특성 이름 띠를 띄운다
 *   { t: "info",  side: -1, weather, text }        🌦️ 날씨가 바뀌었다(null 이면 그쳤다)
 *
 * opts.mega[i] = { form, pre } — i 쪽이 메가진화한다(form 은 mega.json 의 하나).
 * pre 면 이미 메가진화한 채로 나온다(체육관에서 이긴 아이가 다음 판으로 이어 갈 때) — 사건 없이.
 * opts.init[i].stay — 앞 판에서 이어 서 있다(체육관). 나올 때의 특성(위협 · 날씨 …)이 다시 움직이지 않는다.
 * opts.field = { w, wt } — 앞 판에서 이어지는 날씨와 남은 턴(체육관). 원작처럼 날씨는 교체해도 남는다.
 * 돌려주는 field 가 다음 판으로 넘길 날씨다(난기류는 델타스트림이 서 있을 때만).
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
  const stay = F.map((_, i) => Boolean((opts.init || [])[i] && opts.init[i].stay));
  const hp0 = F.map((f) => f.hp);
  const megaNow = []; // 첫 턴 전에 메가진화할 쪽
  (opts.mega || []).forEach((sp, i) => {
    if (!sp || !sp.form || !F[i] || sp.form.dex !== F[i].dexId) return;
    if (sp.pre) { if (mega.evolve(F[i], sp.form)) F[i].megaPre = true; }
    else megaNow.push([i, sp.form]);
  });
  const names0 = F.map((f) => f.name); // 나올 때 이름 — 이어 나온 메가는 메가 이름으로
  const ab0 = F.map((f) => f.ab); // 나올 때 특성 — 화면 이름 상자 옆에
  const field = { w: null, wt: 0, F };
  F.forEach((f) => { f.field = field; f.types0 = [...f.types]; });
  const log = [];
  const say = (e) => log.push(e);
  const nm = (i) => F[i].name;
  const typeKey = (mv) => (TYPES[mv.t] ? TYPES[mv.t].k : "normal");

  /** ✨ 특성이 움직였다 — 기본 문장은 "○○의 위협!" */
  const pop = (i, text) => {
    const n = AB.name(F[i].ab);
    say({ t: "info", side: i, ability: n, text: text || `${nm(i)}의 ${n}!` });
  };

  const setHp = (i, hp, text) => {
    F[i].hp = Math.max(0, Math.min(F[i].maxHp, Math.round(hp)));
    say({ t: "hp", side: i, hp: F[i].hp, max: F[i].maxHp, text });
  };
  const heal = (i, frac, text) => {
    if (F[i].hp <= 0 || F[i].hp >= F[i].maxHp) return;
    setHp(i, F[i].hp + Math.max(1, Math.floor(F[i].maxHp * frac)), text || `${nm(i)}의 체력이 회복되었다!`);
  };
  const hurt = (i, frac, text) => setHp(i, F[i].hp - Math.max(1, Math.floor(F[i].maxHp * frac)), text);

  /**
   * 능력치 변화. src 는 일으킨 쪽 — 내가 나에게(칼춤 · 인파이트)면 i, 상대가 떨어뜨리면 상대.
   * 심술꾸러기 · 단순은 늘, 클리어바디류 · 오기 · 승기는 상대가 떨어뜨릴 때만.
   */
  const applyStat = (i, stat, ch, src = i) => {
    const k = STAT_OF[stat];
    if (!k) return false;
    const f = F[i];
    if (has(f, K.심술꾸러기)) ch = -ch;
    if (has(f, K.단순)) ch *= 2;
    const byFoe = src !== i;
    if (ch < 0 && byFoe) {
      const blk = dropGuardOf(f, k, F[src]);
      if (blk) {
        say({ t: "info", side: i, ability: AB.name(blk), text: `${nm(i)}의 ${AB.name(blk)}! ${josa(STAT_KO[k], "은는")} 떨어지지 않는다!` });
        return false;
      }
    }
    const before = f.stage[k];
    f.stage[k] = Math.max(-6, Math.min(6, before + ch));
    if (f.stage[k] === before) {
      say({ t: "info", side: i, text: `${nm(i)}의 ${josa(STAT_KO[k], "은는")} 더 ${ch > 0 ? "오르지" : "떨어지지"} 않는다!` });
      return false;
    }
    const how = Math.abs(ch) >= 3 ? "극적으로" : Math.abs(ch) === 2 ? "크게" : "";
    say({ t: "info", side: i, stat: k, change: ch, text: `${nm(i)}의 ${josa(STAT_KO[k], "이가")} ${how ? how + " " : ""}${ch > 0 ? "올랐다" : "떨어졌다"}!` });
    if (ch < 0 && byFoe && f.hp > 0) {
      if (has(f, K.오기)) { pop(i); applyStat(i, "attack", 2, i); }
      if (has(f, K.승기)) { pop(i); applyStat(i, "special-attack", 2, i); }
    }
    return true;
  };

  /**
   * 변신 — 원작처럼 상대의 타입 · 능력치(HP 빼고) · 랭크 · 기술 · 특성을 그대로 복사한다.
   * 화면은 transform 을 보고 상대 모습으로 바꿔 그린다. 메타몽끼리면 서로 변신만 하다 끝난다.
   */
  const transform = (i, j) => {
    const me = F[i];
    const foe = F[j];
    me.types = [...foe.types];
    me.stats = { ...foe.stats, hp: me.stats.hp };
    me.stage = { ...foe.stage };
    me.moves = foe.moves.map((m) => ({ ...m }));
    me.ab = foe.ab;
    me.transformed = true;
    say({ t: "info", side: i, transform: { dexId: foe.megaId || foe.dexId, mega: Boolean(foe.megaId), shiny: foe.shiny, side: j }, text: `${josa(nm(i), "은는")} ${nm(j)}(으)로 변신했다!` });
  };

  /**
   * 상태이상. by 는 건 쪽(null 이면 아무도 아님). loud — 변화 기술이라 막혔으면 알린다.
   * 걸렸으면 true. 싱크로는 상대가 건 독 · 마비 · 화상을 되돌려 준다.
   */
  const applyAilment = (i, ail, by = null, loud = false) => {
    const f = F[i];
    const src = by != null && by !== i ? F[by] : null;
    if (ail === "confusion") {
      if (f.confused) return false;
      const blk = ailGuardOf(f, ail, src);
      if (blk) { if (loud) say({ t: "info", side: i, ability: AB.name(blk), text: `${nm(i)}의 ${AB.name(blk)}! 혼란에 빠지지 않는다!` }); return false; }
      f.confused = 1 + Math.floor(rng() * 4);
      say({ t: "info", side: i, status: "confusion", text: `${josa(nm(i), "은는")} 혼란에 빠졌다!` });
      return true;
    }
    if (!MAJOR.has(ail) || f.status || typeImmune(f, ail)) return false;
    const blk = ailGuardOf(f, ail, src);
    if (blk) {
      if (loud) say({ t: "info", side: i, ability: AB.name(blk), text: `${nm(i)}의 ${AB.name(blk)}! ${AIL_KO[ail]} 상태가 되지 않는다!` });
      return false;
    }
    f.status = ail;
    if (ail === "sleep") f.sleep = 1 + Math.floor(rng() * 3);
    say({ t: "info", side: i, status: ail, text: `${josa(nm(i), "은는")} ${AIL_KO[ail]} 상태가 되었다!` });
    if (src && has(f, K.싱크로) && (ail === "poison" || ail === "paralysis" || ail === "burn") && src.hp > 0 && canAil(src, ail, f)) {
      pop(i);
      applyAilment(by, ail, i);
    }
    return true;
  };

  /** 🌦️ 날씨 — 기분파(캐스퐁)는 날씨를 따라 타입이 바뀐다 */
  const forecast = () => {
    F.forEach((f, i) => {
      if (!has(f, K.기분파) || f.hp <= 0) return;
      const t = { sun: 10, rain: 11, hail: 15 }[weather(f)];
      const next = t ? [t] : [...f.types0];
      if (next.join() === f.types.join()) return;
      f.types = next;
      pop(i, `${nm(i)}의 기분파! ${TYPES[next[0]].n}타입이 되었다!`);
    });
  };
  const setWeather = (w, turns) => {
    if (field.w === w || (field.w === "wind" && w !== "wind")) return false;
    field.w = w;
    field.wt = turns;
    say({ t: "info", side: -1, weather: w, text: WEATHER_KO[w][0] });
    forecast();
    return true;
  };

  /** 나올 때 움직이는 특성. 트레이스로 받은 특성은 한 번 더 */
  const entry = (i, depth = 0) => {
    const me = F[i];
    const j = 1 - i;
    const foe = F[j];
    if (me.noAb || me.hp <= 0) return;
    switch (me.ab) {
      case K.괴짜:
        if (!me.transformed) { pop(i); transform(i, j); }
        break;
      case K.트레이스:
        if (foe.ab && !foe.noAb && !AB.NO_TRACE.has(foe.ab) && depth === 0) {
          pop(i, `${nm(i)}의 트레이스! ${nm(j)}의 ${josa(AB.name(foe.ab), "을를")} 복사했다!`);
          me.ab = foe.ab;
          entry(i, 1);
        }
        break;
      case K.위협:
        pop(i);
        applyStat(j, "attack", -1, i);
        break;
      case K.다운로드: {
        const weak = foe.stats.def * stageMul(foe.stage.def) < foe.stats.spd * stageMul(foe.stage.spd);
        pop(i);
        applyStat(i, weak ? "attack" : "special-attack", 1, i);
        break;
      }
      case K.잔비: case K.가뭄: case K.모래날림: case K.눈퍼뜨리기: {
        const w = { [K.잔비]: "rain", [K.가뭄]: "sun", [K.모래날림]: "sand", [K.눈퍼뜨리기]: "hail" }[me.ab];
        if (field.w !== w && field.w !== "wind") { pop(i); setWeather(w, WEATHER_TURNS); }
        break;
      }
      case K.델타스트림:
        pop(i);
        field.w = null;
        setWeather("wind", Infinity);
        break;
      case K.날씨부정: case K.에어록:
        pop(i, `${nm(i)}의 ${AB.name(me.ab)}! 날씨의 영향이 없어졌다!`);
        forecast();
        break;
      case K.프레셔:
        pop(i, `${josa(nm(i), "은는")} 프레셔를 발산하고 있다!`);
        break;
      case K.틀깨기:
        pop(i, `${josa(nm(i), "은는")} 틀을 깼다!`);
        break;
      case K.터보블레이즈:
        pop(i, `${josa(nm(i), "은는")} 활활 타오르는 오라를 발산하고 있다!`);
        break;
      case K.테라볼티지:
        pop(i, `${josa(nm(i), "은는")} 튀는 오라를 발산하고 있다!`);
        break;
      case K.슬로스타트:
        me.slow = 5;
        pop(i, `${josa(nm(i), "은는")} 제 컨디션이 아니다!`);
        break;
      case K.위험예지:
        if (foe.moves.some((m) => m.c !== "status" && effOf(foe, me, moveAs(foe, m)) > 1)) pop(i, `${josa(nm(i), "은는")} 몸을 떨었다!`);
        break;
      case K.예지몽: {
        const top = foe.moves.filter((m) => m.c !== "status").sort((a, b) => powerOf(b) - powerOf(a))[0];
        if (top) pop(i, `${nm(i)}의 예지몽! ${nm(j)}의 ${josa(top.n, "을를")} 꿰뚫어 보았다!`);
        break;
      }
      case K.기분파:
        forecast();
        break;
      default:
    }
  };

  /** 맞은 뒤 — 맞은 쪽(j) 특성과 접촉으로 움직이는 특성 */
  const afterHit = (i, j, mv, crit, touch) => {
    const me = F[i];
    const foe = F[j];
    const tk = typeK(mv.t);
    if (foe.hp > 0) {
      if (crit && has(foe, K.분노의경혈) && foe.stage.atk < 6) {
        pop(j);
        foe.stage.atk = 6;
        say({ t: "info", side: j, stat: "atk", change: 12, text: `${nm(j)}의 공격이 최대로 올랐다!` });
      }
      if (tk === "dark" && has(foe, K.정의의마음)) { pop(j); applyStat(j, "attack", 1, j); }
      if ((tk === "bug" || tk === "ghost" || tk === "dark") && has(foe, K.주눅)) { pop(j); applyStat(j, "speed", 1, j); }
      if (mv.c === "physical" && has(foe, K.깨어진갑옷)) { pop(j); applyStat(j, "defense", -1, j); applyStat(j, "speed", 1, j); }
    }
    if (!touch || me.hp <= 0) return;
    if ((has(foe, K.까칠한피부) || has(foe, K.철가시)) && !has(me, K.매직가드)) {
      pop(j);
      hurt(i, 1 / 8, `${josa(nm(i), "은는")} 상처를 입었다!`);
      if (me.hp <= 0) return;
    }
    for (const [k, ail] of [[K.정전기, "paralysis"], [K.불꽃몸, "burn"], [K.독가시, "poison"]]) {
      if (has(foe, k) && canAil(me, ail, null) && rng() < 0.3) { pop(j); applyAilment(i, ail, j); }
    }
    if (has(foe, K.포자) && !me.status && !has(me, K.방진) && rng() < 0.3) {
      const ail = ["poison", "paralysis", "sleep"][Math.floor(rng() * 3)];
      if (canAil(me, ail, null)) { pop(j); applyAilment(i, ail, j); }
    }
    if (has(me, K.독수) && foe.hp > 0 && canAil(foe, "poison", me) && rng() < 0.3) { pop(i); applyAilment(j, "poison", i); }
    if (foe.hp <= 0 && has(foe, K.유폭) && !has(me, K.매직가드) && !F.some((x) => has(x, K.습기))) {
      pop(j);
      hurt(i, 1 / 4, `${josa(nm(i), "은는")} 데미지를 입었다!`);
    }
  };

  /** 받는 쪽 특성이 기술을 통째로 막았다 — 회복 · 랭크업 · 불꽃 받기 */
  const absorbed = (j, k) => {
    const foe = F[j];
    pop(j);
    const none = () => say({ t: "info", side: j, text: `${nm(j)}에게는 효과가 없는 것 같다...` });
    if (k === K.축전 || k === K.저수 || k === K.건조피부) {
      if (foe.hp < foe.maxHp) heal(j, 1 / 4); else none();
    } else if (k === K.피뢰침 || k === K.마중물) applyStat(j, "special-attack", 1, j);
    else if (k === K.전기엔진) applyStat(j, "speed", 1, j);
    else if (k === K.초식) applyStat(j, "attack", 1, j);
    else if (k === K.타오르는불꽃) {
      if (!foe.flashFire) { foe.flashFire = true; say({ t: "info", side: j, text: `${nm(j)}의 불꽃 기술의 위력이 올라갔다!` }); } else none();
    } else none();
  };

  /** 한쪽이 기술을 쓴다. 쓰러뜨렸으면 true. last — 그 턴에 나중에 움직인다(애널라이즈) */
  const act = (i, mv0, last = false) => {
    const me = F[i];
    const j = 1 - i;
    const foe = F[j];

    // 게으름 — 한 번 움직이면 다음 턴은 쉰다
    if (has(me, K.게으름)) {
      if (me.loaf) { me.loaf = false; return void pop(i, `${josa(nm(i), "은는")} 게으름을 피우고 있다!`); }
      me.loaf = true;
    }

    // 움직이지 못하는 경우들
    if (me.status === "sleep") {
      me.sleep -= has(me, K.일찍기상) ? 2 : 1;
      if (me.sleep > 0) return void say({ t: "info", side: i, text: `${josa(nm(i), "은는")} 쿨쿨 잠들어 있다.` });
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
      say({ t: "info", side: i, text: `${josa(nm(i), "은는")} 풀이 죽어 움직일 수 없었다!` });
      if (has(me, K.불굴의마음)) { pop(i); applyStat(i, "speed", 1, i); }
      return;
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

    let mv = moveAs(me, mv0);
    if (last) mv = { ...mv, last: true };
    say({ t: "move", side: i, move: { name: mv.n, typeKey: typeKey(mv), damageClass: mv.c, power: mv.p }, text: `${nm(i)}의 ${mv.n}!` });

    // 습기 — 자폭 · 대폭발을 누구도 못 쓴다
    if (AB.EXPLODE.has(mv.id)) {
      const damp = [j, i].find((x) => has(F[x], K.습기));
      if (damp != null) return void pop(damp, `${nm(damp)}의 습기! ${josa(nm(i), "은는")} ${josa(mv.n, "을를")} 쓸 수 없다!`);
    }

    // 변환자재 — 쓰기 전에 그 기술의 타입이 된다
    if (has(me, K.변환자재) && TYPES[mv.t] && !(me.types.length === 1 && me.types[0] === mv.t)) {
      me.types = [mv.t];
      pop(i, `${nm(i)}의 변환자재! ${TYPES[mv.t].n}타입이 되었다!`);
    }

    const self = selfMove(mv);
    const abs = self ? 0 : absorbOf(me, foe, mv);
    if (abs) return void absorbed(j, abs);

    // 명중. 명중률이 없는 기술(칼춤 등)과 나에게 거는 기술은 반드시 맞는다. 노가드면 서로 반드시 맞는다
    if (mv.a != null && !self && !has(me, K.노가드) && !has(foe, K.노가드)) {
      const w = moveWeather(me);
      let a = mv.a;
      let sure = false;
      if (AB.RAIN_SURE.has(mv.id)) { if (w === "rain") sure = true; else if (w === "sun") a = 50; }
      if (AB.HAIL_SURE.has(mv.id) && w === "hail") sure = true;
      if (mv.c === "status" && guard(foe, K.미라클스킨, me)) a = Math.min(a, 50);
      if (!sure) {
        const accSt = guard(foe, K.천진, me) ? 0 : me.stage.acc;
        const evaSt = has(me, K.천진) || (has(me, K.날카로운눈) && foe.stage.eva > 0) ? 0 : foe.stage.eva;
        let acc = a * stageMul(Math.max(-6, Math.min(6, accSt - evaSt)), true);
        if (has(me, K.복안)) acc *= 1.3;
        if (has(me, K.승리의별)) acc *= 1.1;
        if (has(me, K.의욕) && mv.c === "physical") acc *= 0.8;
        if (w === "sand" && guard(foe, K.모래숨기, me)) acc *= 0.8;
        if (w === "hail" && guard(foe, K.눈숨기, me)) acc *= 0.8;
        if (foe.confused && guard(foe, K.갈지자걸음, me)) acc *= 0.5;
        if (rng() * 100 >= acc) return void say({ t: "info", side: i, text: `그러나 ${nm(j)}에게는 맞지 않았다!` });
      }
    }

    if (mv.id === TRANSFORM) return void transform(i, j);

    if (mv.c === "status") {
      const wk = AB.WEATHER_MOVE[mv.id];
      if (wk) {
        if (!setWeather(wk, WEATHER_TURNS)) say({ t: "info", side: i, text: "하지만 실패했다!" });
        return false;
      }
      // 매직미러 — 상대에게 거는 기술을 되받아친다
      const foeward = !self && (mv.ail || (mv.st || []).some(([, ch]) => statTarget(mv, ch) === "foe"));
      const tgt = foeward && guard(foe, K.매직미러, me) ? i : j;
      const by = tgt === i ? j : i;
      if (tgt === i) pop(j, `${nm(j)}의 매직미러! ${josa(mv.n, "을를")} 되받아쳤다!`);
      let did = false;
      if (mv.hl) {
        let pct = mv.hl;
        const w = moveWeather(me);
        if (AB.MOON_HEAL.has(mv.id) && w && w !== "wind") pct = w === "sun" ? 200 / 3 : 25;
        setHp(i, me.hp + (me.maxHp * pct) / 100, `${nm(i)}의 체력이 회복되었다!`);
        did = true;
      }
      if (mv.ail) did = applyAilment(tgt, mv.ail, by, true) || did;
      for (const [stat, ch] of mv.st || []) {
        const toSelf = statTarget(mv, ch) === "self";
        applyStat(toSelf ? i : tgt, stat, ch, toSelf ? i : by);
        did = true;
      }
      if (!did) say({ t: "info", side: i, text: "하지만 아무 일도 일어나지 않았다!" });
      return false;
    }

    // 공격
    const bond = !mv.hits && has(me, K.부자유친);
    const n = mv.hits ? (has(me, K.스킬링크) ? mv.hits[1] : mv.hits[0] + Math.floor(rng() * (mv.hits[1] - mv.hits[0] + 1))) : bond ? 2 : 1;
    const touch = AB.contact(mv);
    let dealt = 0;
    let lastE = 1;
    let hitCount = 0;
    for (let h = 0; h < n && foe.hp > 0 && me.hp > 0; h++) {
      const hm = bond && h === 1 ? { ...mv, pb: 0.25 } : mv;
      const crit = rng() < critChance(hm, me, foe);
      let { amount, e } = damage(me, foe, hm, rng, crit);
      lastE = e;
      if (e === 0) break;
      // 옹골참 — 가득한 체력에서 한 방이면 1 남기고 버틴다
      let sturdy = false;
      if (amount >= foe.hp && foe.hp === foe.maxHp && foe.maxHp > 1 && guard(foe, K.옹골참, me)) { amount = foe.hp - 1; sturdy = true; }
      // 흡수 · 반동은 실제로 깎은 만큼만 — Lv.100 이 Lv.6 을 이판사판태클로 치고 반동으로 같이 쓰러지던 것
      const lost = Math.min(amount, foe.hp);
      dealt += lost;
      hitCount++;
      setHp(j, foe.hp - amount, crit ? "급소에 맞았다!" : "");
      if (sturdy) pop(j, `${nm(j)}의 옹골참! 공격을 버텼다!`);
      afterHit(i, j, hm, crit, touch);
      // 💎 내용물분출 — 쓰러지면 그 공격으로 잃은 체력만큼 되돌려준다(Z-A 메가우츠보트). 틀깨기로도 못 막는다
      if (foe.hp <= 0 && has(foe, K.내용물분출) && me.hp > 0 && !has(me, K.매직가드)) {
        pop(j);
        setHp(i, me.hp - lost, `${josa(nm(i), "은는")} 데미지를 입었다!`);
      }
    }
    if (lastE === 0) return void say({ t: "info", side: j, text: `${nm(j)}에게는 효과가 없는 것 같다...` });
    if (lastE > 1) say({ t: "info", side: j, eff: lastE, text: "효과가 굉장했다!" });
    else if (lastE < 1) say({ t: "info", side: j, eff: lastE, text: "효과가 별로인 듯하다..." });
    if (n > 1 && !bond) say({ t: "info", side: j, text: `${hitCount}번 맞았다!` });

    // 변색 — 맞은 기술의 타입이 된다
    if (foe.hp > 0 && hitCount && has(foe, K.변색) && TYPES[mv.t] && !(foe.types.length === 1 && foe.types[0] === mv.t)) {
      foe.types = [mv.t];
      pop(j, `${nm(j)}의 변색! ${TYPES[mv.t].n}타입이 되었다!`);
    }

    // 흡수·반동
    if (mv.dr > 0 && dealt && me.hp > 0) {
      const amt = Math.max(1, Math.floor((dealt * mv.dr) / 100));
      if (has(foe, K.해감액)) {
        pop(j);
        if (!has(me, K.매직가드)) setHp(i, me.hp - amt, `${josa(nm(i), "은는")} 해감액을 흡수했다!`);
      } else setHp(i, me.hp + amt, `${nm(j)}에게서 체력을 흡수했다!`);
    }
    if (mv.dr < 0 && dealt && me.hp > 0 && !has(me, K.돌머리) && !has(me, K.매직가드)) {
      setHp(i, me.hp - Math.max(1, Math.floor((dealt * -mv.dr) / 100)), `${josa(nm(i), "은는")} 반동으로 데미지를 입었다!`);
    }

    // 추가 효과 — 우격다짐이면 없다, 하늘의은총이면 두 배, 인분이면 받지 않는다
    const sheer = has(me, K.우격다짐) && sheerable(mv);
    const grace = has(me, K.하늘의은총) ? 2 : 1;
    const dust = guard(foe, K.인분, me);
    const flinch = () => { if (!guard(foe, K.정신력, me)) foe.flinch = true; };
    if (foe.hp > 0 && !sheer && !dust) {
      if (mv.ail && rng() * 100 < (mv.ac || 100) * grace) applyAilment(j, mv.ail, i);
      if (mv.fl && rng() * 100 < mv.fl * grace) flinch();
      else if (!mv.fl && has(me, K.악취) && rng() < 0.1) flinch();
    }
    for (const [stat, ch] of mv.st || []) {
      const toSelf = statTarget(mv, ch) === "self";
      const who = toSelf ? i : j;
      if (F[who].hp <= 0) continue;
      if (sheer && (ch > 0 || !toSelf)) continue;
      if (!toSelf && dust) continue;
      const sure = !mv.sc || mv.sc >= 100;
      if (rng() * 100 < (mv.sc || 100) * (sure ? 1 : grace)) applyStat(who, stat, ch, i);
    }
    return foe.hp <= 0 || me.hp <= 0;
  };

  say({ t: "info", side: -1, text: `${nm(0)} Lv.${F[0].level} VS ${nm(1)} Lv.${F[1].level}` });

  // 🌦️ 앞 판의 날씨가 이어진다(체육관 연전) — 나올 때의 특성보다 먼저. 새로 나온 쪽의 잔비 · 가뭄은 그 위에 바꾼다
  if (opts.field && WEATHER_KO[opts.field.w] && opts.field.wt > 0) {
    field.w = opts.field.w;
    field.wt = opts.field.wt;
    say({ t: "info", side: -1, weather: field.w, text: WEATHER_STILL[field.w] });
    forecast();
  }

  // ✨ 나올 때 — 화학변화가스가 먼저 모든 특성을 끈다. 나머지는 빠른 쪽부터
  const gas = [0, 1].find((i) => F[i].ab === K.화학변화가스 && !F[i].noAb);
  if (gas != null) {
    pop(gas, `${nm(gas)}의 화학변화가스! 주위에 화학변화가스가 퍼졌다!`);
    F.forEach((f) => { f.noAb = true; });
  }
  const fast = eff(F[1], "spe") > eff(F[0], "spe") ? [1, 0] : [0, 1];
  for (const i of fast) if (!stay[i]) entry(i);

  // 💎 메가진화 — 원작처럼 기술을 고르기 전에. 빨라진 스피드로 첫 턴 순서가 정해진다. 바뀐 특성은 그때 움직인다
  for (const [i, form] of megaNow) {
    const before = F[i].name;
    const abBefore = F[i].ab;
    if (!mega.evolve(F[i], form)) continue;
    F[i].types0 = [...F[i].types];
    say({ t: "info", side: i, mega: { key: form.key, id: form.id, name: form.name }, text: `${before}의 ${josa(form.stoneName, "이가")} 반응했다!` });
    say({ t: "info", side: i, text: `${josa(before, "은는")} ${form.name}(으)로 메가진화했다!` });
    if (F[i].ab !== abBefore) entry(i);
  }

  let turn = 0;
  let stopped = false;
  while (F[0].hp > 0 && F[1].hp > 0 && turn < MAX_TURNS) {
    turn++;
    const picks = [choose(F[0], F[1], rng, opts.gentle === 0), choose(F[1], F[0], rng, opts.gentle === 1)];
    // 우선도 → (시간벌기) → 스피드 → 동률이면 동전. 짓궂은마음은 변화 기술의 우선도 +1
    const pr = (i) => {
      const p = picks[i];
      if (!p) return 0;
      return (p.pr || 0) + (p.c === "status" && has(F[i], K.짓궂은마음) ? 1 : 0);
    };
    const stall = (i) => has(F[i], K.시간벌기);
    const s0 = eff(F[0], "spe");
    const s1 = eff(F[1], "spe");
    let order = [0, 1];
    if (pr(1) > pr(0) || (pr(1) === pr(0) && (stall(0) !== stall(1) ? stall(0) : s1 > s0 || (s1 === s0 && rng() < 0.5)))) order = [1, 0];
    F[0].flinch = F[1].flinch = false;
    for (const [k, i] of order.entries()) {
      if (F[0].hp <= 0 || F[1].hp <= 0) break;
      if (!picks[i]) { say({ t: "info", side: i, text: `${josa(nm(i), "은는")} 쓸 수 있는 기술이 없다!` }); continue; }
      act(i, picks[i], k === 1);
    }
    // 턴 끝 — 날씨 · 특성 · 독 · 화상
    for (const i of order) {
      const f = F[i];
      if (f.hp <= 0) continue;
      const w = weather(f);
      const sandSafe = isType(f, "rock") || isType(f, "ground") || isType(f, "steel") || has(f, K.모래숨기) || has(f, K.모래헤치기) || has(f, K.모래의힘);
      const hailSafe = isType(f, "ice") || has(f, K.눈숨기) || has(f, K.아이스바디) || has(f, K.눈치우기);
      if (((w === "sand" && !sandSafe) || (w === "hail" && !hailSafe)) && !has(f, K.매직가드) && !has(f, K.방진)) {
        hurt(i, 1 / 16, `${w === "sand" ? "모래바람" : "싸라기눈"}이 ${josa(nm(i), "을를")} 덮쳤다!`);
        if (f.hp <= 0) continue;
      }
      if (w === "rain" && has(f, K.젖은접시) && f.hp < f.maxHp) { pop(i); heal(i, 1 / 16); }
      if (w === "hail" && has(f, K.아이스바디) && f.hp < f.maxHp) { pop(i); heal(i, 1 / 16); }
      if (w === "rain" && has(f, K.건조피부) && f.hp < f.maxHp) { pop(i); heal(i, 1 / 8); }
      if (w === "sun" && (has(f, K.건조피부) || has(f, K.선파워)) && !has(f, K.매직가드)) {
        pop(i);
        hurt(i, 1 / 8, `${josa(nm(i), "은는")} 햇살에 데미지를 입었다!`);
        if (f.hp <= 0) continue;
      }
      if (f.status && ((w === "rain" && has(f, K.촉촉바디)) || (has(f, K.탈피) && rng() < 0.3))) {
        pop(i);
        f.status = null;
        f.sleep = 0;
        say({ t: "info", side: i, status: null, text: `${nm(i)}의 상태이상이 나았다!` });
      }
      if (f.status === "poison" || f.status === "burn") {
        if (f.status === "poison" && has(f, K.포이즌힐)) {
          if (f.hp < f.maxHp) { pop(i); heal(i, 1 / 8); }
        } else if (!has(f, K.매직가드)) {
          const frac = f.status === "burn" && has(f, K.내열) ? 1 / 16 : 1 / 8;
          hurt(i, frac, `${josa(nm(i), "은는")} ${f.status === "burn" ? "화상" : "독"} 데미지를 입었다!`);
          if (f.hp <= 0) continue;
        }
      }
      const o = F[1 - i];
      if (has(f, K.나이트메어) && o.hp > 0 && o.status === "sleep" && !has(o, K.매직가드)) {
        pop(i);
        hurt(1 - i, 1 / 8, `${josa(nm(1 - i), "은는")} 악몽에 시달리고 있다!`);
      }
      if (has(f, K.가속) && f.stage.spe < 6) { pop(i); applyStat(i, "speed", 1, i); }
      if (has(f, K.변덕쟁이)) {
        const ks = ["attack", "defense", "special-attack", "special-defense", "speed"];
        const ups = ks.filter((s) => f.stage[STAT_OF[s]] < 6);
        if (ups.length) {
          const u = ups[Math.floor(rng() * ups.length)];
          const downs = ks.filter((s) => s !== u && f.stage[STAT_OF[s]] > -6);
          pop(i);
          applyStat(i, u, 2, i);
          if (downs.length) applyStat(i, downs[Math.floor(rng() * downs.length)], -1, i);
        }
      }
      if (f.slow > 0 && --f.slow === 0 && has(f, K.슬로스타트)) pop(i, `${josa(nm(i), "은는")} 컨디션을 되찾았다!`);
    }
    if (field.w && field.wt !== Infinity && --field.wt <= 0) {
      const w = field.w;
      field.w = null;
      say({ t: "info", side: -1, weather: null, text: WEATHER_KO[w][1] });
      forecast();
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
    fighters: F.map((f, i) => ({
      id: f.id, name: names0[i], level: f.level, maxHp: f.maxHp, hp: hp0[i],
      ability: AB.name(ab0[i]) || null, // ✨ 나올 때 특성
      mega: f.mega ? { key: f.mega, id: f.megaId, name: f.name, pre: Boolean(f.megaPre), shiny: Boolean(f.shiny) } : null, // 💎 메가진화했나
    })),
    // 끝났을 때 상태. 야생은 이걸 들고 다음 결투·포획으로 간다
    end: F.map((f) => ({ hp: f.hp, max: f.maxHp, status: f.status })),
    // 🌦️ 다음 판으로 넘길 날씨 — 난기류는 델타스트림이 서 있을 때만(원작: 그 아이가 빠지면 그친다)
    field: field.w && !(field.w === "wind" && !F.some((f) => f.hp > 0 && has(f, K.델타스트림))) ? { w: field.w, wt: field.wt } : null,
    log,
  };
}

/** ⚔️ 레이드(raidbattle.js)가 빌리는 특성 · 날씨 도우미 — 여럿 대 하나도 같은 규칙으로 */
const abil = { has, guard, moveAs, absorbOf, critChance, eff, effOf, ailGuardOf, dropGuardOf, weather, moveWeather, isType, WEATHER_KO, WEATHER_TURNS };

module.exports = { run, fighter, effectiveness, damage, josa, MAX_TURNS, abil };
