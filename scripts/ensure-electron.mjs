/**
 * Electron 실행 파일이 제대로 깔렸는지 보고, 없으면 그 자리에서 받는다.
 *
 * Electron 은 npm install 때 설치 스크립트(postinstall)로 실행 파일을 따로 받는다.
 * 그런데 그 스크립트가 막히는 일이 있다 — 최근 npm 은 의존 패키지의 설치 스크립트를
 * 허용 목록(allowScripts)으로 다루고, --ignore-scripts·회사망·백신이 막기도 한다.
 * 그러면 설치는 "성공"으로 끝나는데 npm start 에서야
 *
 *   Error: Electron failed to install correctly ... (node_modules\electron\index.js)
 *
 * 가 난다. 무엇이 문제인지 알 길이 없다. 그래서 npm install 뒤(postinstall)와
 * npm start 앞(prestart)에서 한 번 보고, 없으면 Electron 의 설치 스크립트를 직접 돌린다.
 * 그래도 안 되면 무엇을 하면 되는지 한국어로 말한다.
 *
 *   node scripts/ensure-electron.mjs           없을 때만 받는다
 *   node scripts/ensure-electron.mjs --force   (npm run fix-electron) 지우고 다시 받는다
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dir = path.join(process.cwd(), "node_modules", "electron");
const ok = () => {
  try {
    const exe = fs.readFileSync(path.join(dir, "path.txt"), "utf8").trim();
    return Boolean(exe) && fs.existsSync(path.join(dir, "dist", exe));
  } catch {
    return false;
  }
};

if (!fs.existsSync(dir)) {
  console.error("\n[PokeTokenBar] node_modules 가 없습니다. 먼저 npm install 을 실행해 주세요.\n");
  process.exit(1);
}
if (process.argv.includes("--force")) {
  // 반쯤 받다 끊긴 파일이 남아 있으면 install.js 가 "이미 있다"며 넘어갈 수 있다 — 지우고 시작한다
  fs.rmSync(path.join(dir, "path.txt"), { force: true });
  fs.rmSync(path.join(dir, "dist"), { recursive: true, force: true });
  console.log("\n[PokeTokenBar] Electron 실행 파일을 지우고 다시 받습니다(100MB 남짓, 1~2분)…");
} else if (ok()) process.exit(0);
else console.log("\n[PokeTokenBar] Electron 실행 파일이 없습니다. 지금 받습니다(100MB 남짓, 1~2분)…");
const r = spawnSync(process.execPath, [path.join(dir, "install.js")], { cwd: dir, stdio: "inherit" });
if (r.status === 0 && ok()) {
  console.log("[PokeTokenBar] Electron 을 받았습니다.\n");
  process.exit(0);
}

console.error(`
[PokeTokenBar] Electron 을 받지 못했습니다.

  - 인터넷이 GitHub(github.com)에 닿는지 확인해 주세요. 회사망·백신이 막을 수 있습니다.
  - 다시 시도:  npm run fix-electron
  - 그래도 안 되면 Releases 의 설치 파일(PokeTokenBar-Setup-x.y.z.exe)을 쓰세요.
`);
process.exit(1);
