/**
 * PokéAPI에서 진화 라인을 받아 src/main/lines.json 을 만든다.
 *
 * 손으로 적으면 반드시 틀린다 — 도감 번호도, 한국어 이름도.
 * 출처에서 받아 생성하고, 결과물은 커밋해서 실행 시 네트워크를 타지 않게 한다.
 *
 * 제약: 5세대 흑백 애니메이션 스프라이트가 있는 도감 1~649번만 쓴다.
 *       라인 전체가 이 범위 안에 들어와야 채택한다 (중간만 움직이면 이상하다).
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
  acc.push({ name: node.species.name, dex: dexOf(node.species.url) });
  if (node.evolves_to && node.evolves_to.length) flatten(node.evolves_to[0], acc);
  return acc;
}

async function koreanName(dex) {
  const s = await getJson(`https://pokeapi.co/api/v2/pokemon-species/${dex}`);
  const ko = (s.names || []).find((n) => n.language && n.language.name === "ko");
  return ko ? ko.name : null;
}

const ids = Array.from({ length: CHAINS }, (_, i) => i + 1);
console.log(`진화 체인 ${CHAINS}개 조회 중…`);

const chains = await mapLimit(ids, CONCURRENCY, (id) =>
  getJson(`https://pokeapi.co/api/v2/evolution-chain/${id}`),
);

const candidates = [];
for (const c of chains) {
  if (!c || !c.chain) continue;
  const stages = flatten(c.chain);
  if (stages.length < 2) continue; // 진화 안 하는 종은 키우는 재미가 없다
  if (stages.some((s) => s.dex > MAX_DEX)) continue; // 애니메이션 스프라이트 없음
  candidates.push(stages);
}
console.log(`  진화하는 라인 ${candidates.length}개`);

console.log("한국어 이름 조회 중…");
const dexes = [...new Set(candidates.flat().map((s) => s.dex))];
const names = new Map();
await mapLimit(dexes, CONCURRENCY, async (d) => names.set(d, await koreanName(d)));

const missing = dexes.filter((d) => !names.get(d));
if (missing.length) console.log(`  한국어 이름 없음 ${missing.length}개 — 해당 라인 제외`);

const lines = [];
for (const stages of candidates) {
  if (stages.some((s) => !names.get(s.dex))) continue;

  // STAGES(알·부화·1차·최종·마스터) 5칸에 맞춘다.
  // 2단 진화 라인은 중간을 최종으로 한 번 더 채운다.
  const s = stages.slice(0, 3);
  const pick = (i) => s[Math.min(i, s.length - 1)];
  const slots = [null, pick(0), pick(1), pick(2), pick(2)];

  lines.push({
    line: names.get(s[0].dex),
    ids: slots.map((x) => (x ? x.dex : null)),
    names: slots.map((x) => (x ? names.get(x.dex) : "알")),
  });
}

lines.sort((a, b) => a.ids[1] - b.ids[1]);

const out = path.join(process.cwd(), "src", "main", "lines.json");
fs.writeFileSync(out, JSON.stringify(lines, null, 1), "utf8");
console.log(`\n✅ ${lines.length}개 라인 → ${path.relative(process.cwd(), out)}`);
console.log("\n예시:");
for (const l of lines.slice(0, 8)) console.log("  " + l.names.slice(1).join(" → "));
