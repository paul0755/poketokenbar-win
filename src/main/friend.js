"use strict";
/**
 * 친선 배틀 코드 — 서버 없이 친구와 싸운다.
 *
 * 내 팀(한 마리)을 글자 한 줄로 만들어 메신저로 보낸다. 친구가 붙여 넣으면
 * 그 아이와 Lv.50 으로 싸운다. 앱은 여전히 아무것도 보내지 않는다 — 사람이 복사한다.
 *
 * ── 두 PC에서 같은 결투 ──
 * 난수 씨앗을 두 코드에서 만든다(seedOf). 순서도 코드로 정한다(order). 그래서
 * 서로 코드를 바꿔 넣으면 양쪽 PC에서 똑같은 결투가 나온다. 같은 두 코드로는
 * 몇 번을 돌려도 같은 결과다 — 마음에 들 때까지 다시 돌릴 수 없다.
 *
 * ── 막지 못하는 것 ──
 * 세이브는 내 PC의 파일이라 조작을 막을 수 없다. 여기서 거르는 건 "말이 안 되는
 * 값"뿐이다(개체값 31 초과, 그 종이 못 배우는 기술). 그래서 보상이 없는 친선이다.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const poke = require("./pokemon");

const SPECIES = require("./species.json");

const PREFIX = "PTB1";
const GENDERS = ["무성", "수컷", "암컷"];

/**
 * 데이터 버전. 종·기술·타입 사전과 결투 규칙이 같아야 같은 씨앗으로 같은 결투가 나온다.
 * 파일 내용으로 지문을 떠서 코드에 싣는다. 앱을 업데이트하면 바뀔 수 있다.
 */
let dv = null;
function dataVersion() {
  if (dv) return dv;
  const h = crypto.createHash("sha1");
  for (const f of ["species.json", "moves.json", "types.json", "battle.js"]) h.update(fs.readFileSync(path.join(__dirname, f)));
  return (dv = h.digest("hex").slice(0, 8));
}

/** 복사하다 한 글자 빠진 걸 잡아내는 짧은 확인값. 보안용이 아니다 */
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const check = (body) => fnv(body).toString(36).padStart(7, "0").slice(-5);

/**
 * 코드로 만든다. grown 은 난이도를 반영한 실효 성장량 — 받는 쪽은 그 값을 그대로 쓴다.
 * nonce 를 넣어 같은 아이라도 등록할 때마다 다른 코드(= 다른 씨앗)가 된다.
 */
function encode(mon, grown, trainer) {
  const body = Buffer.from(
    JSON.stringify([
      1,
      dataVersion(),
      String(trainer || "").slice(0, 16),
      crypto.randomBytes(3).toString("hex"),
      [
        mon.line,
        mon.nature ?? 0,
        mon.shiny ? 1 : 0,
        mon.ivs || [0, 0, 0, 0, 0, 0],
        Math.max(0, GENDERS.indexOf(mon.gender)),
        mon.ability ?? 0,
        mon.eggMoves || [],
        mon.tmMoves || [],
        Math.round(grown),
      ],
    ]),
  ).toString("base64url");
  return `${PREFIX}-${body}-${check(body)}`;
}

/**
 * 코드를 읽는다. 틀린 데가 있으면 { error } — 사람이 고칠 수 있게 무엇이 틀렸는지 말한다.
 */
function decode(code) {
  const s = String(code || "").replace(/\s+/g, "");
  const m = /^PTB1-([A-Za-z0-9_-]+)-([0-9a-z]{5})$/.exec(s);
  if (!m) return { error: "친선 배틀 코드가 아닙니다. PTB1- 로 시작하는 한 줄을 통째로 붙여 넣어 주세요." };
  if (check(m[1]) !== m[2]) return { error: "코드가 중간에 잘렸거나 바뀌었습니다. 다시 복사해 주세요." };
  let arr;
  try {
    arr = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
  } catch {
    return { error: "코드를 읽지 못했습니다." };
  }
  const [ver, data, trainer, nonce, d] = arr || [];
  if (ver !== 1 || !Array.isArray(d)) return { error: "이 앱이 모르는 형식의 코드입니다." };
  if (data !== dataVersion()) {
    return { error: "앱 버전이 달라 같은 결투가 나오지 않습니다. 둘 다 최신 버전으로 맞춰 주세요.", versionMismatch: true };
  }
  const [line, nature, shiny, ivs, g, ability, eggMoves, tmMoves, grown] = d;
  const mon = { line, nature, shiny: Boolean(shiny), ivs, gender: GENDERS[g], ability, eggMoves, tmMoves };
  const why = validate(mon, grown);
  if (why) return { error: "말이 안 되는 값이 들어 있습니다 — " + why };
  return { code: s, trainer: String(trainer || ""), nonce, mon: { id: "friend-" + nonce, ...mon }, grown };
}

const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;

/**
 * 말이 되는 값인가. 원작 규칙과 데이터 사전 범위 안인지만 본다 — 키운 기록이 진짜인지는
 * 알 수 없다(세이브가 그 사람 PC에 있다). 틀린 이유를 한 줄로 돌려준다. 맞으면 null.
 */
function validate(mon, grown) {
  const L = poke.LINES[mon.line];
  if (!Number.isInteger(mon.line) || !L) return "없는 포켓몬";
  if (!Number.isFinite(grown) || grown < 0 || grown > 5e9) return "성장량";
  if (poke.stageFor(grown) === 0) return "알은 싸울 수 없습니다";
  if (!isInt(mon.nature, 0, poke.NATURES.length - 1)) return "성격";
  if (!Array.isArray(mon.ivs) || mon.ivs.length !== 6 || !mon.ivs.every((v) => isInt(v, 0, 31))) return "개체값";
  if (!mon.gender) return "성별";
  const base = SPECIES[L.ids[1]];
  if (!base || !isInt(mon.ability, 0, base.abilities.length - 1)) return "특성";
  const egg = new Set(base.egg || []);
  if (!Array.isArray(mon.eggMoves) || mon.eggMoves.length > 2 || !mon.eggMoves.every((id) => egg.has(id))) return "패시브스킬";
  // 기술머신은 라인의 어느 모습에서 배웠든 된다 — 진화 전에 배운 기술을 들고 간다
  const tm = new Set(L.ids.filter(Boolean).flatMap((id) => (SPECIES[id] || {}).tm || []));
  if (!Array.isArray(mon.tmMoves) || mon.tmMoves.length > 100 || !mon.tmMoves.every((id) => tm.has(id))) return "기술머신";
  return null;
}

/**
 * 두 코드로 정하는 것 — 누가 왼쪽(0)인지와 난수 씨앗.
 * 어느 PC에서 돌려도 같은 값이 나와야 하므로 코드 문자열만 본다.
 */
function order(codeA, codeB) {
  return codeA <= codeB ? [0, 1] : [1, 0];
}
const seedOf = (codeA, codeB) => fnv([codeA, codeB].sort().join("|"));

/** mulberry32 — 씨앗 하나로 같은 수열을 낸다. Math.random 대신 결투에 넘긴다 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { encode, decode, validate, order, seedOf, rng, dataVersion };
