/**
 * 각 도구의 로그에서 토큰 사용량이 어떤 모양으로 들어 있는지 찾는다.
 *
 * 파서를 추측으로 쓰면 틀린 숫자가 조용히 들어온다.
 * 실제 파일을 열어 usage 비슷한 키를 전부 뽑아본 뒤에 쓴다.
 *
 *   node scripts/probe-formats.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();

const TARGETS = [
  { id: "codex", dir: path.join(HOME, ".codex", "sessions"), ext: ".jsonl" },
  { id: "gemini", dir: path.join(HOME, ".gemini", "antigravity"), ext: ".jsonl" },
  { id: "copilot", dir: path.join(HOME, ".copilot", "eclipse"), ext: ".jsonl" },
];

/** 토큰 수처럼 보이는 키 */
const TOKENISH = /token|usage|prompt|completion|cached|input|output/i;

function walk(dir, ext, out = [], depth = 0) {
  if (depth > 8) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out, depth + 1);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

/** 중첩 객체에서 토큰스러운 키를 경로째 뽑는다 */
function findTokenish(obj, prefix = "", hits = new Map(), depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return hits;
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? prefix + "." + k : k;
    if (TOKENISH.test(k) && (typeof v === "number" || typeof v === "object")) {
      if (typeof v === "number") hits.set(p, v);
      else if (v && typeof v === "object") {
        const inner = Object.entries(v).filter(([, x]) => typeof x === "number");
        if (inner.length) hits.set(p, Object.fromEntries(inner));
      }
    }
    if (v && typeof v === "object") findTokenish(v, p, hits, depth + 1);
  }
  return hits;
}

for (const t of TARGETS) {
  console.log("\n" + "═".repeat(60));
  console.log("  " + t.id + "   " + t.dir);
  console.log("═".repeat(60));

  const files = walk(t.dir, t.ext);
  if (!files.length) {
    console.log("  파일 없음");
    continue;
  }
  // 가장 최근 파일부터 본다 — 포맷이 바뀌었을 수 있다
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  console.log(`  파일 ${files.length}개 · 최근: ${path.basename(files[0])}`);

  const typeCount = new Map();
  const tokenPaths = new Map();
  let scanned = 0;

  for (const f of files.slice(0, 6)) {
    let text;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      scanned++;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const ty = o.type || o.kind || o.event || o.role || "(무표시)";
      typeCount.set(ty, (typeCount.get(ty) ?? 0) + 1);
      for (const [p, v] of findTokenish(o)) {
        if (!tokenPaths.has(p)) tokenPaths.set(p, { count: 0, sample: v, type: ty });
        tokenPaths.get(p).count++;
      }
    }
  }

  console.log(`  ${scanned}줄 검사\n`);
  console.log("  레코드 종류:");
  for (const [k, v] of [...typeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log("    " + String(v).padStart(5) + "  " + k);
  }

  console.log("\n  토큰스러운 필드:");
  const paths = [...tokenPaths.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12);
  if (!paths.length) console.log("    없음");
  for (const [p, info] of paths) {
    const s = typeof info.sample === "object" ? JSON.stringify(info.sample) : info.sample;
    console.log(`    ${String(info.count).padStart(4)}회  ${p}  [type=${info.type}]`);
    console.log(`          예: ${String(s).slice(0, 140)}`);
  }
}
