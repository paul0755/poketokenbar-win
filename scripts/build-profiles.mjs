/**
 * PokéAPI에서 개체 프로필 데이터를 받아
 *   src/main/species.json   종별 타입·종족값·특성·성별비·레벨업 기술·알기술·기술머신
 *   src/main/moves.json     기술 사전 (이름·타입·위력·분류)
 *   src/main/abilities.json 특성 사전 (이름·설명)
 * 를 만든다.
 *
 * lines.json 에 실제로 등장하는 도감 번호만 받는다 — 안 쓰는 500종을
 * 받아 두면 파일만 두 배가 되고 읽는 쪽은 그대로다.
 *
 * 기술은 5세대(black-white) 것만 쓴다. 스프라이트가 5세대라
 * 다른 세대 기술을 섞으면 "그 시절에 없던 기술"이 나온다.
 *
 *   moves  레벨업 [[id, 레벨]]
 *   egg    알기술 [id]  — PokéAPI 는 라인의 첫 형태에만 적어 둔다. 진화형에는 없다
 *   tm     기술머신 [id] — 비전머신 포함. 가르치는 건 상점에서 한다
 *
 * 한국어가 없으면 영어로 둔다. 지어내지 않는다.
 *
 *   node scripts/build-profiles.mjs
 */
import fs from "node:fs";
import path from "node:path";

const CONCURRENCY = 8;
const VERSION_GROUP = "black-white"; // 스프라이트와 같은 세대
const CACHE = path.join(process.cwd(), ".cache-pokeapi");
const OUT = path.join(process.cwd(), "src", "main");

fs.mkdirSync(CACHE, { recursive: true });

async function getJson(url) {
  const key = path.join(CACHE, url.replace(/[^a-z0-9]/gi, "_").slice(-120) + ".json");
  if (fs.existsSync(key)) return JSON.parse(fs.readFileSync(key, "utf8"));
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const j = await res.json();
  fs.writeFileSync(key, JSON.stringify(j), "utf8");
  return j;
}

/** 동시 요청 수를 제한한다. 공개 API에 수천 개를 한꺼번에 던지지 않는다. */
async function mapLimit(items, limit, fn, label = "") {
  const out = [];
  let i = 0;
  let done = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx]);
      } catch (e) {
        out[idx] = null;
        console.error("  실패:", items[idx], e.message);
      }
      if (label && ++done % 50 === 0) console.log(`  ${label} ${done}/${items.length}`);
    }
  });
  await Promise.all(workers);
  return out;
}

const ko = (arr, fallback) => {
  const hit = (arr || []).find((n) => n.language && n.language.name === "ko");
  return hit ? hit.name : fallback;
};
const idOf = (url) => Number(url.match(/\/(\d+)\/?$/)[1]);

/* ---------------- 대상 도감 번호 ---------------- */

const LINES = JSON.parse(fs.readFileSync(path.join(OUT, "lines.json"), "utf8"));
const dexIds = [...new Set(LINES.flatMap((l) => l.ids))].filter((d) => d > 0).sort((a, b) => a - b);
console.log(`대상 ${dexIds.length}종 (진화 라인 ${LINES.length}개에서 추출)`);

/* ---------------- 종 ---------------- */

console.log("종 정보 받는 중…");
const rows = await mapLimit(
  dexIds,
  CONCURRENCY,
  async (dex) => {
    const p = await getJson(`https://pokeapi.co/api/v2/pokemon/${dex}`);
    const s = await getJson(`https://pokeapi.co/api/v2/pokemon-species/${dex}`);

    // 종족값은 순서가 고정이다: hp, attack, defense, special-attack, special-defense, speed
    const ORDER = ["hp", "attack", "defense", "special-attack", "special-defense", "speed"];
    const base = ORDER.map((k) => {
      const st = p.stats.find((x) => x.stat.name === k);
      return st ? st.base_stat : 0;
    });

    // 우리 세대 것만. 레벨업은 같은 기술이 여러 번 나오면 가장 낮은 레벨을 쓴다.
    const byMove = new Map();
    const egg = new Set();
    const tm = new Set();
    for (const m of p.moves) {
      for (const d of m.version_group_details) {
        if (d.version_group.name !== VERSION_GROUP) continue;
        const id = idOf(m.move.url);
        const how = d.move_learn_method.name;
        if (how === "egg") egg.add(id);
        else if (how === "machine") tm.add(id);
        else if (how === "level-up") {
          const lv = d.level_learned_at || 1;
          if (!byMove.has(id) || byMove.get(id) > lv) byMove.set(id, lv);
        }
      }
    }
    const moves = [...byMove.entries()].sort((a, b) => a[1] - b[1]).map(([id, lv]) => [id, lv]);

    return {
      dex,
      types: p.types.sort((a, b) => a.slot - b.slot).map((t) => idOf(t.type.url)),
      base,
      abilities: p.abilities
        .sort((a, b) => a.slot - b.slot)
        .map((a) => ({ id: idOf(a.ability.url), hidden: Boolean(a.is_hidden) })),
      // -1은 무성. 0~8은 암컷이 나올 확률을 8분의 몇으로 나타낸 값.
      genderRate: typeof s.gender_rate === "number" ? s.gender_rate : -1,
      moves,
      egg: [...egg].sort((a, b) => a - b),
      tm: [...tm].sort((a, b) => a - b),
    };
  },
  "종",
);

const species = {};
for (const r of rows) if (r) species[r.dex] = r;
console.log(`종 ${Object.keys(species).length}개`);

/* ---------------- 기술 · 특성 · 타입 사전 ---------------- */

const moveIds = [...new Set(Object.values(species).flatMap((s) => [...s.moves.map((m) => m[0]), ...s.egg, ...s.tm]))];
const abilityIds = [...new Set(Object.values(species).flatMap((s) => s.abilities.map((a) => a.id)))];
const typeIds = [...new Set(Object.values(species).flatMap((s) => s.types))];

console.log(`기술 ${moveIds.length}개 받는 중…`);
const moveRows = await mapLimit(
  moveIds,
  CONCURRENCY,
  async (id) => {
    const m = await getJson(`https://pokeapi.co/api/v2/move/${id}`);
    return {
      id,
      name: ko(m.names, m.name),
      type: m.type ? idOf(m.type.url) : null,
      power: m.power ?? null,
      accuracy: m.accuracy ?? null,
      pp: m.pp ?? null,
      // physical | special | status
      damageClass: m.damage_class ? m.damage_class.name : null,
    };
  },
  "기술",
);

console.log(`특성 ${abilityIds.length}개 받는 중…`);
const abilityRows = await mapLimit(abilityIds, CONCURRENCY, async (id) => {
  const a = await getJson(`https://pokeapi.co/api/v2/ability/${id}`);
  const txt = (a.flavor_text_entries || []).find((e) => e.language && e.language.name === "ko");
  return { id, name: ko(a.names, a.name), desc: txt ? txt.flavor_text.replace(/\s+/g, " ") : null };
});

console.log(`타입 ${typeIds.length}개 받는 중…`);
const typeRows = await mapLimit(typeIds, CONCURRENCY, async (id) => {
  const t = await getJson(`https://pokeapi.co/api/v2/type/${id}`);
  return { id, name: ko(t.names, t.name), key: t.name };
});

const moves = {};
for (const m of moveRows) if (m) moves[m.id] = { n: m.name, t: m.type, p: m.power, a: m.accuracy, pp: m.pp, c: m.damageClass };
const abilities = {};
for (const a of abilityRows) if (a) abilities[a.id] = { n: a.name, d: a.desc };
const types = {};
for (const t of typeRows) if (t) types[t.id] = { n: t.name, k: t.key };

/* ---------------- 쓰기 ---------------- */

const write = (file, obj) => {
  const p = path.join(OUT, file);
  fs.writeFileSync(p, JSON.stringify(obj), "utf8");
  console.log(`  ${file}  ${(fs.statSync(p).size / 1024).toFixed(0)}KB`);
};

write("species.json", species);
write("moves.json", moves);
write("abilities.json", abilities);
write("types.json", types);

/* ---------------- 점검 ---------------- */

const noMoves = Object.values(species).filter((s) => !s.moves.length);
const noKoMove = Object.values(moves).filter((m) => /^[a-z-]+$/.test(m.n)).length;
const noKoAbility = Object.values(abilities).filter((a) => /^[a-z-]+$/.test(a.n)).length;
console.log("\n점검");
console.log(`  레벨업 기술이 없는 종  ${noMoves.length}개` + (noMoves.length ? " → " + noMoves.slice(0, 5).map((s) => s.dex).join(",") : ""));
console.log(`  알기술이 있는 종      ${Object.values(species).filter((s) => s.egg.length).length}개`);
console.log(`  기술머신이 있는 종    ${Object.values(species).filter((s) => s.tm.length).length}개`);
console.log(`  한국어 없는 기술      ${noKoMove}/${Object.keys(moves).length}`);
console.log(`  한국어 없는 특성      ${noKoAbility}/${Object.keys(abilities).length}`);
