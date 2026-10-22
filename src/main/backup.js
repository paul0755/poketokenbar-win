"use strict";
/**
 * 세이브 백업.
 *
 * 저장은 rename 으로 원자적이지만, 그건 "반쪽짜리 파일"을 막을 뿐이다.
 * 멀쩡하게 다 쓴 잘못된 세이브는 못 막는다 — 빈 박스를 읽고 알을 깐 판,
 * 실수로 누른 초기화, 다른 인스턴스가 덮어쓴 것. 0.2.x 에서 실제로 다 있었다.
 * 그래서 지난 며칠 치를 따로 남겨 둔다.
 *
 * ── 두 종류 ──
 *   daily     하루 한 번. 그날 처음 저장하기 직전의 파일을 남긴다.
 *             "켜기 전에 디스크에 있던 것"이 남으므로 그날 무슨 일이 생겨도
 *             어제까지의 진행은 살아 있다. 최근 DAILY_KEEP 일만 둔다.
 *   snapshot  지우는 일을 하기 직전(초기화·되돌리기). 언제든 한 번 더
 *             되돌릴 수 있게. 최근 SNAP_KEEP 개만 둔다.
 *
 * 파일 이름이 곧 목록이다. 따로 색인을 두면 그게 또 깨진다.
 */
const fs = require("node:fs");
const path = require("node:path");

const DAILY_KEEP = 7;
const SNAP_KEEP = 5;

const DAILY_RE = /^save-(\d{4}-\d{2}-\d{2})\.json$/;
const SNAP_RE = /^save-(before-reset|before-restore)-(\d{8}-\d{6})\.json$/;

const pad = (n) => String(n).padStart(2, "0");
// UTC 로 자르면 한국에선 오전 9시에 날짜가 바뀐다. 사람이 말하는 "오늘"은 로컬이다.
const dayKey = (d = new Date()) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const stamp = (d = new Date()) =>
  dayKey(d).replace(/-/g, "") + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());

/**
 * 남길 가치가 있는 세이브인가. 해석이 안 되거나 아무도 없는 판은 남기지 않는다 —
 * 그걸 남기면 일곱 칸 중 한 칸이 쓸모없는 것으로 밀려난다.
 * 0.1.x 세이브는 박스가 없고 lineIndex 만 있다.
 */
function inspect(raw) {
  try {
    const s = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    if (!s || typeof s !== "object") return null;
    const mons = Array.isArray(s.box) ? s.box.length : typeof s.lineIndex === "number" ? 1 : 0;
    return mons > 0 ? { mons } : null;
  } catch {
    return null;
  }
}

function prune(dir, re, keep) {
  const names = fs.readdirSync(dir).filter((n) => re.test(n)).sort(); // 이름 순 = 시간 순
  for (const n of names.slice(0, Math.max(0, names.length - keep))) {
    try { fs.rmSync(path.join(dir, n), { force: true }); } catch {}
  }
}

/**
 * 오늘 몫이 없으면 지금 디스크에 있는 세이브를 남긴다.
 * 저장할 때마다 불리므로 이미 있으면 파일 하나 확인하고 끝나야 한다.
 */
function daily(savePath, dir) {
  const dst = path.join(dir, "save-" + dayKey() + ".json");
  if (fs.existsSync(dst)) return false;
  let raw;
  try {
    raw = fs.readFileSync(savePath, "utf8");
  } catch {
    return false; // 첫 실행이면 남길 게 없다
  }
  if (!inspect(raw)) return false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dst, raw, "utf8");
    prune(dir, DAILY_RE, DAILY_KEEP);
    return true;
  } catch (e) {
    console.error("[backup] 하루치를 남기지 못했습니다 (" + (e.code || e.message) + ")");
    return false;
  }
}

/**
 * 지우기 직전에 지금 파일을 그대로 남긴다. 해석 여부를 따지지 않는다 —
 * 못 읽는 세이브를 되돌리려는 참일 수도 있고, 그것도 누군가의 진행이다.
 */
function snapshot(savePath, dir, reason) {
  try {
    if (!fs.existsSync(savePath)) return null;
    fs.mkdirSync(dir, { recursive: true });
    const name = "save-" + reason + "-" + stamp() + ".json";
    fs.copyFileSync(savePath, path.join(dir, name));
    prune(dir, SNAP_RE, SNAP_KEEP);
    return name;
  } catch (e) {
    console.error("[backup] 스냅샷을 남기지 못했습니다 (" + (e.code || e.message) + ")");
    return null;
  }
}

/** 화면에 보일 목록. 최근 것부터. */
function list(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    const d = DAILY_RE.exec(name);
    const s = SNAP_RE.exec(name);
    if (!d && !s) continue;
    try {
      const p = path.join(dir, name);
      const info = inspect(fs.readFileSync(p, "utf8"));
      out.push({
        file: name,
        kind: d ? "daily" : s[1],
        at: fs.statSync(p).mtimeMs,
        mons: info ? info.mons : 0,
        ok: Boolean(info),
      });
    } catch {}
  }
  return out.sort((a, b) => b.at - a.at);
}

/**
 * 되돌릴 원문을 읽는다. 렌더러가 보낸 이름을 그대로 경로에 붙이지 않는다 —
 * 정해진 이름 꼴이 아니면 백업 폴더 밖을 가리킬 수 있다.
 */
function read(dir, file) {
  if (typeof file !== "string" || (!DAILY_RE.test(file) && !SNAP_RE.test(file))) return null;
  try {
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    return inspect(raw) ? raw : null;
  } catch {
    return null;
  }
}

module.exports = { daily, snapshot, list, read, DAILY_KEEP, SNAP_KEEP };
