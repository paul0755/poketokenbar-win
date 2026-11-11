"use strict";
/**
 * 🦖 디지몬 세계 데이터 만들기 — 한 번 돌려 결과를 저장소에 넣는다(앱은 실행 중에 바깥에서 받지 않는다).
 *
 *   node scripts/digimon.js            데이터 + 그림(없는 것만)
 *   node scripts/digimon.js --data     데이터만
 *
 * 그림: humulos.com 의 Vital Bracelet 컬러 도트(72×72, 두 장) — 두 장을 이어 움직이는 GIF 한 장으로.
 *       남의 개인 사이트라 한 번 받아 assets/digimon 에 두고, 다시 돌려도 있는 건 받지 않는다.
 * 진화: Digi-API(digi-api.com, 자료는 주로 Wikimon) 의 단계 · 속성 · 다음 진화.
 *       그림이 있는 디지몬끼리, 성장기 → 성숙기 → 완전체 → 궁극체로 이어지는 것만 남긴다.
 *
 * 결과: src/main/worlds/digimon.json — { nodes: { key: { en, level, attr, sprite, skills } }, next: { key: [key] }, starters: [key],
 *        fuse: { 결과key: [{ from: 밑동key, partner: { keys: [key] } | { attrs: ["Data"], level: "Adult" } }] } }  — 조그레스
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT_JSON = path.join(ROOT, "src", "main", "worlds", "digimon.json");
const OUT_SPR = path.join(ROOT, "assets", "digimon");
const HUM = "https://humulos.com/digimon";
const API = "https://digi-api.com/api/v1/digimon/";
const UA = { "User-Agent": "PokeTokenBar data builder (one-time)" };
const DEVICES = ["vbdm", "vbbe"];
const LEVELS = ["Child", "Adult", "Perfect", "Ultimate"];
const DATA_ONLY = process.argv.includes("--data");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, json = false) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (r.status === 404 || r.status === 400) return null; // 400 — "Imperialdramon: Dragon Mode" 처럼 API 가 못 받는 이름
      if (!r.ok) throw new Error(r.status);
      return json ? r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i === 2) throw new Error(url + " " + e.message);
      await sleep(1500);
    }
  }
}

/** "Metal Greymon (Vaccine)" · "Agumon (2006)" → "Metal Greymon" · "Agumon" — Digi-API 이름 */
const baseName = (t) => t.replace(/\s*\((Vaccine|Virus|Data|Black|Blue|Green|2006|2010)\)$/i, "").trim();
const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* ---------------- GIF 두 장 → 움직이는 GIF 한 장 (풀지 않고 블록만 옮긴다) ---------------- */
function parseGif(buf) {
  if (buf.toString("latin1", 0, 3) !== "GIF") throw new Error("GIF 아님");
  const w = buf.readUInt16LE(6), h = buf.readUInt16LE(8), packed = buf[10];
  let p = 13, gct = null, gctBits = 0, gce = null;
  if (packed & 0x80) {
    gctBits = packed & 7;
    const n = 3 * (1 << (gctBits + 1));
    gct = buf.subarray(p, p + n);
    p += n;
  }
  const skipSub = () => { while (buf[p] !== 0) p += buf[p] + 1; p++; };
  while (p < buf.length) {
    if (buf[p] === 0x21) {
      if (buf[p + 1] === 0xf9) gce = { packed: buf[p + 3], trans: buf[p + 6] };
      p += 2;
      skipSub();
    } else if (buf[p] === 0x2c) {
      const start = p, ip = buf[p + 9];
      p += 10;
      if (ip & 0x80) p += 3 * (1 << ((ip & 7) + 1));
      p++;
      skipSub();
      return { w, h, gct, gctBits, gce, frame: buf.subarray(start, p) };
    } else break;
  }
  throw new Error("이미지 블록 없음");
}
function combineGif(frames, delay) {
  const f0 = frames[0];
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(f0.w, 0);
  lsd.writeUInt16LE(f0.h, 2);
  lsd[4] = 0x70; // 전역 색표 없음 — 장마다 자기 색표
  const parts = [Buffer.from("GIF89a", "latin1"), lsd];
  if (frames.length > 1) parts.push(Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0", "latin1"), 3, 1, 0, 0, 0]));
  for (const f of frames) {
    const t = f.gce && f.gce.packed & 1;
    // 2 = 다음 장 전에 지운다 — 투명한 자리로 앞 장이 비치지 않게
    parts.push(Buffer.from([0x21, 0xf9, 4, (2 << 2) | (t ? 1 : 0), delay & 0xff, delay >> 8, t ? f.gce.trans : 0, 0]));
    const fr = Buffer.from(f.frame);
    if (!(fr[9] & 0x80)) {
      fr[9] = (fr[9] & 0x40) | 0x80 | f.gctBits;
      parts.push(fr.subarray(0, 10), f.gct, fr.subarray(10));
    } else parts.push(fr);
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

(async () => {
  // 1) humulos — 기기마다 그림 key 와 이름
  const sprites = new Map(); // baseName → { key, dev, title }
  // 어느 카드(DIM)에 들어 있나 — 진화는 같은 카드 안에서만 잇는다. Digi-API 의 진화는 애니 · 게임 · 카드를
  // 다 모은 것이라 그대로 쓰면 아구몬 다음이 19갈래가 된다. 기기 한 장 안의 나무가 원작 느낌이다
  const dims = new Map(); // baseName → Set("vbdm:dro")
  for (const dev of DEVICES) {
    const html = (await get(`${HUM}/${dev}/`)).toString("utf8");
    const cols = [...html.matchAll(/id="([a-z0-9_]+?)(?:Child|Adult|Perfect|Ultimate|Super|Baby\w*)Column"/g)].map((m) => [m.index, m[1]]);
    const re = new RegExp(`images/dot/${dev}/(?!frame2)([a-z0-9_]+)\\.gif"[^>]*title="([^"]+)"`, "g");
    for (const m of html.matchAll(re)) {
      const [, key, title] = m;
      if (key.startsWith("digitama")) continue;
      const b = baseName(title);
      if (!sprites.has(b)) sprites.set(b, { key, dev, title });
      const col = cols.filter((c) => c[0] < m.index).pop();
      if (col) {
        if (!dims.has(b)) dims.set(b, new Set());
        dims.get(b).add(dev + ":" + col[1]);
      }
    }
    await sleep(800);
  }
  const sameCard = (a, b) => [...(dims.get(a) || [])].some((d) => (dims.get(b) || new Set()).has(d));
  console.log("그림 있는 디지몬", sprites.size);

  // 2) Digi-API — 단계 · 속성 · 다음 진화
  const info = new Map();
  for (const [b] of sprites) {
    const d = await get(API + encodeURIComponent(b), true);
    await sleep(250);
    if (!d || !d.name) { console.log("  API 없음:", b); continue; }
    const level = (d.levels || []).map((l) => l.level).find((l) => LEVELS.includes(l));
    if (!level) continue;
    info.set(b, {
      level,
      attr: ((d.attributes || [])[0] || {}).attribute || "Free",
      next: (d.nextEvolutions || []).map((e) => norm(e.digimon)),
      // 필살기 — 바탕화면 펫이 쓰는 기술(digifx.js). 일본어 로마자면 영어 번역을 쓴다. 앞의 셋까지
      skills: [...new Set((d.skills || []).map((x) => String(x.translation || x.skill || "").trim()).filter(Boolean))].slice(0, 3),
      prior: (d.priorEvolutions || []).map((e) => norm(e.digimon)),
      // 진화 조건 — "with Stingmon" 처럼 다른 디지몬이 있어야 하는 것(조그레스)을 가르는 데 쓴다
      priorCond: new Map((d.priorEvolutions || []).map((e) => [norm(e.digimon), String(e.condition || "")])),
      nextCond: new Map((d.nextEvolutions || []).map((e) => [norm(e.digimon), String(e.condition || "")])),
    });
  }
  console.log("단계가 맞는 디지몬", info.size);

  // 3) 성장기 → 성숙기 → 완전체 → 궁극체 로 이어지는 것만
  const names = [...info.keys()];
  const byNorm = new Map(names.map((n) => [norm(n), n]));
  /*
   * 조그레스(합체 진화) — 조건이 "with X"(X 가 꼭 있어야 한다)인 진화는 보통 진화에서 뺀다.
   * "with or without X" 는 있어도 없어도 되니 보통 진화. 특별한 물건(Digitron · Satellite · Spirit …)이나
   * 셋 이상이 합쳐야 하는 것은 다루지 않는다(그 길은 아예 없앤다).
   * 짝은 이름(Stingmon)이거나 VB 식 속성 조건("a Data or Free Attribute Adult Digimon")이다.
   */
  const condOf = (a, b) => info.get(b).priorCond.get(norm(a)) || info.get(a).nextCond.get(norm(b)) || "";
  function jogress(cond) {
    const c = cond.trim();
    if (!/^with\b/i.test(c) || /^with or without/i.test(c)) return null; // 보통 진화
    const rest = c.replace(/^with\s+/i, "");
    if (/digitron|satellite|spirit|crest|digimental|item|\band\b/i.test(rest)) return { skip: true };
    const at = /^an? ((?:\w+)(?: or \w+)*) Attribute (Child|Adult|Perfect|Ultimate) Digimon/i.exec(rest);
    if (at) return { attrs: at[1].split(/ or /i).map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()), level: at[2][0].toUpperCase() + at[2].slice(1).toLowerCase() };
    const who = rest.split(/,\s*(?:or\s+)?|\s+or\s+/i).map((x) => byNorm.get(norm(x))).filter(Boolean);
    return who.length ? { names: who } : { skip: true };
  }
  const nextOf = new Map();
  const fuseEdges = []; // { a, b, partner }
  for (const a of names) {
    const A = info.get(a);
    const li = LEVELS.indexOf(A.level);
    const out = [];
    for (const b of names) {
      if (b === a) continue;
      const B = info.get(b);
      const bi = LEVELS.indexOf(B.level);
      if ((bi !== li + 1 && bi !== li) || !sameCard(a, b)) continue;
      if (!(A.next.includes(norm(b)) || B.prior.includes(norm(a)))) continue;
      const j = jogress(condOf(a, b));
      if (j) { if (!j.skip) fuseEdges.push({ a, b, partner: j }); continue; }
      if (bi === li + 1) out.push(b); // 같은 단계로 가는 건 합체(오메가몬 …)뿐이다
    }
    nextOf.set(a, out);
  }
  console.log("조그레스 후보", fuseEdges.length, "줄");
  // 끝(궁극체)까지 갈 수 있는 것만 남긴다 — 뒤에서부터
  const ok = new Set(names.filter((n) => info.get(n).level === "Ultimate"));
  for (let li = LEVELS.length - 2; li >= 0; li--) {
    for (const n of names) if (info.get(n).level === LEVELS[li] && (nextOf.get(n) || []).some((x) => ok.has(x))) ok.add(n);
  }
  // 성장기에서 닿는 것만
  const reach = new Set();
  const walk = (n) => { if (reach.has(n) || !ok.has(n)) return; reach.add(n); for (const x of nextOf.get(n) || []) walk(x); };
  for (const n of names) if (info.get(n).level === "Child") walk(n);

  const keyOf = (n) => sprites.get(n).key + (sprites.get(n).dev === "vbbe" ? "@be" : "");
  // 조그레스로만 닿는 디지몬도 남긴다 — 밑동이 남아 있고, 짝을 찾을 수 있고, 그 뒤로 궁극체까지 갈 수 있으면
  const fuse = {};
  const keep = new Set(reach);
  for (const e of fuseEdges) {
    if (!reach.has(e.a)) continue;
    if (!(ok.has(e.b) || info.get(e.b).level === "Ultimate")) continue;
    let partner;
    if (e.partner.names) {
      const keys = e.partner.names.filter((x) => reach.has(x));
      if (!keys.length) continue;
      partner = { keys: keys.map(keyOf) };
    } else partner = { attrs: e.partner.attrs, level: e.partner.level };
    keep.add(e.b);
    walk2(e.b);
    (fuse[keyOf(e.b)] = fuse[keyOf(e.b)] || []).push({ from: keyOf(e.a), partner });
  }
  function walk2(n) { keep.add(n); for (const x of nextOf.get(n) || []) if (ok.has(x) && !keep.has(x)) walk2(x); }
  const nodes = {}, next = {};
  for (const n of keep) {
    const s = sprites.get(n), I = info.get(n);
    const k = keyOf(n);
    nodes[k] = { en: n, level: I.level, attr: I.attr, sprite: `${s.dev}_${s.key}`, skills: I.skills };
    const nx = (nextOf.get(n) || []).filter((x) => keep.has(x) && ok.has(x)).map(keyOf);
    if (nx.length) next[k] = nx;
  }
  const starters = Object.keys(nodes).filter((k) => nodes[k].level === "Child");
  const count = (lv) => Object.values(nodes).filter((x) => x.level === lv).length;
  console.log("남긴 디지몬", Object.keys(nodes).length, LEVELS.map((l) => `${l} ${count(l)}`).join(" · "), "· 조그레스", Object.keys(fuse).length, "종");
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify({ source: "humulos.com (Vital Bracelet dot) · digi-api.com (evolutions)", nodes, next, fuse, starters }, null, 1));
  console.log("→", path.relative(ROOT, OUT_JSON));

  if (DATA_ONLY) return;
  // 4) 그림 — 없는 것만
  fs.mkdirSync(OUT_SPR, { recursive: true });
  for (const k of Object.keys(nodes)) {
    const n = nodes[k];
    const out = path.join(OUT_SPR, n.sprite + ".gif");
    if (fs.existsSync(out)) continue;
    const [dev, key] = [n.sprite.slice(0, 4), n.sprite.slice(5)];
    const a = parseGif(await get(`${HUM}/images/dot/${dev}/${key}.gif`));
    const f2 = await get(`${HUM}/images/dot/${dev}/frame2/${key}.gif`);
    const frames = f2 ? [a, parseGif(f2)] : [a];
    fs.writeFileSync(out, combineGif(frames, 50));
    fs.writeFileSync(path.join(OUT_SPR, n.sprite + "-still.gif"), combineGif([a], 0));
    process.stdout.write(".");
    await sleep(300);
  }
  console.log("\n그림", fs.readdirSync(OUT_SPR).length / 2, "→ assets/digimon");
})().catch((e) => { console.error(e); process.exit(1); });
