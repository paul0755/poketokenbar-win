"use strict";
/**
 * ⚔️ 필드 배틀 — 디지털 월드의 결투(포켓몬 세계의 턴 결투는 그대로 battle.js).
 *
 * 메뉴에서 기술을 고르는 턴제가 아니다. 디지털 초원(room.js paintField) 위에서 둘이 알아서 뛰어다니며 싸운다 —
 * 다가가 들이받고, 뒤로 뛰어 거리를 벌리고, 그 모습의 둘째 · 셋째 기술을 틈틈이 쓴다(게이지 없이, 이름이 뜬다).
 * 나는 테이머다. 직접 조종하지 않고 테이머 게이지로 명령만 한다.
 *
 * 연출 색은 기술 이름의 원소(불 · 번개 · 얼음 · 어둠 · 빛 · 바람 · 대지 · 칼날 · 주먹)에 속성 색을 섞은 두 색.
 * 필살기는 바탕이 어두워지고, 맞는 순간 멈칫 · 번쩍 · 충격파, 완전체부터 빛기둥, 궁극체는 무지개 빛이 더해진다.
 *
 *   테이머 게이지   시간이 지나면 · 맞으면(많이) · 때리면(조금) 찬다. 0 ~ 100
 *   🔥 필살기 40    지금 모습의 필살기(이름으로 광선 · 베기 · 결계 · 파편 넷 중 하나 — digifx 와 같은 갈래)
 *   🛡 막아!  20    잠깐 버틴다 — 받는 피해 1/5, 안 밀린다
 *   📣 힘내!  30    6초 동안 빨라지고 세진다
 *   🧬 진화!  60 · 80 · 100   싸우는 중에 한 단계 진화(성숙기 · 완전체 · 궁극체로 갈수록 비싸다)
 *
 * 둘 다 성장기 모습으로 시작해서 그 아이가 실제로 가 본 모습까지만 진화할 수 있다(메인 fieldSetup 이 길을 준다).
 * 게이지를 명령에 쓰면 진화가 늦고, 아끼면 그동안 맞는다 — 그게 고민거리다. 필살기에 맞으면 게이지가 깨지니
 * 상대가 곧 진화할 때 필살기로 끊을 수도, 막아서 지킬 수도 있다. 상대 테이머(AI)도 같은 규칙.
 * 수치는 BAL 한곳에 모았다(헤드리스로 수백 판씩 돌려 맞췄다).
 * 체력이 0 이 되면 데이터로 흩어진다(DELETE). 120초가 지나면 남은 체력 비율로 가린다.
 * 속성은 원작의 세 갈래 — 백신 > 바이러스 > 데이터 > 백신.
 *
 * 그림 — 세 겹:  바탕 캔버스(초원, 320×200 을 확대) · 디지몬 <img>(움직이는 GIF 가 그대로 돈다) · 연출 캔버스(화면 해상도)
 * 좌표는 전부 초원 그림 좌표(320×200)로 계산하고 그릴 때 늘린다. 탭이 안 보이면 멈춘다.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const W = 320, H = 200, GROUND = 182; // 발 높이(그림 프레임 아랫변)
  const SIZE = [0, 54, 62, 70, 78]; // 단계별 그림 크기 — VB 도트는 72×72 프레임에 그려져 있다
  const HP = [0, 100, 170, 260, 370];
  const ATK = [0, 5, 8, 12, 17];
  const SPD = [0, 44, 50, 56, 62]; // 초당 픽셀
  const STAGE = ["", "성장기", "성숙기", "완전체", "궁극체"];
  const COST = { special: 40, guard: 20, rally: 30, evolve: 100 };
  /* 밸런스 — 헤드리스로 수백 판씩 돌려 맞춘 값(맞먹는 둘 ≈ 반반 · 속성 유리 ≈ 7할 · 한 단계 위 ≈ 8~9할 · Lv1 대 Lv100 도 가끔은 뒤집힌다) */
  const BAL = {
    evo: [0, 60, 80, 100], // 지금 단계 → 다음 진화에 드는 게이지. 앞쪽은 빨리, 궁극체 판은 길게
    fill: 3, // 초당 저절로 차는 게이지
    hurt: 200, // 맞은 피해(최대 체력 비율) × 이만큼 — 밀리는 쪽이 먼저 진화한다
    deal: 40, // 때린 피해 × 이만큼
    adv: 1.1, dis: 0.92, // 속성 유리 · 불리
    lv: 700, // Lv 1 → 100 이 체력 · 공격 각각 +14%
    roll: 0.25, // 한 대마다 피해가 ±이만큼 흔들린다
    combo: 0.5, chase: 0.75, dive: 0.35, // 이어치기 확률 · 띄운 뒤 쫓아가 내려치기 확률 · 초당 뛰어들기 확률
    tech: [1.1, 2.0], techX: 1.1, // 기술 — 쿨타임(초) · 피해 배율(들이받기 1, 필살기 2.4)
    crit: 0.1, critX: 1.8, // 급소 — 뻔한 판도 가끔 뒤집힌다
    drain: 25, // 필살기에 맞으면 게이지가 이만큼 깨진다
    dodge: 0.2, // 필살기를 뛰어서 피할 확률(맞는 쪽이 굳어 있지 않을 때)
    heal: 0.3, // 진화하면 늘어난 최대 체력에 더해 이만큼 회복 — 낮은 모습에서 끝나지 않게
  };
  const costOf = (f, k) => (k === "evolve" ? BAL.evo[form(f).stage] || COST.evolve : COST[k]);
  const BEATS = { 백신: "바이러스", 바이러스: "데이터", 데이터: "백신" };
  const LIMIT = 120;
  const COLOR = {
    백신: ["#5ee7ff", "#2a8cff", "#d6f9ff"],
    데이터: ["#3dffb4", "#12b886", "#d2ffee"],
    바이러스: ["#b45cff", "#ff3d7a", "#f0d6ff"],
    프리: ["#ffe066", "#ffb703", "#ffffff"],
    언노운: ["#cfd4dc", "#7c8494", "#ffffff"],
  };
  const colorOf = (a) => COLOR[a] || COLOR.데이터;
  const KIND = [
    ["beam", /beam|cannon|laser|blast|shot|shoot|breath|flame|fire|ray|force|bomb|buster|wave|thunder|lightning|elec|storm|nova|missile|bullet|impulse|spit|flare|burn|heat|drive|pitch|smash|crash/i],
    ["slash", /claw|fist|punch|kick|slash|blade|sword|cross|edge|spear|heel|knuckle|strike|cutter|horn|fang|bite|rush|tackle|blow|stance|lance|axe|sting|needle|scissor|slice/i],
    ["hex", /shield|wall|guard|barrier|aegis|armor|armour|protect|jail|cage|meditation|devout/i],
  ];
  const kindOf = (name) => (KIND.find(([, re]) => re.test(name || "")) || ["burst"])[0];
  /* 기술 색 — 이름에 든 원소로. 없으면 속성 색. 버금 색(두 번째 색)은 속성 색, 원소가 없으면 이름으로 고른 네온 */
  const ELEM = [
    [/flame|fire|burn|blaze|heat|pyro|magma|lava|solar|sun|prominence|meteor|nova|inferno|flare|crimson|baby flame|volcan/i, ["#ff8a3d", "#ff2d4a", "#fff0b0"]],
    [/thunder|lightning|elec|spark|volt|plasma|bolt|static|impulse/i, ["#ffe94a", "#ffa21a", "#ffffff"]],
    [/ice|frost|snow|freez|blizzard|cold|aqua|water|tidal|bubble|hydro|ocean|sea|rain|tsunami|blue/i, ["#7fdcff", "#2f6bff", "#ecffff"]],
    [/dark|death|shadow|night|evil|demon|hell|nightmare|venom|poison|grave|chaos|curse|ghost|black|abyss|guilt|trick|oni|devour/i, ["#c04dff", "#ff2a8a", "#f3d6ff"]],
    [/holy|heaven|saint|angel|light|shine|star|judg|grace|divine|glor|seven|god|sacred|celestial|gold|aurora|asteroid/i, ["#fff2a0", "#ffc83d", "#ffffff"]],
    [/leaf|forest|flower|plant|vine|wood|green|nature|seed|petal|bloom|poop/i, ["#8dff6a", "#1fbf4a", "#eaffd8"]],
    [/wind|tornado|cyclone|gale|air|sonic|hurricane|feather|wing|sky|mach|howl/i, ["#9dfff0", "#21c7b0", "#f0fffb"]],
    [/rock|stone|quake|earth|ground|sand|crush|iron|steel|metal|giga|mega|drill|cannon|destroy|revolver/i, ["#ffcf8a", "#c0702d", "#fff6e0"]],
    [/sword|blade|slash|claw|fang|edge|cutter|lance|spear|knife|scissor/i, ["#e8f4ff", "#8f9dff", "#ffffff"]],
    [/fist|punch|kick|heel|knuckle|blow|rush|tackle|smash|break|arts/i, ["#ffb36b", "#ff5a3d", "#fff3e0"]],
  ];
  const NEON = [["#ff6ad5", "#c74bff", "#ffe0f6"], ["#5effc8", "#00b3ff", "#e6fff7"], ["#ffd84a", "#ff6a3d", "#fff6d0"], ["#7c9bff", "#b45cff", "#e8ecff"], ["#ff7a7a", "#ffb03d", "#ffe8e0"]];
  const hashOf = (t) => [...String(t || "")].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  function palOf(name, attr) {
    const e = ELEM.find(([re]) => re.test(name || ""));
    const ac = colorOf(attr), neon = NEON[hashOf(name) % NEON.length];
    return e ? { c: e[1], ca: ac } : { c: ac, ca: neon };
  }
  const prism = (t, i = 0) => `hsl(${Math.round((t * 540 + i * 47) % 360)}, 100%, 66%)`;
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* ---------------- 상태 ---------------- */
  let mons = []; // 박스(알 빼고) — 고르기용
  let activeId = null;
  const sel = { me: null, foe: "wild" };
  let auto = false;
  try { auto = localStorage.getItem("ptbFieldAuto") === "1"; } catch {}
  // 연출 약하게 — 화면 번쩍임을 빼고 흔들림 · 어두워짐 · 속도선을 줄인다. 처음엔 Windows "애니메이션 효과" 설정을 따른다
  let calm = false;
  try {
    const v = localStorage.getItem("ptbFieldCalm");
    calm = v == null ? Boolean(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) : v === "1";
  } catch {}
  let G = null; // 지금 판
  let raf = 0, last = 0;
  let bgDone = false;

  /* ---------------- 판 만들기 ---------------- */

  const form = (f) => f.forms[f.fi];
  const lvF = (f) => 1 + (f.lv - 1) / BAL.lv;
  const maxHpOf = (f) => Math.round(HP[form(f).stage] * lvF(f));
  const atkOf = (f) => ATK[form(f).stage] * lvF(f) * (f.rally > 0 ? 1.3 : 1);
  const sizeOf = (f) => SIZE[form(f).stage];
  const canEvo = (f) => f.fi < f.forms.length - 1;
  const reachOf = (f, o) => (sizeOf(f) + sizeOf(o)) * 0.4 + 4; // 그림 프레임엔 여백이 있다 — 몸끼리 닿는 거리

  function fighter(side, info) {
    const f = {
      side, info, forms: info.forms, fi: 0, lv: info.lv || 1,
      x: side ? 250 : 70, z: 0, vz: 0, dir: side ? -1 : 1, off: 0, walk: 0,
      gauge: 0, act: null, cd: rnd(0.8, 1.4), scd: rnd(2.5, 4.5), tcd: rnd(1.2, 2.4), guard: 0, rally: 0, stun: 0, kb: 0,
      flash: 0, glitch: 0, think: rnd(0.5, 1), show: 0, alpha: 1, imgs: [], ghosts: [], trail: [],
    };
    f.max = f.hp = maxHpOf(f);
    return f;
  }

  function mountSprites() {
    const box = $("fbMons");
    box.innerHTML = "";
    for (const f of G.f) {
      // 잔상 — 베며 달려들 때 뒤로 남는 그림자(지금 모습의 그림을 그대로 쓴다)
      f.ghosts = [0, 1, 2, 3].map(() => {
        const im = document.createElement("img");
        im.className = "fb-mon fb-ghost";
        im.alt = "";
        im.style.display = "none";
        box.appendChild(im);
        return im;
      });
      f.imgs = f.forms.map((fm) => {
        const im = document.createElement("img");
        im.className = "fb-mon";
        im.alt = "";
        if (fm.url) im.src = fm.url;
        im.style.display = "none";
        box.appendChild(im);
        return im;
      });
    }
  }

  async function start() {
    if (G && !G.done) return;
    const me = sel.me;
    if (!me) return toast("내보낼 디지몬을 골라 주세요");
    $("fbGo").disabled = true;
    const r = await window.ptb.fieldSetup({ a: me, b: sel.foe });
    $("fbGo").disabled = false;
    if (!r || !r.ok) return toast(r ? r.reason : "배틀을 시작하지 못했습니다");
    G = {
      t: 0, pre: 1.6, f: [fighter(0, r.me), fighter(1, r.foe)], me: r.me, foe: r.foe,
      shots: [], parts: [], pops: [], fxs: [], cine: null, shake: 0, over: null, done: false, banner: null,
      dim: 0, lines: 0, linesC: null, flash: 0, flashMax: 1, flashC: "#fff", freeze: 0,
    };
    mountSprites();
    $("fbOver").innerHTML = "";
    $("fbOver").className = "fb-over";
    renderPick();
    loop();
  }

  function stop() {
    if (!G) return;
    G.done = true;
    G = null;
    $("fbMons").innerHTML = "";
    $("fbOver").className = "fb-over";
    $("fbOver").innerHTML = "";
    renderPick();
    idle();
  }

  /* ---------------- 명령 ---------------- */

  function command(f, k) {
    if (!G || G.done || G.over || G.cine || G.pre > 0) return false;
    if (k === "evolve" && !canEvo(f)) return false;
    if (f.gauge < costOf(f, k)) return false;
    if (f.act && (f.act.k === "special" || f.act.k === "slashrun")) return false;
    if (k === "rally" && f.rally > 0) return false;
    f.gauge -= costOf(f, k);
    const o = G.f[1 - f.side];
    if (k === "special") {
      const fm = form(f);
      const name = fm.skill || "DIGITAL ATTACK";
      const pal = palOf(name, fm.attr);
      f.act = { k: "special", t: 0, kind: kindOf(name), name: name.toUpperCase(), mode: "sp", c: pal.c, ca: pal.ca };
      // 컷인 — 판이 잠깐 멈추고 화면을 가로지르는 띠에 얼굴과 기술 이름이 크게 뜬다
      G.cut = { f, t: 0, max: 0.75, name: f.act.name, c: pal.c, ca: pal.ca, url: fm.url, side: f.side, stage: fm.stage };
      f.stun = 0;
      f.kb = 0;
      // 쏘는 기술 · 베는 기술은 뒤로 뛰어 거리를 벌리고 모은다 — 광선이 보일 만큼, 달려들 만큼
      if (f.act.kind !== "hex" && Math.abs(o.x - f.x) < 130) {
        const room = f.dir > 0 ? f.x - 18 : W - 18 - f.x; // 등 뒤로 남은 자리
        f.kb = -f.dir * Math.min(330, Math.max(0, room) * 5.5);
        f.vz = 130;
      }
    } else if (k === "guard") {
      f.act = { k: "guard", t: 0 };
      f.guard = 1.8;
      pop(f, "GUARD", "#9fd8ff", 7);
    } else if (k === "rally") {
      f.rally = 6;
      pop(f, "힘내!", "#ffcf5a", 8);
      for (let i = 0; i < 14; i++) G.parts.push({ x: f.x + rnd(-14, 14), y: GROUND - rnd(0, 30), vx: 0, vy: rnd(-50, -25), life: rnd(0.5, 0.9), max: 0.9, c: "#ffcf5a", s: 2 });
    } else if (k === "evolve") {
      G.cine = { f, t: 0, swapped: false, from: form(f), to: f.forms[f.fi + 1] };
      f.act = null;
      f.stun = 0;
      f.kb = 0;
      f.guard = 0;
    }
    if (f.side === 0) syncCmd();
    void o;
    return true;
  }

  /* 상대 테이머 — 내 쪽도 "자동 명령"을 켜면 같은 머리로 */
  function tamer(f, o, dt) {
    f.think -= dt;
    if (f.think > 0) return;
    f.think = rnd(0.35, 0.8);
    if (f.side === 0 && !auto) return;
    if (f.z > 0) return; // 떠 있을 땐 명령하지 않는다(공중에서 진화하면 허공에 멈춰 보인다)
    if (f.act && ["special", "slashrun", "recover", "guard"].includes(f.act.k)) return; // 들이받는 중이면 끊고 명령한다
    const coming = o.act && o.act.k === "special" && o.act.t < 0.7;
    if (canEvo(f)) {
      if (f.gauge >= costOf(f, "evolve")) return void command(f, "evolve");
      // 필살기가 오면 — 맞으면 게이지가 깨지니 막는 편이 대개 싸다
      if (coming && f.gauge >= COST.guard && Math.random() < (f.hp / f.max < 0.35 ? 0.6 : 0.4)) return void command(f, "guard");
      // 상대가 곧 진화하는데 나는 멀었다 — 필살기로 게이지를 깬다
      const oNear = canEvo(o) && o.gauge >= costOf(o, "evolve") - 15, meFar = f.gauge < costOf(f, "evolve") - 15;
      if (oNear && meFar && f.gauge >= COST.special && o.guard <= 0 && Math.random() < 0.35) return void command(f, "special");
      // 진화를 미뤄도 되는 단 하나 — 필살기 한 방이면 끝날 때
      if (f.gauge >= COST.special && o.hp < atkOf(f) * 2.4 * 0.9 && o.guard <= 0) command(f, "special");
      return;
    }
    if (coming && f.gauge >= COST.guard && Math.random() < 0.55) return void command(f, "guard");
    if (f.gauge >= COST.special && Math.random() < 0.45) return void command(f, "special");
    if (f.gauge >= COST.rally && f.rally <= 0 && Math.random() < 0.12) command(f, "rally");
  }

  /* ---------------- 피해 ---------------- */

  /** 한 대 — sp 는 필살기. 결과 "miss" · "guard" · "hit" */
  function hit(f, o, mult, at, mode = null, pal = null) {
    const sp = mode === "sp", tech = mode === "tech";
    const af = form(f).attr, ao = form(o).attr;
    const adv = BEATS[af] === ao ? BAL.adv : BEATS[ao] === af ? BAL.dis : 1;
    const guarded = o.guard > 0;
    if (sp && !guarded && o.stun <= 0 && !(o.act && o.act.k === "special") && Math.random() < BAL.dodge) {
      // 피했다 — 뛰어올라 흘려보낸다
      o.act = { k: "hop", t: 0 };
      o.vz = 190;
      o.kb = -f.dir * -60;
      pop(o, "MISS", "#cfd4dc", 8);
      return "miss";
    }
    const crit = !guarded && Math.random() < BAL.crit;
    let d = atkOf(f) * mult * adv * rnd(1 - BAL.roll, 1 + BAL.roll) * (crit ? BAL.critX : 1);
    if (guarded) d *= 0.2;
    d = Math.max(1, Math.round(d));
    o.hp = Math.max(0, o.hp - d);
    // 필살기에 맞으면 게이지가 깨진다(진화를 늦춘다) — 진화 전에 쓰는 필살기가 손해만은 아니게. 막으면 안 깨진다
    if (sp && !guarded) o.gauge = Math.max(0, o.gauge - BAL.drain);
    else o.gauge = Math.min(100, o.gauge + (d / o.max) * BAL.hurt);
    f.gauge = Math.min(100, f.gauge + (d / o.max) * BAL.deal);
    const big = sp || crit;
    if (crit) pop(o, "CRITICAL", "#ffcf5a", 6, -12);
    if (guarded) {
      o.kb = f.dir * 30;
      pop(o, "GUARD", "#9fd8ff", 6);
    } else {
      o.kb = f.dir * (big ? 280 : 120);
      o.stun = big ? 0.5 : 0.2;
      o.flash = 0.14;
      if (o.act && o.act.k !== "special") o.act = null;
      if (mode === "launch") { o.vz = 235; o.z = Math.max(o.z, 1); o.kb = f.dir * 70; o.stun = 0.95; }
      else if (mode === "smash") { o.vz = -320; o.kb = f.dir * 150; o.stun = 0.75; }
      else if (mode === "dive") { o.kb = f.dir * 210; o.stun = 0.3; }
      else if (mode === "combo") { o.kb = f.dir * 70; o.stun = 0.32; } // 이어치기 — 덜 밀어야 다음 대가 닿는다
    }
    pop(o, String(d) + (adv > 1 ? "▲" : adv < 1 ? "▼" : ""), adv > 1 ? "#ff6a6a" : adv < 1 ? "#9aa3b2" : "#ffffff", sp ? 13 : big ? 11 : 8);
    const c = colorOf(af);
    const hx = at != null ? at : o.x - f.dir * sizeOf(o) * 0.2;
    const hy = GROUND - o.z - sizeOf(o) * 0.45;
    if (sp || tech) {
      impact(f, o, hx, hy, guarded, pal || palOf(form(f).skill, af), sp);
    } else {
      for (let i = 0; i < (big ? 22 : 9); i++) {
        const a = rnd(0, Math.PI * 2), v = rnd(30, big ? 170 : 90);
        G.parts.push({ x: hx, y: hy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, life: rnd(0.25, 0.6), max: 0.6, c: i % 3 ? c[0] : c[2], s: big ? 3 : 2, g: 160, streak: big });
      }
      if (mode === "launch" || mode === "smash" || mode === "dive") {
        const cc = colorOf(af);
        G.fxs.push({ k: "boom", x: hx, y: hy, s: 9, c: cc, t: 0, max: 0.3 });
        G.fxs.push({ k: "ring", x: hx, y: hy, r0: 3, r1: 20, c: cc[2], w: 2, t: 0, max: 0.28 });
        G.freeze = Math.max(G.freeze, mode === "smash" ? 0.07 : 0.045);
        G.shake = Math.max(G.shake, 0.14);
        if (mode === "launch") for (let i = 0; i < 10; i++) G.parts.push({ x: hx + rnd(-6, 6), y: hy, vx: rnd(-30, 30), vy: rnd(-200, -90), life: rnd(0.25, 0.5), max: 0.5, c: i % 2 ? cc[0] : cc[2], s: 2, g: 200, streak: true });
      }
      if (crit) {
        G.fxs.push({ k: "ring", x: hx, y: hy, r0: 4, r1: 24, c: "#ffcf5a", w: 2, t: 0, max: 0.3 });
        G.freeze = Math.max(G.freeze, 0.05);
        G.shake = Math.max(G.shake, 0.18);
      }
    }
    return guarded ? "guard" : "hit";
  }

  /* 필살기가 맞는 순간 — 멈칫(히트스톱) · 번쩍 · 충격파 · 빛기둥 · 파편. 단계가 높을수록 크다 */
  function impact(f, o, x, y, guarded, pal, sp) {
    const S = form(f).stage, c = pal.c, ca = pal.ca;
    if (!sp) {
      // 기술 — 작게 번쩍, 두 색 불꽃
      if (guarded) {
        G.fxs.push({ k: "shield", f: o, c: colorOf(form(o).attr), t: 0, max: 0.35 });
        sparks(x, y, 8, colorOf(form(o).attr), 110);
        return;
      }
      G.freeze = Math.max(G.freeze, 0.035);
      G.shake = Math.max(G.shake, 0.08 + 0.03 * S);
      G.fxs.push({ k: "boom", x, y, s: 8 + 3 * S, c, ca, t: 0, max: 0.34 });
      G.fxs.push({ k: "ring", x, y, r0: 3, r1: 18 + 5 * S, c: ca[0], w: 2, t: 0, max: 0.32 });
      sparks(x, y, 7 + 3 * S, c, 110 + 15 * S);
      sparks(x, y, 4 + 2 * S, ca, 90 + 15 * S);
      return;
    }
    if (guarded) {
      const oc = colorOf(form(o).attr);
      G.fxs.push({ k: "shield", f: o, c: oc, t: 0, max: 0.5 });
      G.fxs.push({ k: "ring", x, y, r0: 4, r1: 26, c: oc[2], w: 2, t: 0, max: 0.28 });
      sparks(x, y, 16, oc, 150);
      G.freeze = Math.max(G.freeze, 0.06);
      G.shake = Math.max(G.shake, 0.15);
      return;
    }
    G.freeze = Math.max(G.freeze, 0.06 + 0.025 * S);
    G.flash = G.flashMax = 0.12 + 0.03 * S;
    G.flashC = c[2];
    G.shake = Math.max(G.shake, 0.2 + 0.1 * S);
    G.fxs.push({ k: "boom", x, y, s: 12 + 5 * S, c, ca, t: 0, max: 0.5 });
    G.fxs.push({ k: "ring", x, y, r0: 6, r1: 28 + 11 * S, c: c[0], w: 3, t: 0, max: 0.45 });
    G.fxs.push({ k: "ring", x, y, r0: 2, r1: 18 + 7 * S, c: ca[0], w: 2, t: 0, max: 0.36, delay: 0.07 });
    if (S >= 4) G.fxs.push({ k: "ring", x, y, r0: 10, r1: 70, prism: true, w: 3, t: 0, max: 0.6, delay: 0.12 }); // 궁극체 — 무지개 테
    if (S >= 3) G.fxs.push({ k: "pillar", x: o.x, w: 10 + 5 * S, c, ca, prism: S >= 4, t: 0, max: 0.65 });
    sparks(x, y, 12 + 6 * S, c, 130 + 35 * S);
    sparks(x, y, 6 + 3 * S, ca, 110 + 30 * S);
    if (S >= 4) for (let i = 0; i < 16; i++) { const a = rnd(0, Math.PI * 2), v = rnd(60, 230); G.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: rnd(0.4, 0.8), max: 0.8, c: prism(G.t, i * 3), s: 2, g: 180, streak: true }); }
    for (let i = 0; i < 5 + 2 * S; i++) {
      G.parts.push({ x: o.x + rnd(-sizeOf(o) * 0.4, sizeOf(o) * 0.4), y: y + rnd(-10, 14), vx: rnd(-12, 12), vy: rnd(-80, -35), life: rnd(0.5, 0.9), max: 0.9, c: [c[0], ca[0], c[2]][i % 3], s: 2, code: true });
    }
  }

  function sparks(x, y, n, c, v) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(v * 0.3, v);
      G.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: rnd(0.3, 0.75), max: 0.75, c: i % 3 ? c[0] : c[2], s: i % 4 ? 2 : 3, g: 220, streak: true });
    }
  }

  function pop(f, text, c, s, dy = 0) {
    G.pops.push({ x: f.x + rnd(-6, 6), y: GROUND - f.z - sizeOf(f) * 0.85 + dy, text, c, s, life: 0.9 });
  }

  /* ---------------- 한 걸음 ---------------- */

  function step(dt) {
    if (G.flash > 0) G.flash = Math.max(0, G.flash - dt);
    if (G.freeze > 0) { G.freeze -= dt; return; } // 히트스톱 — 맞는 순간 판 전체가 멈칫한다
    if (G.cut) { G.cut.t += dt; if (G.cut.t >= G.cut.max) G.cut = null; return; } // 컷인 — 끝날 때까지 멈춘다
    // 필살기 동안 바탕이 어두워진다(디지몬과 연출만 밝게)
    const hot = G.f.some((f) => f.act && (f.act.k === "special" || (f.act.k === "slashrun" && f.act.mode === "sp")));
    const busy = hot || G.fxs.some((e) => e.mode === "sp" && (e.k === "beam" || e.k === "cage" || e.k === "orb"));
    const top = Math.max(1, ...G.f.map((f) => form(f).stage));
    G.dim += ((busy ? (0.3 + 0.07 * top) * (calm ? 0.55 : 1) : 0) - G.dim) * Math.min(1, dt * 7);
    G.lines = Math.max(0, G.lines - dt * 2.2);
    for (const f of G.f) if (f.trail) f.trail = f.trail.filter((e) => (e.life -= dt) > 0);
    fxStep(dt);
    // 파편 · 숫자는 언제나 움직인다
    for (const p of G.parts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.g) p.vy += p.g * dt; }
    G.parts = G.parts.filter((p) => p.life > 0);
    for (const p of G.pops) { p.life -= dt; p.y -= 22 * dt; }
    G.pops = G.pops.filter((p) => p.life > 0);
    G.shake = Math.max(0, G.shake - dt);
    if (G.banner) { G.banner.life -= dt; if (G.banner.life <= 0) G.banner = null; }

    if (G.over) return overStep(dt);
    if (G.pre > 0) { G.pre -= dt; return; }
    if (G.cine) return cineStep(dt);

    G.t += dt;
    const [a, b] = G.f;
    for (const f of G.f) f.gauge = Math.min(100, f.gauge + BAL.fill * dt);
    const [p, q] = Math.random() < 0.5 ? [a, b] : [b, a]; // 먼저 움직이는 쪽이 늘 같으면 왼쪽이 조금 유리해진다
    tamer(p, q, dt);
    tamer(q, p, dt);
    body(p, q, dt);
    body(q, p, dt);
    shotStep(dt);

    const ko = G.f.find((f) => f.hp <= 0);
    if (ko) return void (G.over = { loser: ko, t: 0 });
    if (G.t >= LIMIT) {
      const ra = a.hp / a.max, rb = b.hp / b.max;
      G.over = { loser: Math.abs(ra - rb) < 0.02 ? null : ra < rb ? a : b, t: 0, time: true };
    }
  }

  function body(f, o, dt) {
    if (!f.act || (f.act.k !== "slashrun")) f.dir = o.x > f.x ? 1 : -1;
    f.guard = Math.max(0, f.guard - dt);
    f.rally = Math.max(0, f.rally - dt);
    f.flash = Math.max(0, f.flash - dt);
    f.glitch = Math.max(0, f.glitch - dt);
    f.off = 0;
    if (f.kb) {
      f.x += f.kb * dt;
      f.kb *= Math.pow(0.004, dt);
      if (Math.abs(f.kb) < 6) f.kb = 0;
    }
    if (f.z > 0 || f.vz) {
      f.vz -= 520 * dt;
      f.z += f.vz * dt;
      if (f.z <= 0) {
        const v = f.vz;
        f.z = 0;
        f.vz = 0;
        if (v < -230) slam(f, v); // 내리꽂혔다 — 땅에 튕긴다
      }
    }
    f.x = Math.max(18, Math.min(W - 18, f.x));
    // 벽에 처박혔다 — 튕겨 나온다
    const wall = f.x <= 18 ? -1 : f.x >= W - 18 ? 1 : 0;
    if (wall && Math.sign(f.kb) === wall && Math.abs(f.kb) > 170) {
      f.kb = -f.kb * 0.5;
      const c = colorOf(form(o).attr), y = GROUND - f.z - sizeOf(f) * 0.45, x = wall < 0 ? 12 : W - 12;
      G.fxs.push({ k: "wall", x, y, h: sizeOf(f) * 0.8, c, t: 0, max: 0.35 });
      sparks(x, y, 12, c, 140);
      G.shake = Math.max(G.shake, 0.18);
      G.freeze = Math.max(G.freeze, 0.04);
      pop(f, "WALL!", "#ffcf5a", 6, -10);
    }
    if (f.stun > 0) { f.stun -= dt; return; }
    if (f.act) return act(f, o, dt);

    const d = Math.abs(o.x - f.x), reach = reachOf(f, o);
    const fast = f.rally > 0 ? 1.4 : 1;
    f.cd -= dt * fast;
    f.scd -= dt;
    f.tcd -= dt * fast;
    // 기술 — 그 모습의 둘째 · 셋째 기술을 게이지 없이 틈틈이 쓴다(필살기는 첫째 기술 · 게이지)
    if (f.tcd <= 0 && d < 210) {
      const list = techsOf(f), name = list[Math.floor(Math.random() * list.length)], kind = kindOf(name);
      if (kind !== "slash" || d < 170) {
        const pal = palOf(name, form(f).attr);
        f.act = { k: "tech", t: 0, kind, name: name.toUpperCase(), mode: "tech", c: pal.c, ca: pal.ca };
        f.tcd = rnd(BAL.tech[0], BAL.tech[1]);
        return;
      }
    }
    const sp = SPD[form(f).stage] * fast;
    if (d > reach) {
      // 뛰어들기 — 가운데 거리에서 높이 뛰어 내려 찍는다
      if (d < 125 && d > reach + 8 && o.z === 0 && Math.random() < dt * BAL.dive) { f.act = { k: "dive", t: 0, hit: false }; f.vz = 235; return; }
      if (f.scd <= 0 && d > 80) { f.act = { k: "shot", t: 0 }; f.scd = rnd(6, 10); return; }
      f.x += f.dir * sp * dt;
      f.walk += dt;
    } else if (f.cd <= 0) {
      f.act = { k: "lunge", t: 0, hit: false };
      f.cd = rnd(0.85, 1.35);
    } else if (Math.random() < dt * 0.45) {
      f.act = { k: "hop", t: 0 };
      f.vz = 150;
      f.kb = -f.dir * 110;
    } else if (d < reach * 0.8) {
      f.x -= f.dir * sp * 0.8 * dt; // 겹치지 않게 물러선다
    }
  }

  function act(f, o, dt) {
    const A = f.act;
    A.t += dt;
    if (A.k === "lunge") {
      // 들이받기 — 맞으면 이어친다(2타 · 3타). 3타는 띄우기, 띄우면 쫓아 뛰어올라 내려친다
      const n = A.n || 1;
      if (A.t < 0.12) f.off = -4 * (A.t / 0.12);
      else if (A.t < 0.24) {
        f.x += f.dir * 150 * dt;
        f.off = 0;
        if (!A.hit && Math.abs(o.x - f.x) < reachOf(f, o) + 10) {
          A.hit = true;
          const r = hit(f, o, n === 3 ? 0.9 : n === 2 ? 0.7 : 1, null, n === 3 ? "launch" : "combo");
          A.landed = r === "hit";
          if (n >= 2 && A.landed) pop(f, `${n} HIT!`, "#ffcf5a", 7, -14);
        }
      }
      if (A.t >= 0.34) {
        if (A.landed && n < 3 && o.act?.k !== "special" && Math.random() < BAL.combo) f.act = { k: "lunge", t: 0.1, hit: false, n: n + 1 };
        else if (A.landed && n === 3 && Math.random() < BAL.chase) { f.act = { k: "chase", t: 0, hit: false }; f.vz = 285; }
        else f.act = null;
      }
    } else if (A.k === "chase" || A.k === "dive") {
      // 공중 — 쫓아 뛰어올라(chase) 또는 뛰어들어(dive) 내려친다. 잔상이 남는다
      const chase = A.k === "chase";
      if (Math.abs(o.x - f.x) > reachOf(f, o) * 0.6) f.x += f.dir * (chase ? 230 : 175) * dt; // 겹치지 않을 만큼만 다가간다
      f.trail.push({ x: f.x, z: f.z, dir: f.dir, life: 0.2 });
      if (f.trail.length > 16) f.trail.shift();
      const near = Math.abs(o.x - f.x) < reachOf(f, o) * 0.9;
      // 쫓아가기는 상대와 같은 높이 이상으로 올라선 뒤 내려친다(밑에서 치면 어색하다)
      if (!A.hit && near && (chase ? f.z >= o.z - 6 && f.z > 24 && o.z > 4 : f.vz < 60 && o.z < 30)) {
        A.hit = true;
        hit(f, o, chase ? 0.9 : 1.1, null, chase ? "smash" : "dive");
        f.vz = chase ? 70 : Math.max(f.vz, 90); // 때린 반동 — 공중에서 잠깐 멈칫했다 내려온다
      }
      if ((A.t > 0.15 && f.z === 0) || A.t > 1.3) f.act = null;
    } else if (A.k === "shot") {
      f.glitch = 0.05;
      if (A.t >= 0.32 && !A.fired) {
        A.fired = true;
        G.shots.push({ from: f, x: f.x + f.dir * sizeOf(f) * 0.35, y: GROUND - sizeOf(f) * 0.45, vx: f.dir * 190, big: false, c: colorOf(form(f).attr), trail: [] });
      }
      if (A.t >= 0.5) f.act = null;
    } else if (A.k === "hop") {
      if (A.t > 0.12 && f.z === 0) f.act = null;
    } else if (A.k === "guard") {
      if (A.t >= 1.8) f.act = null;
    } else if (A.k === "special" || A.k === "tech") {
      // 모으기 — 몸이 글리치로 떨고, 둘레의 데이터가 손끝으로 빨려 든다. 필살기는 길게(0.8초) · 기술은 짧게(0.3초)
      const sp = A.k === "special", T = sp ? 0.8 : 0.3;
      f.glitch = 0.05;
      const S = form(f).stage, c = A.c, ca = A.ca, hp = handOf(f);
      if (sp && Math.random() < dt * (40 + 12 * S)) {
        G.parts.push({ x: f.x + rnd(-sizeOf(f) * 0.5, sizeOf(f) * 0.5), y: GROUND - rnd(0, 6), vx: 0, vy: rnd(-110, -50), life: rnd(0.4, 0.9), max: 0.9, c: Math.random() < 0.5 ? c[0] : ca[0], s: 2, code: true, under: true });
      }
      if (A.t < T * 0.9) {
        for (let n = Math.floor(dt * (sp ? 45 + 15 * S : 30) + Math.random()); n > 0; n--) {
          const a = rnd(0, Math.PI * 2), r = sp ? rnd(34, 60 + 6 * S) : rnd(18, 32), life = sp ? rnd(0.22, 0.34) : rnd(0.12, 0.2);
          const pc = S === 4 && sp && Math.random() < 0.3 ? prism(G.t, n) : [c[0], c[2], ca[0]][n % 3];
          G.parts.push({ x: hp.x + Math.cos(a) * r, y: hp.y + Math.sin(a) * r * 0.75, vx: (-Math.cos(a) * r) / life, vy: (-Math.sin(a) * r * 0.75) / life, life, max: life, c: pc, s: 2, streak: true });
        }
      }
      if (sp && A.t > 0.5) { G.lines = Math.max(G.lines, 0.5 + 0.12 * S); G.linesC = c; G.linesA = ca; }
      if (A.t >= T) {
        if (sp) { G.flash = G.flashMax = 0.08; G.flashC = c[2]; }
        launch(f, o, A);
      }
    } else if (A.k === "slashrun") {
      const before = f.x, sp = A.mode === "sp";
      f.x += f.dir * (sp ? 420 : 360) * dt;
      f.trail.push({ x: f.x, z: f.z, dir: f.dir, life: 0.28, c: A.c });
      if (f.trail.length > 16) f.trail.shift();
      G.lines = Math.max(G.lines, sp ? 0.9 : 0.45);
      G.linesC = A.c; G.linesA = A.ca;
      if (!A.hit && (before - o.x) * (f.x - o.x) <= 0) {
        A.hit = true;
        const S = form(f).stage;
        const y = GROUND - o.z - sizeOf(o) * 0.5;
        if (hit(f, o, sp ? 2.4 : BAL.techX, o.x, A.mode, A) !== "miss") {
          G.fxs.push({ k: "xslash", x: o.x, y, s: (sizeOf(o) * 0.45 + 5 * S) * (sp ? 1 : 0.7), c: A.c, ca: A.ca, S, one: !sp, t: 0, max: sp ? 0.55 : 0.35 });
          if (sp) G.fxs.push({ k: "cut", y, c: A.c, ca: A.ca, t: 0, max: 0.3 });
        }
      }
      if ((f.dir > 0 && f.x >= A.to) || (f.dir < 0 && f.x <= A.to) || f.x <= 18 || f.x >= W - 18) f.act = { k: "recover", t: 0, name: A.name, mode: A.mode, c: A.c, dur: sp ? 0.45 : 0.25 };
    } else if (A.k === "recover") {
      if (A.t >= (A.dur || 0.45)) f.act = null;
    }
  }

  /* 쏘기 — 필살기(sp)와 기술(tech)이 같은 갈래(광선 · 베기 · 결계 · 큐브)를 크기만 달리 쓴다 */
  function launch(f, o, A) {
    const sp = A.mode === "sp", S = form(f).stage, hp = handOf(f), c = A.c, ca = A.ca, mode = A.mode;
    if (A.kind === "slash") {
      f.act = { k: "slashrun", t: 0, hit: false, name: A.name, mode, c, ca, to: o.x + f.dir * (sizeOf(o) * 0.5 + 14) };
      return;
    }
    if (A.kind === "hex") {
      G.fxs.push({ k: "cage", from: f, to: o, c, ca, mode, fireAt: sp ? 0.62 : 0.42, sc: sp ? 1 : 0.72, S, t: 0, max: 9, fired: false });
    } else if (A.kind === "burst") {
      const grp = { hit: false, miss: false }, n = sp ? 3 + S : 2 + (S >= 3 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        G.fxs.push({ k: "orb", from: f, to: o, grp, mode, x: hp.x, y: hp.y, vx: f.dir * rnd(40, 170), vy: rnd(-190, -40), c: i % 2 ? ca : c, ca: i % 2 ? c : ca, t: 0, delay: i * 0.06, max: 9, trail: [], s: sp ? 4 + S : 3.5 + S * 0.7, S });
      }
    } else {
      G.fxs.push({ k: "beam", from: f, to: o, mode, x0: hp.x, y: hp.y, head: hp.x, dir: f.dir, w: sp ? 5 + 3 * S : 3 + 1.5 * S, c, ca, S, dur: sp ? 0.42 : 0.24, t: 0, max: 9, hold: -1, hit: false });
    }
    f.kb = -f.dir * (sp ? 60 : 30); // 쏘는 순간 뒤로 튄다
    f.act = { k: "recover", t: 0, name: A.name, mode, c, dur: sp ? 0.45 : 0.25 };
  }

  function shotStep(dt) {
    for (const s of G.shots) {
      s.trail.push([s.x, s.y]);
      if (s.trail.length > (s.big ? 14 : 5)) s.trail.shift();
      s.x += s.vx * dt;
      const o = G.f[1 - s.from.side];
      if (Math.abs(s.x - o.x) < sizeOf(o) * 0.25 + 2 && o.z < sizeOf(o) * 0.6) {
        s.dead = true;
        hit(s.from, o, 0.7, s.x);
      }
      if (s.x < -10 || s.x > W + 10) s.dead = true;
    }
    G.shots = G.shots.filter((s) => !s.dead);
  }

  /* 땅에 내리꽂혔다 — 먼지 · 납작한 충격파 · 튕김 */
  function slam(f, v) {
    f.vz = Math.min(160, -v * 0.38);
    const x = f.x, s = sizeOf(f);
    G.fxs.push({ k: "ring", x, y: GROUND - 2, r0: 6, r1: s * 0.9, sy: 0.22, c: "#fff6e0", w: 3, t: 0, max: 0.35 });
    for (let i = 0; i < 18; i++) G.parts.push({ x: x + rnd(-s * 0.4, s * 0.4), y: GROUND - 2, vx: rnd(-120, 120), vy: rnd(-110, -30), life: rnd(0.3, 0.6), max: 0.6, c: i % 3 ? "#c9b48a" : "#fff6e0", s: i % 4 ? 2 : 3, g: 260 });
    G.shake = Math.max(G.shake, 0.22);
    G.freeze = Math.max(G.freeze, 0.05);
  }
  const techsOf = (f) => { const sk = form(f).skills || []; return sk.length > 1 ? sk.slice(1) : sk.length ? sk : ["DATA SHOT"]; };
  const handOf = (f) => ({ x: f.x + f.dir * sizeOf(f) * 0.32, y: GROUND - f.z - sizeOf(f) * 0.5 });

  /* 필살기 연출 — 광선 · 결계 · 데이터 큐브는 맞는 순간까지 여기서 움직이고, 고리 · 폭발 · 빛기둥은 시간만 흐른다 */
  function fxStep(dt) {
    const live = !G.over && !G.cine && G.pre <= 0;
    for (const e of G.fxs) {
      e.t += dt;
      if (e.k === "beam") {
        const o = e.to;
        if (e.hold < 0) {
          e.head += e.dir * (e.mode === "sp" ? 780 : 620) * dt;
          if (e.mode === "sp") { G.lines = Math.max(G.lines, 0.8); G.linesC = e.c; G.linesA = e.ca; }
          const at = o.x - e.dir * sizeOf(o) * 0.2;
          if (!e.hit && live && (e.head - at) * e.dir >= 0 && o.z < sizeOf(o) * 0.6) {
            e.hit = true;
            if (hit(e.from, o, e.mode === "sp" ? 2.4 : BAL.techX, at, e.mode, e) !== "miss") { e.head = at; e.hold = 0; }
          }
          if (e.head < -20 || e.head > W + 20) e.hold = 0;
        } else e.hold += dt;
        if (e.hold > e.dur) e.dead = true;
      } else if (e.k === "cage") {
        if (!e.fired && e.t >= e.fireAt && live) {
          e.fired = true;
          hit(e.from, e.to, e.mode === "sp" ? 2.4 : BAL.techX, e.to.x, e.mode, e);
        }
        if (e.fired && e.t > e.fireAt + 0.4) e.dead = true;
        if (e.t > 3) e.dead = true;
      } else if (e.k === "orb") {
        if (e.t < e.delay) continue;
        const o = e.to, tx = o.x, ty = GROUND - o.z - sizeOf(o) * 0.45;
        if (!e.grp.miss) {
          const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 1;
          e.vx += (dx / d) * 1150 * dt;
          e.vy += (dy / d) * 1150 * dt;
        }
        const v = Math.hypot(e.vx, e.vy);
        if (v > 430) { e.vx *= 430 / v; e.vy *= 430 / v; }
        e.trail.push([e.x, e.y]);
        if (e.trail.length > 8) e.trail.shift();
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (!e.grp.miss && Math.hypot(tx - e.x, ty - e.y) < sizeOf(o) * 0.28) {
          e.dead = true;
          if (!e.grp.hit && !e.grp.miss && live) {
            if (hit(e.from, o, e.mode === "sp" ? 2.4 : BAL.techX, e.x, e.mode, e) === "miss") e.grp.miss = true;
            else e.grp.hit = true;
          } else if (e.grp.hit) {
            // 뒤따르는 큐브 — 피해는 첫 큐브가 다 냈다. 터지는 모양만
            G.fxs.push({ k: "ring", x: e.x, y: e.y, r0: 2, r1: 14, c: e.c[2], w: 2, t: 0, max: 0.22 });
            sparks(e.x, e.y, 8, e.c, 110);
            o.flash = 0.08;
            G.shake = Math.max(G.shake, 0.1);
          }
        }
        if (e.t > e.delay + 1.8 || e.x < -30 || e.x > W + 30 || e.y > H + 20) e.dead = true;
      } else if (e.t >= (e.delay || 0) + e.max) e.dead = true;
    }
    G.fxs = G.fxs.filter((e) => !e.dead);
  }

  /* 진화 — 판이 멈추고, 둘레로 데이터가 모이고, 모습이 번갈아 깜빡이다 바뀐다 */
  function cineStep(dt) {
    const C = G.cine, f = C.f;
    C.t += dt;
    // 공중에 떠 있던 둘은 내려앉는다(띄워진 채 진화하면 허공에 멈춰 보인다)
    for (const x of G.f) { if (x.z > 0) { x.z = Math.max(0, x.z - 260 * dt); x.vz = 0; } x.trail = []; }
    // 처음 0.4초 — 둘이 떨어진다(진화하는 모습이 가리지 않게)
    const o = G.f[1 - f.side];
    if (C.t < 0.4 && Math.abs(o.x - f.x) < 110) {
      const dir = o.x >= f.x ? 1 : -1;
      o.x = Math.max(18, Math.min(W - 18, o.x + dir * 140 * dt));
      f.x = Math.max(18, Math.min(W - 18, f.x - dir * 90 * dt));
    }
    f.glitch = 0.05;
    const c = colorOf(C.to.attr);
    if (C.t < 1.3 && Math.random() < dt * 60) {
      const a = rnd(0, Math.PI * 2), r = rnd(40, 70);
      const cx = f.x, cy = GROUND - sizeOf(f) * 0.5;
      G.parts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.7, vx: -Math.cos(a) * r * 1.6, vy: -Math.sin(a) * r * 1.1, life: 0.6, max: 0.6, c: Math.random() < 0.5 ? c[0] : c[2], s: 2 });
    }
    if (C.t >= 1.3 && !C.swapped) {
      C.swapped = true;
      const old = f.max;
      f.fi += 1;
      f.max = maxHpOf(f);
      f.hp = Math.min(f.max, f.hp + (f.max - old) + f.max * BAL.heal);
      f.flash = 0.25;
      G.shake = 0.3;
      for (let i = 0; i < 40; i++) {
        const a = rnd(0, Math.PI * 2), v = rnd(60, 200);
        G.parts.push({ x: f.x, y: GROUND - sizeOf(f) * 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.4, 0.8), max: 0.8, c: i % 2 ? c[0] : c[2], s: 3, g: 60 });
      }
      G.banner = { top: `${C.from.name} 진화 ▶`, big: C.to.name, sub: `${STAGE[C.to.stage]} · ${C.to.attr}`, c, life: 1.6, max: 1.6 };
    }
    if (C.t >= 2.1) {
      G.cine = null;
      f.cd = 0.4;
      if (f.side === 0) syncCmd();
    }
  }

  /* 끝 — 진 쪽은 데이터로 흩어진다 */
  function overStep(dt) {
    const O = G.over;
    O.t += dt;
    const L = O.loser;
    if (L) {
      L.glitch = 0.05;
      L.alpha = Math.max(0, 1 - O.t / 1.3);
      if (O.t < 1.3 && Math.random() < dt * 70) {
        const s = sizeOf(L);
        G.parts.push({ x: L.x + rnd(-s * 0.35, s * 0.35), y: GROUND - L.z - rnd(0, s * 0.8), vx: rnd(-10, 10), vy: rnd(-70, -30), life: rnd(0.6, 1.1), max: 1.1, c: colorOf(form(L).attr)[Math.random() < 0.5 ? 0 : 2], s: 2 });
      }
    }
    if (O.t >= 1.9 && !O.shown) {
      O.shown = true;
      finish();
    }
  }

  async function finish() {
    const O = G.over;
    const [a] = G.f;
    const result = O.loser == null ? "draw" : O.loser === a ? "lose" : "win";
    const winner = O.loser == null ? null : G.f[1 - O.loser.side];
    const me = G.me.id;
    const r = await window.ptb.fieldEnd({ a: me, result }).catch(() => null);
    if (!G) return;
    const rec = r && r.record;
    const head = result === "win" ? "WIN" : result === "lose" ? "LOSE" : "DRAW";
    const line = winner ? `${esc(form(winner).name)}의 승리!` : "무승부";
    $("fbOver").className = `fb-over on ${result}`;
    $("fbOver").innerHTML = `<div class="fb-res">
      <b>${head}</b>
      <span>${line}${O.time ? " <small>(시간 끝 — 남은 체력)</small>" : ""}</span>
      ${rec ? `<small>${esc(G.f[0].forms[G.f[0].forms.length - 1].name)} 전적 ${rec.w || 0}승 ${rec.l || 0}패</small>` : ""}
      <div class="fb-res-btns"><button class="fb-again">⚔️ 한 판 더</button><button class="fb-quit">닫기</button></div>
    </div>`;
    $("fbOver").querySelector(".fb-again").onclick = () => { G.done = true; start(); };
    $("fbOver").querySelector(".fb-quit").onclick = stop;
    G.done = true;
    renderPick();
  }

  /* ---------------- 그리기 ---------------- */

  let k = 1; // 그림 좌표 1 → 캔버스 픽셀
  let kc = 1; // 그림 좌표 1 → 화면(CSS) 픽셀
  /** 글씨 크기 — 그림 좌표 n 이되, 화면에서 min px 보다 작아지지 않게(팝오버 기본 폭 400px 이면 판이 1.1배밖에 안 커진다) */
  const px = (n, min) => Math.max(n, min / kc);
  function fit() {
    const ar = $("fbArena");
    const w = ar.clientWidth, h = ar.clientHeight;
    if (!w) return;
    const dpr = window.devicePixelRatio || 1;
    for (const id of ["fbUnder", "fbFx"]) {
      const c = $(id);
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    }
    k = $("fbFx").width / W;
    kc = w / W;
    if (!bgDone && window.ptbRoom && window.ptbRoom.paintField) {
      const bg = $("fbBg");
      bg.getContext("2d").drawImage(window.ptbRoom.paintField(), 0, 0);
      bgDone = true;
    }
  }

  function draw() {
    fit();
    const sk = calm ? 0.3 : 1;
    const sx = G.shake > 0 ? rnd(-2, 2) * sk : 0, sy = G.shake > 0 ? rnd(-1.5, 1.5) * sk : 0;
    $("fbArena").style.setProperty("--sx", `${(sx / W) * 100}%`);
    $("fbArena").style.setProperty("--sy", `${(sy / H) * 100}%`);
    const u = $("fbUnder").getContext("2d"), g = $("fbFx").getContext("2d");
    u.setTransform(1, 0, 0, 1, 0, 0); u.clearRect(0, 0, u.canvas.width, u.canvas.height);
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    u.setTransform(k, 0, 0, k, sx * k, sy * k);
    g.setTransform(k, 0, 0, k, sx * k, sy * k);
    u.imageSmoothingEnabled = g.imageSmoothingEnabled = false;

    // 필살기 — 바탕을 어둡게, 속도선
    if (G.dim > 0.01) {
      u.fillStyle = `rgba(3, 6, 16, ${G.dim.toFixed(3)})`;
      u.fillRect(-10, -10, W + 20, H + 20);
    }
    if (G.lines > 0.02 && G.linesC) {
      for (let i = 0; i < 16; i++) {
        u.globalAlpha = G.lines * rnd(0.12, 0.42) * (calm ? 0.35 : 1);
        u.fillStyle = i % 3 === 0 ? G.linesC[2] : i % 3 === 1 ? G.linesC[0] : (G.linesA || G.linesC)[0];
        u.fillRect(Math.round(rnd(-60, W)), Math.round(rnd(14, GROUND + 6)), Math.round(rnd(30, 120)), i % 5 ? 1 : 2);
      }
      u.globalAlpha = 1;
    }
    for (const f of G.f) {
      if (!f.act || f.act.k !== "special") continue;
      // 발밑이 빛난다
      const p = Math.min(1, f.act.t / 0.8), c = f.act.c || colorOf(form(f).attr), s = sizeOf(f);
      u.globalCompositeOperation = "lighter";
      u.globalAlpha = 0.5 * p;
      u.fillStyle = c[1];
      u.fillRect(Math.round(f.x - s * 0.55), GROUND - 4, Math.round(s * 1.1), 5);
      u.fillStyle = c[0];
      u.fillRect(Math.round(f.x - s * 0.35), GROUND - 3, Math.round(s * 0.7), 3);
      if (form(f).stage >= 3) { u.globalAlpha = 0.16 * p; u.fillRect(Math.round(f.x - s * 0.3), 0, Math.round(s * 0.6), GROUND); }
      u.globalAlpha = 1;
      u.globalCompositeOperation = "source-over";
    }
    // 그림자 · 등 뒤 디지코드
    for (const f of G.f) {
      const s = sizeOf(f);
      u.globalAlpha = 0.28 * f.alpha;
      u.fillStyle = "#0b2a12";
      u.beginPath();
      u.ellipse(f.x, GROUND - 2, s * 0.3 * (1 - Math.min(0.5, f.z / 80)), 3, 0, 0, Math.PI * 2);
      u.fill();
      u.globalAlpha = 1;
    }
    for (const p of G.parts) if (p.under) drawPart(u, p);

    // 디지몬
    for (const f of G.f) placeSprite(f);

    // 모으기 · 광선 · 결계 · 베기 · 폭발
    for (const f of G.f) if (f.act && (f.act.k === "special" || f.act.k === "tech")) drawCharge(g, f);
    for (const e of G.fxs) drawFx(g, e);
    // 탄
    for (const s of G.shots) drawShot(g, s);
    for (const p of G.parts) if (!p.under) drawPart(g, p);
    // 번쩍
    if (G.flash > 0 && !calm) {
      g.globalAlpha = Math.min(1, G.flash / G.flashMax) * 0.6;
      g.fillStyle = G.flashC;
      g.fillRect(-10, -10, W + 20, H + 20);
      g.globalAlpha = 1;
    }
    // 숫자
    g.textAlign = "center";
    for (const p of G.pops) {
      g.globalAlpha = Math.min(1, p.life * 2.5);
      const fz = px(p.s, p.s >= 13 ? 16 : p.s >= 11 ? 13.5 : p.s >= 8 ? 11.5 : 10.5);
      g.font = `900 ${fz}px "Consolas", "D2Coding", monospace`;
      g.lineWidth = Math.max(2, fz * 0.24);
      g.strokeStyle = "#0a1020";
      g.strokeText(p.text, p.x, p.y);
      g.fillStyle = p.c;
      g.fillText(p.text, p.x, p.y);
    }
    g.globalAlpha = 1;
    // 필살기 이름 — 머리 위 터미널 창
    for (const f of G.f) {
      const A = f.act;
      if (!A || !(A.k === "special" || A.k === "tech" || A.k === "slashrun" || A.k === "recover") || !A.name) continue;
      const sp = A.mode === "sp";
      const t = A.k === "special" ? A.t / 0.5 : A.k === "tech" ? A.t / 0.2 : 1;
      const n = Math.max(1, Math.floor(t * A.name.length));
      const mark = sp ? "▶ " : "› ";
      const txt = mark + A.name.slice(0, n);
      const fz = sp ? px(6, 11) : px(5, 10);
      g.font = `700 ${fz}px "Consolas", monospace`;
      const pad = fz * 0.5;
      const w = Math.min(W - 8, g.measureText(mark + A.name).width + pad * 2);
      const x = Math.max(4, Math.min(W - w - 4, f.x - w / 2)), y = Math.max(fz + 52, GROUND - f.z - sizeOf(f) - 4); // HUD 아래로
      const top = y - fz - pad * 0.6, hh = fz + pad * 1.2;
      g.fillStyle = "rgba(4, 16, 22, .88)";
      g.fillRect(x, top, w, hh);
      const bc = A.c || colorOf(form(f).attr);
      g.fillStyle = bc[0];
      g.fillRect(x, top, w, 1);
      if (A.ca) { g.fillStyle = A.ca[0]; g.fillRect(x, top + hh - 1, w, 1); }
      g.fillStyle = sp ? bc[0] : bc[2];
      g.textAlign = "left";
      g.fillText(txt, x + pad, y - pad * 0.1, w - pad * 2);
      g.textAlign = "center";
    }
    hud(g);
    drawCut();
  }

  /* 컷인 — 비스듬한 띠가 열리고, 쓰는 쪽에서 얼굴이 미끄러져 들어오고, 이름이 반대쪽에서 들어온다 */
  function drawCut() {
    const el = $("fbCut");
    if (!el) return;
    const C = G && G.cut;
    if (!C) { if (el.style.display !== "none") el.style.display = "none"; return; }
    if (el.style.display === "none" || el.dataset.id !== String(C.f.side) + C.name) {
      el.dataset.id = String(C.f.side) + C.name;
      el.style.display = "";
      const img = el.querySelector("img");
      if (C.url && img.getAttribute("src") !== C.url) img.src = C.url;
      el.querySelector("b").textContent = C.name;
      el.querySelector("small").textContent = `${form(C.f).name} · ${STAGE[C.stage]}`;
      el.classList.toggle("right", C.side === 1);
      el.classList.toggle("ult", C.stage >= 4);
      el.classList.toggle("calm", calm);
      el.style.setProperty("--c0", C.c[0]);
      el.style.setProperty("--c1", C.c[1]);
      el.style.setProperty("--c2", C.c[2]);
      el.style.setProperty("--a0", C.ca[0]);
      el.style.setProperty("--a1", C.ca[1]);
    }
    const t = C.t, m = C.max;
    const open = Math.min(1, t / 0.09), close = Math.max(0, (t - (m - 0.1)) / 0.1);
    const band = el.querySelector(".band");
    band.style.transform = `translateY(-50%) skewY(-7deg) scaleY(${(open * (1 - close)).toFixed(3)})`;
    const dir = C.side === 1 ? -1 : 1; // 왼쪽 디지몬은 왼쪽에서 들어온다
    const inP = 1 - Math.pow(1 - Math.min(1, t / 0.16), 3);
    const img = el.querySelector("img");
    img.style.transform = `translateX(${(dir * (-60 + 60 * inP + t * 10)).toFixed(1)}%) scaleX(${C.side === 1 ? 1 : -1})`;
    const nm = el.querySelector(".nm");
    nm.style.transform = `translateX(${(-dir * (40 - 40 * inP + t * 6)).toFixed(1)}%)`;
    nm.style.opacity = String(Math.min(1, t / 0.12) * (1 - close));
    img.style.opacity = String(1 - close);
  }

  function placeSprite(f) {
    const s = sizeOf(f);
    let show = f.fi;
    if (G.cine && G.cine.f === f && !G.cine.swapped && G.cine.t > 0.35) show = Math.floor(G.cine.t * (6 + G.cine.t * 14)) % 2 ? f.fi + 1 : f.fi;
    const ss = show === f.fi ? s : SIZE[f.forms[show].stage];
    const bob = f.act ? 0 : Math.abs(Math.sin(f.walk * 10)) * 1.5;
    f.imgs.forEach((im, i) => {
      if (i !== show) { if (im.style.display !== "none") im.style.display = "none"; return; }
      im.style.display = "";
      const x = f.x + f.off * f.dir - ss / 2;
      const y = GROUND - ss - f.z - bob;
      im.style.left = `${(x / W) * 100}%`;
      im.style.top = `${(y / H) * 100}%`;
      im.style.width = `${(ss / W) * 100}%`;
      im.style.transform = `scaleX(${f.dir > 0 ? -1 : 1})`;
      im.style.opacity = String(f.alpha);
      const c = colorOf(f.forms[show].attr);
      const fl = [];
      if (f.flash > 0) fl.push(calm ? "brightness(1.35)" : "brightness(2.4)");
      if (f.glitch > 0 && Math.random() < 0.6) fl.push(`drop-shadow(${rnd(1, 3).toFixed(1)}px 0 ${c[1]}) drop-shadow(${(-rnd(1, 3)).toFixed(1)}px 0 ${c[0]})`);
      if (f.guard > 0) fl.push(`drop-shadow(0 0 3px ${c[0]})`);
      if (f.rally > 0) fl.push("drop-shadow(0 0 2px #ffcf5a)");
      // 필살기로 바탕이 어두우면 얇은 밝은 테 — 검은 도트 디지몬(마메몬 · 베타몬 …)이 묻히지 않게
      if (G.dim > 0.12) { const a = Math.min(0.85, G.dim * 1.6).toFixed(2); fl.push(`drop-shadow(1px 0 0 rgba(255,255,255,${a})) drop-shadow(-1px 0 0 rgba(255,255,255,${a})) drop-shadow(0 1px 0 rgba(255,255,255,${a}))`); }
      if (f.act && (f.act.k === "special" || f.act.k === "tech")) {
        const sp = f.act.k === "special", p = Math.min(1, f.act.t / (sp ? 0.8 : 0.3)), ac = f.act.c || c;
        fl.push(`brightness(${(1 + p * (sp ? 0.5 : 0.25)).toFixed(2)}) drop-shadow(0 0 ${(1 + p * (sp ? 4 : 2)).toFixed(1)}px ${ac[0]})`);
      }
      im.style.filter = fl.join(" ");
      im.style.zIndex = String(f.side === 0 ? 2 : 1);
    });
    // 잔상 — 지나온 자리에 옅게(베며 달려들 때)
    const tr = f.trail || [];
    // 컷인 동안엔 판의 잔상도 멈춘 채 그대로
    (f.ghosts || []).forEach((im, i) => {
      const e = tr[tr.length - 1 - (i + 1) * 3];
      if (!e || f.alpha < 1) { if (im.style.display !== "none") im.style.display = "none"; return; }
      const src = f.imgs[f.fi] && f.imgs[f.fi].src;
      if (src && im.src !== src) im.src = src;
      im.style.display = "";
      im.style.left = `${((e.x - s / 2) / W) * 100}%`;
      im.style.top = `${((GROUND - s - e.z) / H) * 100}%`;
      im.style.width = `${(s / W) * 100}%`;
      im.style.transform = `scaleX(${e.dir > 0 ? -1 : 1})`;
      im.style.opacity = String(((e.life / 0.28) * (0.55 - i * 0.12)).toFixed(2));
      im.style.filter = `brightness(1.9) saturate(0.4) drop-shadow(0 0 2px ${(e.c || colorOf(form(f).attr))[i % 2 ? 2 : 0]})`;
      im.style.zIndex = "0";
    });
  }

  function drawPart(g, p) {
    g.globalAlpha = Math.max(0, Math.min(1, p.life / p.max * 1.4));
    g.fillStyle = p.c;
    if (p.code) {
      // 디지코드 한 글자 — 3×5 안의 무작위 점
      const x = Math.round(p.x), y = Math.round(p.y);
      for (let i = 0; i < 5; i++) if ((i * 7 + Math.round(p.y)) % 3) g.fillRect(x + (i % 2), y + i, 1 + (i % 3 === 0), 1);
    } else if (p.streak) {
      // 빠르게 나는 조각 — 지나온 쪽으로 꼬리
      for (let i = 0; i < 4; i++) {
        g.globalAlpha = Math.max(0, Math.min(1, (p.life / p.max) * 1.4)) * (1 - i * 0.25);
        g.fillRect(Math.round(p.x - p.vx * 0.01 * i), Math.round(p.y - p.vy * 0.01 * i), p.s, p.s);
      }
    } else {
      g.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
    }
    g.globalAlpha = 1;
  }

  function drawShot(g, s) {
    const [c0, c1, c2] = s.c;
    s.trail.forEach(([x, y], i) => {
      const a = (i + 1) / s.trail.length;
      g.globalAlpha = a * 0.8;
      g.fillStyle = i % 2 ? c1 : c0;
      g.fillRect(Math.round(x - 1), Math.round(y - 1), 2, 2);
    });
    g.globalAlpha = 1;
    const w = 4;
    g.fillStyle = c0;
    g.fillRect(Math.round(s.x - w / 2), Math.round(s.y - w / 2), w, w);
    g.fillStyle = c2;
    g.fillRect(Math.round(s.x - w / 4), Math.round(s.y - w / 4), Math.ceil(w / 2), Math.ceil(w / 2));
  }

  /* ---- 필살기 연출 그리기 — 픽셀 · 직선 · 마름모(둥근 것은 없다). 빛은 "lighter" 로 더한다 ---- */

  const ease = (p) => 1 - Math.pow(1 - p, 3);
  function diamond(g, x, y, r) {
    g.beginPath();
    g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y);
    g.closePath();
  }
  function poly(g, x, y, r, n, rot, sy = 1) {
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = rot + (Math.PI * 2 * i) / n;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * sy;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath();
  }
  const glow = (g, on) => { g.globalCompositeOperation = on ? "lighter" : "source-over"; };

  /* 모으기 — 손끝에 마름모 빛이 자라고, 몸 둘레로 데이터 고리가 돈다 */
  function drawCharge(g, f) {
    const A = f.act, sp = A.k === "special", p = Math.min(1, A.t / (sp ? 0.8 : 0.3)), S = form(f).stage;
    const [c0, c1, c2] = A.c || colorOf(form(f).attr), ca = A.ca || [c0, c1, c2];
    const h = handOf(f), s = sizeOf(f);
    glow(g, true);
    // 데이터 고리 — 줄어들며 빨라진다(필살기만). 두 색이 번갈아, 궁극체는 무지개
    const n = sp ? 8 + S * 2 : 0, R = s * 0.62 * (1 - p * 0.45) + 6;
    for (let i = 0; i < n; i++) {
      const a = A.t * (5 + p * 9) + (i * Math.PI * 2) / n;
      const x = f.x + Math.cos(a) * R, y = GROUND - f.z - s * 0.45 + Math.sin(a) * R * 0.38;
      g.globalAlpha = 0.5 + 0.5 * p;
      g.fillStyle = S >= 4 && i % 3 === 0 ? prism(A.t, i) : i % 2 ? c0 : ca[0];
      g.fillRect(Math.round(x), Math.round(y), i % 3 ? 2 : 3, i % 3 ? 2 : 3);
    }
    // 손끝 빛 — 세 겹 마름모가 맥박친다
    const r = (sp ? 3 + p * (7 + 3 * S) : 2 + p * (3 + S)) * (1 + Math.sin(A.t * 42) * 0.12);
    g.globalAlpha = 0.4; g.fillStyle = ca[1]; diamond(g, h.x, h.y, r * 1.9); g.fill();
    g.globalAlpha = 0.85; g.fillStyle = c0; diamond(g, h.x, h.y, r * 1.15); g.fill();
    g.globalAlpha = 1; g.fillStyle = c2; diamond(g, h.x, h.y, r * 0.6); g.fill();
    // 다 모이면 가로로 빛줄기
    if (sp && p > 0.55) {
      const q = (p - 0.55) / 0.45, L = (30 + 14 * S) * q;
      g.globalAlpha = 0.9 * q; g.fillStyle = c2;
      g.fillRect(Math.round(h.x - L), Math.round(h.y), Math.round(L * 2), 1);
      g.globalAlpha = 0.6 * q; g.fillStyle = ca[0];
      g.fillRect(Math.round(h.x - 1), Math.round(h.y - L * 0.4), 1, Math.round(L * 0.8));
    }
    g.globalAlpha = 1;
    glow(g, false);
  }

  function drawFx(g, e) {
    const p = (e.t - (e.delay || 0)) / e.max;
    if (p < 0) return;
    const [c0, c1, c2] = Array.isArray(e.c) ? e.c : [e.c, e.c, e.c];
    const ca = e.ca || [c0, c1, c2];
    glow(g, true);
    if (e.k === "beam") {
      // 광선 — 바깥 번짐 · 몸통 · 하얀 심, 마디마다 떨리고 나선 조각이 흐른다
      const fade = e.hold < 0 ? 1 : Math.max(0, 1 - e.hold / e.dur);
      const intro = Math.min(1, e.t / 0.06);
      const w = e.w * fade * intro * (1 + Math.sin(e.t * 60) * 0.1);
      const a = Math.min(e.x0, e.head), b = Math.max(e.x0, e.head);
      for (let x = a; x < b; x += 3) {
        const wob = Math.sin(x * 0.21 + e.t * 55) * w * 0.12;
        g.globalAlpha = 0.34 * fade; g.fillStyle = e.S >= 4 && e.mode === "sp" ? prism(e.t + x / 400) : ca[1];
        g.fillRect(Math.round(x), Math.round(e.y - w * 0.85 + wob), 3, Math.round(w * 1.7));
        g.globalAlpha = 0.95 * fade; g.fillStyle = c0;
        g.fillRect(Math.round(x), Math.round(e.y - w * 0.42 + wob), 3, Math.max(1, Math.round(w * 0.84)));
        g.globalAlpha = fade; g.fillStyle = c2;
        g.fillRect(Math.round(x), Math.round(e.y - w * 0.16 + wob * 0.5), 3, Math.max(1, Math.round(w * 0.32)));
      }
      // 나선 조각
      const len = b - a;
      for (let i = 0; len > 6 && i < len / 9; i++) {
        const d = (i * 9 + e.t * 520) % len;
        const x = e.dir > 0 ? a + d : b - d;
        const y = e.y + Math.sin(i * 1.7 + e.t * 34) * w * 0.85;
        g.globalAlpha = 0.9 * fade; g.fillStyle = i % 3 === 0 ? c2 : i % 3 === 1 ? ca[0] : c0;
        g.fillRect(Math.round(x), Math.round(y), 2, 2);
      }
      // 총구 · 머리
      g.globalAlpha = fade; g.fillStyle = c2;
      diamond(g, e.x0, e.y, w * (1.1 + Math.sin(e.t * 50) * 0.2)); g.fill();
      if (e.hold < 0) {
        g.globalAlpha = 0.6; g.fillStyle = ca[0]; diamond(g, e.head, e.y, w * 1.4); g.fill();
        g.globalAlpha = 1; g.fillStyle = c2; diamond(g, e.head, e.y, w * 0.8); g.fill();
      }
    } else if (e.k === "ring") {
      // 충격파 — 팔각 테가 퍼지며 얇아진다
      const r = e.r0 + (e.r1 - e.r0) * ease(p);
      g.lineWidth = Math.max(0.5, e.w * (1 - p));
      if (e.prism) {
        for (let i = 0; i < 3; i++) {
          g.globalAlpha = (1 - p) * 0.9;
          g.strokeStyle = prism(e.t, i * 40);
          poly(g, e.x, e.y, r * (1 - i * 0.12), 8, Math.PI / 8 + i * 0.2, 0.8); g.stroke();
        }
      } else {
        g.globalAlpha = 1 - p;
        g.strokeStyle = c0;
        poly(g, e.x, e.y, r, 8, Math.PI / 8, e.sy || 0.8); g.stroke();
      }
    } else if (e.k === "boom") {
      // 폭발 — 하얀 심 · 겹 마름모 · 십자 빛살
      const q = ease(p);
      g.globalAlpha = 1 - p; g.fillStyle = c2;
      diamond(g, e.x, e.y, e.s * (0.5 + q * 0.6) * (1 - p * 0.6)); g.fill();
      g.globalAlpha = (1 - p) * 0.7; g.fillStyle = ca[0];
      g.fillRect(Math.round(e.x - e.s * 0.6 * (1 - p)), Math.round(e.y - e.s * 0.6 * (1 - p)), Math.round(e.s * 1.2 * (1 - p)), Math.round(e.s * 1.2 * (1 - p)));
      g.strokeStyle = c0; g.lineWidth = 2 * (1 - p) + 0.5; g.globalAlpha = 1 - p;
      diamond(g, e.x, e.y, e.s * (0.6 + q * 1.3)); g.stroke();
      const L = e.s * (2.6 - p * 1.4), T = Math.max(1, 3 * (1 - p));
      g.fillStyle = c2; g.globalAlpha = 1 - p;
      g.fillRect(Math.round(e.x - L), Math.round(e.y - T / 2), Math.round(L * 2), Math.round(T));
      g.fillRect(Math.round(e.x - T / 2), Math.round(e.y - L * 0.8), Math.round(T), Math.round(L * 1.6));
    } else if (e.k === "wall") {
      // 벽 — 세로로 번쩍
      const w = 4 * (1 - p) + 1;
      g.globalAlpha = 1 - p; g.fillStyle = c2;
      g.fillRect(Math.round(e.x - w / 2), Math.round(e.y - e.h / 2), Math.ceil(w), Math.round(e.h));
      g.globalAlpha = 0.6 * (1 - p); g.fillStyle = c0;
      g.fillRect(Math.round(e.x - w * 1.5), Math.round(e.y - e.h * 0.35), Math.ceil(w * 3), Math.round(e.h * 0.7));
    } else if (e.k === "pillar") {
      // 빛기둥 — 맞은 자리에서 하늘까지
      const w = e.w * (1 - ease(p)) + 1;
      g.globalAlpha = 0.45 * (1 - p); g.fillStyle = e.prism ? prism(e.t) : ca[1];
      g.fillRect(Math.round(e.x - w), 0, Math.round(w * 2), GROUND);
      g.globalAlpha = 0.9 * (1 - p); g.fillStyle = c0;
      g.fillRect(Math.round(e.x - w * 0.5), 0, Math.round(w), GROUND);
      g.globalAlpha = 1 - p; g.fillStyle = c2;
      g.fillRect(Math.round(e.x - w * 0.18), 0, Math.max(1, Math.round(w * 0.36)), GROUND);
      for (let i = 0; i < 6; i++) {
        g.fillRect(Math.round(e.x + rnd(-w, w)), Math.round(GROUND - ((e.t * 300 + i * 37) % GROUND)), 2, 4);
      }
    } else if (e.k === "xslash") {
      // X 베기 — 가운데서 뻗고, 잠깐 뒤 두 쪽으로 갈라진다
      const grow = Math.min(1, e.t / 0.07), sp = p > 0.3 ? (p - 0.3) * 14 : 0;
      const L = e.s * grow, a = Math.max(0, 1 - p * p);
      for (const [sx, sy, lc] of (e.one ? [[1, 0.85, c0]] : [[1, 0.85, c0], [-1, 0.85, ca[0]]])) {
        const nx = -sy, ny = sx; // 갈라지는 방향(선에 수직)
        for (const side of [-1, 1]) {
          const ox = side * nx * sp * 0.5, oy = side * ny * sp * 0.5;
          g.lineCap = "butt";
          g.globalAlpha = 0.5 * a; g.strokeStyle = lc; g.lineWidth = (3 + e.S) * (1 - p) + 2;
          g.beginPath(); g.moveTo(e.x - sx * L + ox, e.y - sy * L + oy); g.lineTo(e.x + sx * L + ox, e.y + sy * L + oy); g.stroke();
          g.globalAlpha = a; g.strokeStyle = c2; g.lineWidth = Math.max(0.7, (1.4 + e.S * 0.4) * (1 - p));
          g.beginPath(); g.moveTo(e.x - sx * L * 1.1 + ox, e.y - sy * L * 1.1 + oy); g.lineTo(e.x + sx * L * 1.1 + ox, e.y + sy * L * 1.1 + oy); g.stroke();
          if (!sp) break; // 갈라지기 전엔 한 줄
        }
      }
    } else if (e.k === "cut") {
      // 화면을 가로지르는 한 줄
      g.globalAlpha = 0.5 * (1 - p); g.fillStyle = c0;
      g.fillRect(0, Math.round(e.y - 3 * (1 - p)), W, Math.max(1, Math.round(6 * (1 - p))));
      g.globalAlpha = 0.6 * (1 - p); g.fillStyle = ca[0];
      g.fillRect(0, Math.round(e.y + 3 * (1 - p)), W, 1);
      g.fillRect(0, Math.round(e.y - 4 * (1 - p)), W, 1);
      g.globalAlpha = 1 - p; g.fillStyle = c2;
      g.fillRect(0, Math.round(e.y), W, 1);
    } else if (e.k === "cage") {
      // 결계 — 세 겹 육각이 돌며 조여 들고, 안에 디지코드가 쏟아진다. 닫히면 한 점으로 줄었다 터진다
      const o = e.to, cx = o.x, cy = GROUND - o.z - sizeOf(o) * 0.45, R = sizeOf(o) * 0.62 * e.sc;
      const t = e.t, F = e.fireAt, C = F - 0.12; // 조이기 끝 → 한 점으로
      if (!e.fired) {
        let r = R * (1.7 - Math.min(1, t / C) * 0.7);
        if (t > C) r *= Math.max(0.15, 1 - ((t - C) / 0.12) * 0.85);
        const rings = [[1, t * 2.4, c0, 2], [0.74, -t * 3.4, ca[0], 1.5], [0.5, t * 5.2, e.S >= 4 && e.mode === "sp" ? prism(t) : c2, 1]];
        for (const [k, rot, col, lw] of rings) {
          g.globalAlpha = 0.18; g.fillStyle = k === 1 ? c1 : ca[1]; poly(g, cx, cy, r * k, 6, rot); g.fill();
          g.globalAlpha = 0.95; g.strokeStyle = col; g.lineWidth = lw; poly(g, cx, cy, r * k, 6, rot); g.stroke();
        }
        // 꼭짓점마다 빛점
        for (let i = 0; i < 6; i++) {
          const a = t * 2.4 + (i * Math.PI) / 3;
          g.globalAlpha = 1; g.fillStyle = c2;
          g.fillRect(Math.round(cx + Math.cos(a) * r - 1.5), Math.round(cy + Math.sin(a) * r - 1.5), 3, 3);
        }
        // 안쪽 디지코드 비
        for (let i = 0; i < 10; i++) {
          g.fillStyle = i % 2 ? c0 : ca[0];
          g.globalAlpha = rnd(0.3, 0.9);
          g.fillRect(Math.round(cx + rnd(-r * 0.6, r * 0.6)), Math.round(cy + rnd(-r * 0.6, r * 0.6)), 1, Math.round(rnd(2, 5)));
        }
      } else {
        // 터진 뒤 — 육각 조각이 밖으로
        const q = Math.min(1, (t - F) / 0.4);
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3 + 0.5, d = R * (0.3 + ease(q) * 1.6);
          g.globalAlpha = 1 - q; g.strokeStyle = i % 3 === 0 ? c0 : i % 3 === 1 ? ca[0] : c2; g.lineWidth = 1.5;
          poly(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, 5 * (1 - q * 0.5), 6, q * 4); g.stroke();
        }
      }
    } else if (e.k === "orb") {
      // 데이터 큐브 — 돌면서 날아가고 꼬리를 남긴다
      if (e.t < e.delay) { glow(g, false); return; }
      e.trail.forEach(([x, y], i) => {
        const a = (i + 1) / e.trail.length;
        g.globalAlpha = a * 0.7; g.fillStyle = i % 2 ? ca[0] : c0;
        const w = 1 + a * e.s * 0.6;
        g.fillRect(Math.round(x - w / 2), Math.round(y - w / 2), Math.ceil(w), Math.ceil(w));
      });
      const r = e.s * (1 + Math.sin(e.t * 40) * 0.15);
      g.globalAlpha = 0.45; g.fillStyle = c1; diamond(g, e.x, e.y, r * 1.6); g.fill();
      g.globalAlpha = 1; g.fillStyle = c0;
      g.save(); g.translate(e.x, e.y); g.rotate(e.t * 12); g.fillRect(-r / 2, -r / 2, r, r); g.restore();
      g.fillStyle = c2; g.fillRect(Math.round(e.x - r / 4), Math.round(e.y - r / 4), Math.ceil(r / 2), Math.ceil(r / 2));
    } else if (e.k === "shield") {
      // 막아! — 앞에 육각 방패가 서고 금이 간다
      const f = e.f, s = sizeOf(f), dir = f.dir;
      const x = f.x + dir * s * 0.36, y = GROUND - f.z - s * 0.45, h = s * 0.42;
      const a = 1 - p;
      g.save(); g.translate(x, y); g.scale(0.38, 1);
      g.globalAlpha = 0.35 * a; g.fillStyle = c0; poly(g, 0, 0, h, 6, Math.PI / 2); g.fill();
      g.globalAlpha = a; g.strokeStyle = c2; g.lineWidth = 2; poly(g, 0, 0, h, 6, Math.PI / 2); g.stroke();
      g.restore();
      if (p > 0.15) {
        g.globalAlpha = a; g.fillStyle = c2;
        for (let i = 0; i < 6; i++) g.fillRect(Math.round(x + (i % 2 ? 1 : -1) * (i % 3)), Math.round(y - h * 0.6 + i * h * 0.22), 1, Math.round(h * 0.2));
      }
    }
    g.globalAlpha = 1;
    glow(g, false);
  }

  function bar(g, x, y, w, h, ratio, c, back = "rgba(0,0,0,.55)") {
    g.fillStyle = back;
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = c;
    g.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, ratio))), h);
  }

  function hud(g) {
    g.setTransform(k, 0, 0, k, 0, 0); // 흔들리지 않게
    const panel = (f, right) => {
      const fm = form(f);
      const w = 128, x = right ? W - w - 5 : 5, y = 5;
      const fn = px(9, 11.5), fs = px(6.5, 9.5), hb = px(3, 4), gb = px(1, 2);
      const yn = y + 1.5 + fn, ys = yn + 1.5 + fs, yh = ys + 2.5, yg = yh + hb + 1.5, ph = yg + gb + 2 - y;
      g.fillStyle = "rgba(6, 18, 28, .78)";
      g.fillRect(x, y, w, ph);
      g.fillStyle = colorOf(fm.attr)[0];
      g.fillRect(x, y, w, 1);
      g.textAlign = right ? "right" : "left";
      const tx = right ? x + w - 4 : x + 4;
      g.font = `800 ${fn}px "Pretendard", "Malgun Gothic", sans-serif`;
      g.fillStyle = "#ffffff";
      const tag = f.side ? (G.foe.wild ? "야생 " : "") : "";
      g.fillText(`${tag}${fm.name}`, tx, yn, w - 8);
      g.font = `700 ${fs}px "Pretendard", "Malgun Gothic", sans-serif`;
      g.fillStyle = "#9fb3c8";
      g.fillText(`Lv.${f.lv} · ${STAGE[fm.stage]} · ${fm.attr}`, tx, ys, w - 8);
      const r = f.hp / f.max;
      bar(g, x + 4, yh, w - 8, hb, r, r > 0.5 ? "#3dffb4" : r > 0.2 ? "#ffcf5a" : "#ff5a6a");
      // 게이지는 가늘게 — 상대가 언제 진화할지 보인다
      bar(g, x + 4, yg, w - 8, gb, f.gauge / 100, f.gauge >= 100 ? "#ffffff" : "#b45cff", "rgba(0,0,0,.35)");
      // 진화 단계 점 — 몇 번 더 진화할 수 있나
      g.textAlign = "left";
      const ds = px(4, 4.5);
      for (let i = 0; i < f.forms.length; i++) {
        g.fillStyle = i <= f.fi ? colorOf(f.forms[i].attr)[0] : "rgba(255,255,255,.22)";
        const dx = right ? x + w - (f.forms.length - i) * (ds + 2) : x + 2 + i * (ds + 2);
        g.fillRect(dx, y + ph + 2, ds, ds);
      }
    };
    panel(G.f[0], false);
    panel(G.f[1], true);
    // 시간
    const left = Math.max(0, Math.ceil(LIMIT - G.t));
    g.textAlign = "center";
    const ft = px(8, 11);
    g.fillStyle = "rgba(6, 18, 28, .78)";
    g.fillRect(W / 2 - ft * 1.6, 6, ft * 3.2, ft + 5);
    g.font = `800 ${ft}px "Consolas", monospace`;
    g.fillStyle = left <= 10 ? "#ff6a6a" : "#d2ffee";
    g.fillText(String(left), W / 2, 6 + ft + 1);

    // 시작
    if (G.pre > 0) {
      const t = 1.6 - G.pre;
      g.fillStyle = "rgba(4, 12, 20, .35)";
      g.fillRect(0, 70, W, 40);
      g.font = `900 ${t < 0.9 ? 13 : 20}px "Consolas", monospace`;
      g.fillStyle = t < 0.9 ? "#3dffb4" : "#ffffff";
      g.fillText(t < 0.9 ? "DIGITAL BATTLE" : "FIGHT!", W / 2, 96);
    }
    // 진화 띠
    if (G.banner) {
      const B = G.banner, a = Math.min(1, B.life * 3, (B.max - B.life) * 6);
      g.globalAlpha = a;
      g.fillStyle = "rgba(4, 12, 20, .82)";
      g.fillRect(0, 66, W, 46);
      g.fillStyle = B.c[0];
      g.fillRect(0, 66, W, 1);
      g.fillRect(0, 111, W, 1);
      g.font = `700 ${px(7, 10)}px "Pretendard", "Malgun Gothic", sans-serif`;
      g.fillStyle = "#9fb3c8";
      g.fillText(`${B.top}`, W / 2, 78);
      g.font = `900 ${px(15, 18)}px "Pretendard", "Malgun Gothic", sans-serif`;
      g.fillStyle = "#ffffff";
      g.fillText(B.big, W / 2, 96);
      g.font = `700 ${px(6, 9.5)}px "Consolas", monospace`;
      g.fillStyle = B.c[0];
      g.fillText(`DIGIVOLVE · ${B.sub}`, W / 2, 106);
      g.globalAlpha = 1;
    }
    if (G.cine && !G.cine.swapped) {
      g.font = `900 ${px(10, 13)}px "Consolas", monospace`;
      g.fillStyle = colorOf(G.cine.to.attr)[0];
      g.globalAlpha = 0.6 + Math.sin(G.cine.t * 30) * 0.4;
      g.fillText("DIGIVOLVE...", W / 2, 60);
      g.globalAlpha = 1;
    }
    if (G.over && G.over.loser && G.over.t > 0.3) {
      g.font = `900 ${px(12, 14)}px "Consolas", monospace`;
      g.fillStyle = "#ff5a6a";
      g.globalAlpha = Math.min(1, G.over.t);
      g.fillText("DELETE", G.over.loser.x, GROUND - sizeOf(G.over.loser) - 8);
      g.globalAlpha = 1;
    }
  }

  /* ---------------- 명령 줄(DOM) ---------------- */

  function syncCmd() {
    const f = G && !G.done ? G.f[0] : null;
    const gauge = f ? f.gauge : 0;
    $("fbGauge").style.width = `${gauge}%`;
    $("fbGauge").classList.toggle("full", gauge >= 100);
    $("fbGaugeN").textContent = String(Math.floor(gauge));
    const live = f && !G.over && !G.cine && G.pre <= 0;
    for (const b of document.querySelectorAll("#fbCmd [data-cmd]")) {
      const c = b.dataset.cmd;
      let ok = live && gauge >= (f ? costOf(f, c) : COST[c]);
      if (c === "evolve") {
        const can = f && canEvo(f);
        const cost = f ? costOf(f, c) : BAL.evo[1];
        ok = ok && can;
        b.querySelector("span").textContent = f && !can ? "🧬 최종 모습" : "🧬 진화!";
        b.querySelector("small").textContent = f && can ? `${cost} ▶ ${f.forms[f.fi + 1].name}` : String(cost);
        b.title = f && can ? `${form(f).name} → ${f.forms[f.fi + 1].name} (게이지 ${cost})` : "";
        b.classList.toggle("ready", Boolean(ok));
      }
      if (c === "rally") ok = ok && f.rally <= 0;
      if (c === "special" && f) b.title = `${form(f).skill || "DIGITAL ATTACK"}`;
      b.disabled = !ok;
    }
  }

  /* ---------------- 돌리기 ---------------- */

  function loop() {
    cancelAnimationFrame(raf);
    last = performance.now();
    const tick = (now) => {
      if (!G || G.done && !G.over) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!$("tab-field").hidden && !document.hidden) {
        step(dt); // 끝난 판도 흩어지는 파편은 마저 움직인다(overStep 은 결과를 한 번만 띄운다)
        draw();
        syncCmd();
      }
      if (G && !(G.done && G.over && G.over.shown && G.parts.length === 0)) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  /* 판이 없을 때 — 고른 파트너가 초원에 서 있다 */
  function idle() {
    fit();
    for (const id of ["fbUnder", "fbFx"]) { const c = $(id); c.getContext("2d").clearRect(0, 0, c.width, c.height); }
    const m = mons.find((x) => x.id === sel.me);
    const o = sel.foe !== "wild" && mons.find((x) => x.id === sel.foe);
    $("fbMons").innerHTML = [
      m ? `<img class="fb-mon idle" src="${esc(m.animUrl || m.url)}" style="left:${((70 - 25) / W) * 100}%; top:${((GROUND - 50) / H) * 100}%; width:${(50 / W) * 100}%; transform:scaleX(-1)">` : "",
      o ? `<img class="fb-mon idle" src="${esc(o.animUrl || o.url)}" style="left:${((250 - 25) / W) * 100}%; top:${((GROUND - 50) / H) * 100}%; width:${(50 / W) * 100}%">` : `<span class="fb-q" style="left:${((250 - 14) / W) * 100}%; top:${((GROUND - 44) / H) * 100}%;">?</span>`,
    ].join("");
    $("fbOver").className = "fb-over on idle";
    $("fbOver").innerHTML = `<div class="fb-hint">${m ? `<b>${esc(m.name)}</b> VS <b>${o ? esc(o.name) : "야생 디지몬"}</b><small>둘 다 성장기로 시작해서 싸우며 진화합니다</small>` : "박스에 싸울 수 있는 디지몬이 없습니다"}</div>`;
    syncCmd();
  }

  /* ---------------- 고르기 ---------------- */

  function renderPick() {
    const running = Boolean(G && !G.done);
    const fighters = mons;
    if (!fighters.some((m) => m.id === sel.me)) sel.me = (fighters.find((m) => m.id === activeId) || fighters[0] || {}).id || null;
    if (sel.foe !== "wild" && (!fighters.some((m) => m.id === sel.foe) || sel.foe === sel.me)) sel.foe = "wild";
    const opt = (m, on) => `<option value="${esc(m.id)}"${on ? " selected" : ""}>${esc(m.name)} · Lv.${m.lv || 1} ${esc(m.stage)}</option>`;
    $("fbMe").innerHTML = fighters.map((m) => opt(m, m.id === sel.me)).join("") || '<option value="">디지몬이 없습니다</option>';
    $("fbFoe").innerHTML = `<option value="wild"${sel.foe === "wild" ? " selected" : ""}>🎲 야생 디지몬 (같은 단계)</option>` + fighters.filter((m) => m.id !== sel.me).map((m) => opt(m, m.id === sel.foe)).join("");
    $("fbMe").disabled = $("fbFoe").disabled = running;
    $("fbGo").textContent = running ? "그만두기" : "⚔️ 배틀 시작";
    $("fbGo").classList.toggle("quit", running);
    $("fbGo").disabled = !running && !sel.me;
  }

  function toast(text) {
    const el = $("toast");
    if (!el) return;
    el.textContent = text;
    el.className = "show bad";
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.className = ""), 2800);
  }

  $("fbMe").onchange = () => { sel.me = $("fbMe").value; renderPick(); idle(); };
  $("fbFoe").onchange = () => { sel.foe = $("fbFoe").value; idle(); };
  $("fbGo").onclick = () => (G && !G.done ? stop() : start());
  $("fbAuto").checked = auto;
  $("fbCalm").checked = calm;
  $("fbCalm").onchange = () => {
    calm = $("fbCalm").checked;
    try { localStorage.setItem("ptbFieldCalm", calm ? "1" : "0"); } catch {}
  };
  $("fbAuto").onchange = () => {
    auto = $("fbAuto").checked;
    try { localStorage.setItem("ptbFieldAuto", auto ? "1" : "0"); } catch {}
  };
  for (const b of document.querySelectorAll("#fbCmd [data-cmd]")) b.onclick = () => G && command(G.f[0], b.dataset.cmd);
  window.addEventListener("keydown", (e) => {
    if ($("tab-field").hidden || !G || G.done || e.target.closest("input, select, textarea")) return;
    const c = { 1: "special", 2: "guard", 3: "rally", 4: "evolve" }[e.key];
    if (c) { e.preventDefault(); command(G.f[0], c); }
  });
  window.addEventListener("resize", () => { if ($("tab-field").hidden) return; if (G) draw(); });

  window.ptb.onStats((s) => {
    mons = (s.box || []).filter((m) => m.stageKey && m.stageKey !== "egg");
    activeId = s.activeId;
    if (!G || G.done) {
      renderPick();
      if (!G && !$("tab-field").hidden) idle();
    }
  });

  // 바탕화면에서 두 펫을 겹치면 — 그 둘로 바로 붙는다
  if (window.ptb.onFieldStart) {
    window.ptb.onFieldStart(({ a, b } = {}) => {
      if (G && !G.done) return;
      sel.me = a;
      sel.foe = b || "wild";
      if (G) { G.done = true; G = null; }
      start(); // 고르기 목록은 판을 받은 뒤에 다시 그린다(아직 박스를 못 받았어도 이 둘로 붙는다)
    });
  }

  window.ptbField = {
    /** 지금 판 요약 — 확인용 */
    state: () => G && { t: Math.round(G.t), cine: Boolean(G.cine), over: G.over ? (G.over.loser ? form(G.over.loser).name : "draw") : null, f: G.f.map((f) => ({ name: form(f).name, hp: Math.round(f.hp), max: f.max, gauge: Math.round(f.gauge), act: f.act && f.act.k, z: Math.round(f.z), x: Math.round(f.x) })), fx: G.fxs.map((e) => e.k).concat(G.cut ? ["cut-in"] : []) },
    open() {
      requestAnimationFrame(() => {
        fit();
        if (!G) { renderPick(); idle(); }
        else draw();
      });
    },
  };
})();
