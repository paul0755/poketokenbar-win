"use strict";
/**
 * AI 코딩 도구의 로컬 로그에서 토큰 사용량을 읽는다.
 *
 * macOS 원본과 같은 경로를 쓴다 — Windows에도 똑같이 있다.
 *   Claude Code: ~/.claude/projects/**  /*.jsonl
 *
 * 네트워크를 쓰지 않는다. 이 파일들은 이미 당신 디스크에 있다.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** 로그가 있을 만한 곳. 없는 건 조용히 건너뛴다. */
const SOURCES = [
  { id: "claude", label: "Claude Code", dir: path.join(os.homedir(), ".claude", "projects"), ext: ".jsonl" },
];

function walk(dir, ext, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // 폴더가 없으면 그 도구를 안 쓰는 것뿐이다
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

/**
 * 한 줄에서 토큰 수를 뽑는다.
 *
 * 캐시 읽기/쓰기까지 전부 더한다. 청구 기준이 아니라 "얼마나 굴렸나"가
 * 이 앱의 관심사이기 때문이다. 캐시를 뺐더니 하루 수치가 1/10로 줄어
 * 게임이 성립하지 않았다.
 */
function tokensOf(usage) {
  if (!usage) return 0;
  return (
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

function readClaudeFile(file, acc) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return; // 쓰기 중인 파일일 수 있다. 다음 폴링에서 잡힌다
  }
  for (const line of text.split("\n")) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // 마지막 줄이 잘려 있는 건 정상이다 (계속 쓰이는 파일)
    }
    if (o.type !== "assistant") continue;
    const n = tokensOf(o.message && o.message.usage);
    if (!n) continue;
    const day = String(o.timestamp ?? "").slice(0, 10);
    if (!day) continue;
    acc.byDay.set(day, (acc.byDay.get(day) ?? 0) + n);
    const model = (o.message && o.message.model) || "unknown";
    acc.byModel.set(model, (acc.byModel.get(model) ?? 0) + n);
    acc.total += n;
  }
}

/** 로컬 날짜 'YYYY-MM-DD'. 로그의 timestamp는 UTC라 하루가 밀릴 수 있어 맞춰준다. */
function localDay(d = new Date()) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

function collect() {
  const acc = { byDay: new Map(), byModel: new Map(), total: 0, files: 0 };
  for (const src of SOURCES) {
    const files = walk(src.dir, src.ext);
    acc.files += files.length;
    for (const f of files) readClaudeFile(f, acc);
  }
  const today = localDay();
  const days = [...acc.byDay.entries()].sort();
  return {
    total: acc.total,
    today: acc.byDay.get(today) ?? 0,
    days,
    models: [...acc.byModel.entries()].sort((a, b) => b[1] - a[1]),
    fileCount: acc.files,
    scannedAt: Date.now(),
  };
}

module.exports = { collect, localDay, tokensOf };

// node src/main/usage.js 로 바로 확인할 수 있게
if (require.main === module) {
  const r = collect();
  console.log("파일", r.fileCount, "· 총", r.total.toLocaleString(), "· 오늘", r.today.toLocaleString());
  for (const [d, t] of r.days) console.log("  " + d, t.toLocaleString());
}
