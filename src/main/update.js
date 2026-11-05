"use strict";
/**
 * 새 버전 알림 — GitHub 의 "가장 최근 릴리스"를 보고 지금 버전보다 새것인지 본다.
 *
 * ── 원칙 ──
 * 설치 파일(.exe)이 붙은 릴리스만 친다. 태그만 올리고 아직 파일을 안 올렸을 때 알리면
 * 눌러도 받을 게 없다. 초안 · 사전 릴리스는 releases/latest 가 애초에 주지 않는다.
 *
 * 자동으로 깔지는 않는다 — 코드 서명이 없어 어차피 사람이 "추가 정보 → 실행"을 눌러야 한다.
 * 알리고, 누르면 릴리스 페이지를 연다. 그게 전부다.
 *
 * 네트워크는 하루 몇 번뿐이다(켤 때 · 6시간마다). 토큰 기록 같은 건 아무것도 보내지 않는다.
 */
const REPO = "paul0755/poketokenbar-win";
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const PAGE = `https://github.com/${REPO}/releases/`; // 이 주소 아래만 연다

/** "v0.14.3" · "0.14.3" → [0, 14, 3]. 못 읽으면 null */
function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || "").trim());
  return m ? m.slice(1).map(Number) : null;
}

/** a 가 b 보다 새 버전인가 */
function newer(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** GitHub 응답 → { version, url, name } · 받을 게 없으면 null */
function fromRelease(r) {
  if (!r || r.draft || r.prerelease) return null;
  const v = parse(r.tag_name);
  if (!v) return null;
  const exe = (r.assets || []).some((a) => /\.exe$/i.test(a && a.name) && a.state !== "uploading");
  if (!exe) return null;
  const url = typeof r.html_url === "string" && r.html_url.startsWith(PAGE) ? r.html_url : PAGE + "latest";
  return { version: v.join("."), url, name: String(r.name || "").slice(0, 80) };
}

/** 열어도 되는 주소인가 — 이 저장소의 릴리스 페이지만 */
const safeUrl = (u) => typeof u === "string" && u.startsWith(PAGE);

/** 가장 최근 릴리스. 실패하면 null(조용히 — 다음에 다시 본다) */
async function latest(current, timeoutMs = 10_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `PokeTokenBar/${current}` },
      signal: ac.signal,
    });
    if (!res.ok) return null;
    return fromRelease(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { REPO, PAGE, parse, newer, fromRelease, safeUrl, latest };
