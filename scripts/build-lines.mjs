/**
 * PokéAPI에서 진화 라인을 받아 src/main/lines.json 을 만든다.
 *
 * 손으로 적으면 반드시 틀린다 — 도감 번호도, 한국어 이름도.
 * 출처에서 받아 생성하고, 결과물은 커밋해서 실행 시 네트워크를 타지 않게 한다.
 *
 * 제약: 5세대 흑백 애니메이션 스프라이트가 있는 도감 1~649번만 쓴다.
 *       라인 전체가 이 범위 안에 들어와야 채택한다 (중간만 움직이면 이상하다).
 *
 * ── 진화하지 않는 종 (single) ──
 * 전설·환상·메타몽·켄타로스처럼 진화가 없는 종은 알에서 키우는 재미가 없어서 처음엔 뺐다.
 * 지금은 "만나는" 포켓몬으로 넣는다 — 알에서는 안 나오고 야생에서만 나온다(pokemon.roll 이 거른다).
 * 다섯 칸에 같은 종을 채우고 single: true 를 단다.
 *
 * ── 순서를 바꾸면 안 된다 ──
 * 세이브는 라인 번호(이 배열의 순서)로 포켓몬을 기억한다. 순서가 바뀌면 키우던 아이가 다른 종이
 * 된다. 그래서 진화 라인은 예전처럼 정렬하고 진화 없는 종은 그 뒤에 붙인다. 이미 있는
 * lines.json 과 앞부분이 하나라도 다르면 쓰지 않고 멈춘다.
 *
 *   node scripts/build-lines.mjs
 */
import fs from "node:fs";
import path from "node:path";

const MAX_DEX = 649; // 5세대까지. 그 위는 애니메이션 스프라이트가 없다
const CHAINS = 450; // 진화 체인 id 훑는 범위. 5세대 체인은 뒷번호라 여기까지 와야 잡힌다
const CONCURRENCY = 8;
const CACHE = path.join(process.cwd(), ".cache-pokeapi");

fs.mkdirSync(CACHE, { recursive: true });

async function getJson(url) {
  const key = path.join(CACHE, url.replace(/[^a-z0-9]/gi, "_").slice(-120) + ".json");
  if (fs.existsSync(key)) return JSON.parse(fs.readFileSync(key, "utf8"));
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const j = await res.json();
  fs.writeFileSync(key, JSON.stringify(j), "utf8");
  return j;
}

/** 동시 요청 수를 제한한다. 공개 API에 수백 개를 한꺼번에 던지지 않는다. */
async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx]);
      } catch {
        out[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

const dexOf = (speciesUrl) => Number(speciesUrl.match(/\/(\d+)\/?$/)[1]);

/** 체인을 한 줄기로 편다. 분기(이브이 등)는 첫 갈래만 쓴다. */
function flatten(node, acc = []) {
  acc.push({
    name: node.species.name,
    dex: dexOf(node.species.url),
    // 이 모습으로 "교환해서" 진화해 오는가 — 윤겔라→후딘, 근육몬→괴력몬처럼.
    // 도구를 지니고 교환하는 경우(롱스톤→강철톤)도 원작에서는 교환 진화다.
    byTrade: (node.evolution_details || []).some((d) => d.trigger && d.trigger.name === "trade"),
  });
  if (node.evolves_to && node.evolves_to.length) flatten(node.evolves_to[0], acc);
  return acc;
}

async function species(dex) {
  const s = await getJson(`https://pokeapi.co/api/v2/pokemon-species/${dex}`);
  const ko = (s.names || []).find((n) => n.language && n.language.name === "ko");
  return {
    name: ko ? ko.name : null,
    // 공식 포획률 3~255. 낮을수록 희귀하다(전설은 3).
    // 뽑기 가중치로 그대로 쓴다 — 희귀한 게 실제로 희귀해야 뽑는 맛이 난다.
    captureRate: typeof s.capture_rate === "number" ? s.capture_rate : 45,
    isLegendary: Boolean(s.is_legendary),
    isMythical: Boolean(s.is_mythical),
  };
}

/** 성격 25종. 오른 능력치/내린 능력치까지 한국어로 받는다. */
async function natures() {
  const list = await getJson("https://pokeapi.co/api/v2/nature?limit=30");
  const koStat = async (ref) => {
    if (!ref) return null;
    const s = await getJson(ref.url);
    const ko = (s.names || []).find((n) => n.language && n.language.name === "ko");
    return ko ? ko.name : ref.name;
  };
  const out = [];
  for (const it of list.results) {
    const n = await getJson(it.url);
    const ko = (n.names || []).find((x) => x.language && x.language.name === "ko");
    out.push({
      name: ko ? ko.name : n.name,
      up: await koStat(n.increased_stat),
      down: await koStat(n.decreased_stat),
    });
  }
  return out;
}

const ids = Array.from({ length: CHAINS }, (_, i) => i + 1);
console.log(`진화 체인 ${CHAINS}개 조회 중…`);

const chains = await mapLimit(ids, CONCURRENCY, (id) =>
  getJson(`https://pokeapi.co/api/v2/evolution-chain/${id}`),
);

const candidates = [];
const singleDex = []; // 진화하지 않는 종 — 뒤에 따로 붙인다
for (const c of chains) {
  if (!c || !c.chain) continue;
  const stages = flatten(c.chain);
  if (stages.some((s) => s.dex > MAX_DEX)) continue; // 애니메이션 스프라이트 없음
  if (stages.length < 2) {
    if (!(c.chain.evolves_to || []).length) singleDex.push(stages[0].dex);
    continue;
  }
  candidates.push(stages);
}
console.log(`  진화하는 라인 ${candidates.length}개 · 진화 없는 종 ${singleDex.length}개`);

console.log("종 정보(이름·포획률) 조회 중…");
const dexes = [...new Set([...candidates.flat().map((s) => s.dex), ...singleDex])];
const info = new Map();
await mapLimit(dexes, CONCURRENCY, async (d) => info.set(d, await species(d)));

const missing = dexes.filter((d) => !info.get(d) || !info.get(d).name);
if (missing.length) console.log(`  한국어 이름 없음 ${missing.length}개 — 해당 라인 제외`);

const lines = [];
for (const stages of candidates) {
  if (stages.some((s) => !info.get(s.dex) || !info.get(s.dex).name)) continue;

  // STAGES(알·부화·1차·최종·마스터) 5칸에 맞춘다.
  // 2단 진화 라인은 중간을 최종으로 한 번 더 채운다.
  const s = stages.slice(0, 3);
  const pick = (i) => s[Math.min(i, s.length - 1)];
  const slots = [null, pick(0), pick(1), pick(2), pick(2)];
  const base = info.get(s[0].dex); // 알에서 나오는 건 1단계다. 가중치도 여기 기준.
  const finalInfo = info.get(s[s.length - 1].dex);

  lines.push({
    line: base.name,
    ids: slots.map((x) => (x ? x.dex : null)),
    names: slots.map((x) => (x ? info.get(x.dex).name : "알")),
    captureRate: base.captureRate,
    legendary: Boolean(base.isLegendary || base.isMythical || finalInfo.isLegendary || finalInfo.isMythical),
    // 교환하면 진화하는 단계(STAGES 칸 번호). 윤겔라(2)를 교환하면 후딘(3)이 된다 → [2]
    ...(s.some((x, i) => i > 0 && x.byTrade) ? { trade: s.map((x, i) => (i > 0 && x.byTrade ? i : 0)).filter(Boolean) } : {}),
  });
}

lines.sort((a, b) => a.ids[1] - b.ids[1]);

// 진화 없는 종 — 진화 라인 뒤에, 도감 번호 순으로
const singles = singleDex
  .filter((d) => info.get(d) && info.get(d).name)
  .sort((a, b) => a - b)
  .map((d) => {
    const i = info.get(d);
    return {
      line: i.name,
      ids: [null, d, d, d, d],
      names: ["알", i.name, i.name, i.name, i.name],
      captureRate: i.captureRate,
      legendary: Boolean(i.isLegendary || i.isMythical),
      ...(i.isMythical ? { mythical: true } : {}),
      single: true,
    };
  });

const out = path.join(process.cwd(), "src", "main", "lines.json");
// 이미 있는 순서를 지킨다 — 세이브가 라인 번호로 포켓몬을 기억한다
if (fs.existsSync(out)) {
  const old = JSON.parse(fs.readFileSync(out, "utf8"));
  const all = [...lines, ...singles];
  const bad = old.findIndex((o, i) => !all[i] || JSON.stringify(o.ids) !== JSON.stringify(all[i].ids));
  if (bad >= 0) {
    console.error(`\n❌ 라인 ${bad}(${old[bad].line})의 순서·종이 예전과 다릅니다. 세이브가 깨지므로 쓰지 않습니다.`);
    process.exit(1);
  }
}
const all = [...lines, ...singles];
fs.writeFileSync(out, JSON.stringify(all, null, 1), "utf8");
console.log(`\n✅ 진화 라인 ${lines.length}개 + 진화 없는 종 ${singles.length}개 → ${path.relative(process.cwd(), out)}`);
console.log(`   진화 없는 종 중 전설·환상 ${singles.filter((l) => l.legendary).length}개: ${singles.filter((l) => l.legendary).map((l) => l.line).join(", ")}`);
console.log(`   그 밖: ${singles.filter((l) => !l.legendary).map((l) => l.line).join(", ")}`);

console.log("\n성격 조회 중…");
const nat = await natures();
const natOut = path.join(process.cwd(), "src", "main", "natures.json");
fs.writeFileSync(natOut, JSON.stringify(nat, null, 1), "utf8");
console.log(`✅ ${nat.length}개 성격 → ${path.relative(process.cwd(), natOut)}`);

/* ---- 뽑기 확률이 어떻게 나오는지 바로 보여준다 ---- */
const sum = lines.reduce((a, l) => a + l.captureRate, 0);
const sorted = [...lines].sort((a, b) => a.captureRate - b.captureRate);
console.log("\n가장 희귀한 5개:");
for (const l of sorted.slice(0, 5)) {
  const p = (l.captureRate / sum) * 100;
  console.log(
    `  ${l.names[3].padEnd(12)} 포획률 ${String(l.captureRate).padStart(3)}` +
      `  →  ${p.toFixed(3)}%  (약 1/${Math.round(100 / p)})` + (l.legendary ? "  ⭐전설" : ""),
  );
}
console.log("\n가장 흔한 3개:");
for (const l of sorted.slice(-3)) {
  const p = (l.captureRate / sum) * 100;
  console.log(`  ${l.names[3].padEnd(12)} 포획률 ${l.captureRate}  →  ${p.toFixed(2)}%`);
}
console.log(`\n전설 라인: ${lines.filter((l) => l.legendary).length}개`);
