"use strict";
/**
 * Claude 공식 한도 — 새로고침 버튼을 눌렀을 때만 가져온다.
 *
 * ── 왜 이 파일이 필요한가 ──
 *
 * limits.js 는 로그만 읽는다. 로그에는 "얼마나 썼나"만 있고
 * "한도가 얼마인가"는 없다. 그래서 Claude 쪽은 퍼센트를 낼 수 없었고,
 * 쓴 양만 덩그러니 보여 줄 수밖에 없었다.
 *
 *   GET https://api.anthropic.com/api/oauth/usage
 *   Authorization: Bearer <accessToken>
 *
 * ── 토큰을 다루는 규칙 ──
 *
 * 1. 자동 호출 금지. 타이머도, 시작 시 1회도 없다. 사용자가 누를 때만 부른다.
 * 2. 토큰은 readToken() 밖으로 나가지 않는다. 저장하지 않고, 로그에 찍지 않고,
 *    에러 메시지에도 넣지 않는다. 남기는 건 퍼센트와 리셋 시각뿐이다.
 * 3. macOS 원본은 Keychain을 쓰지만 Windows에는 Keychain이 없다.
 *    Claude Code 가 자기 토큰을 두는 파일을 그대로 읽는다 — 원본도 같은 폴백을 쓴다.
 *
 * 응답을 해석하는 규칙은 quota-parse.js 에 따로 있다.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const parse = require("./quota-parse");

const CRED = path.join(os.homedir(), ".claude", ".credentials.json");
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

/** 토큰은 이 함수 안에서만 존재한다. 반환값을 어디에도 보관하지 말 것. */
function readToken() {
  let raw;
  try {
    raw = fs.readFileSync(CRED, "utf8");
  } catch (e) {
    // 어느 경로를 봤는지 말하지 않으면 사용자가 확인할 방법이 없다.
    // "못 찾았다"만 띄우면 다음에 뭘 해야 할지 알 수 없는 막다른 길이 된다.
    console.log("[claude-limits] 열지 못함 (" + e.code + "): " + CRED);
    throw new Error(
      e.code === "ENOENT"
        ? // Windows 의 Claude Code 는 토큰을 파일이 아니라 자격 증명 관리자에 둔다.
          // 그래서 이 경로는 보통 비어 있다 — 고장이 아니라 구조가 다른 것이다.
          // 막다른 길로 두지 말고 실제로 되는 방법을 가리킨다.
          "이 환경에서는 공식 한도를 가져올 수 없습니다. 설정 › 한도에 값을 넣으면 남은 %가 나옵니다."
        : "로그인 정보를 열지 못했습니다 (" + e.code + ")",
    );
  }
  let j;
  try {
    j = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    throw new Error("로그인 정보 파일을 읽지 못했습니다.");
  }
  const o = j.claudeAiOauth || j.oauth || j;
  const tok = o.accessToken || o.access_token;
  if (!tok) throw new Error("로그인 정보에 액세스 토큰이 없습니다. 다시 로그인해 주세요.");

  // 만료된 토큰으로 부르면 401만 돌아온다. 미리 알려주는 편이 친절하다.
  const exp = o.expiresAt ?? o.expires_at;
  if (typeof exp === "number") {
    const ms = exp > 1e12 ? exp : exp * 1000; // 초/밀리초 둘 다 온다
    if (Date.now() > ms) throw new Error("로그인이 만료됐습니다. claude 에 다시 로그인해 주세요.");
  }
  return tok;
}

/**
 * 한 번 가져온다.
 *
 * 실패를 던지지 않고 { ok:false, error } 로 돌려준다 — 버튼이 조용히 죽으면
 * 사용자는 눌렀는지 아닌지도 알 수 없다. 실패는 반드시 화면까지 간다.
 */
async function fetchQuota() {
  let res;
  try {
    const token = readToken();
    res = await fetch(USAGE_URL, {
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    // 여기서 잡히는 건 readToken 의 안내문이거나 네트워크 오류다.
    // 토큰 자체는 어떤 경로로도 이 메시지에 들어가지 않는다.
    return { ok: false, error: e.name === "TimeoutError" ? "응답이 없습니다 (15초)" : e.message };
  }

  if (res.status === 401 || res.status === 403)
    return { ok: false, error: "인증이 거부됐습니다. claude 에 다시 로그인해 주세요." };
  if (res.status === 429) return { ok: false, error: "요청이 너무 잦습니다. 잠시 뒤 다시 눌러 주세요." };
  if (!res.ok) return { ok: false, error: "서버 응답 " + res.status };

  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "응답을 해석하지 못했습니다." };
  }

  const windows = parse.harvest(body);
  if (!windows.length) {
    // 형태가 바뀐 것이다. 조용히 빈칸을 두지 말고 무엇이 왔는지 남긴다.
    console.log("[claude-limits] 퍼센트를 찾지 못함. 응답 형태: " + JSON.stringify(parse.shapeOf(body)));
    return { ok: false, error: "한도 값을 찾지 못했습니다. 응답 형태를 앱 로그에 남겼습니다." };
  }
  console.log("[claude-limits] " + windows.map((w) => w.label + " " + w.percent + "%").join(" · "));
  return { ok: true, windows, fetchedAt: Date.now() };
}

module.exports = { fetchQuota, CRED, USAGE_URL };
