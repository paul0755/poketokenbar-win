"use strict";
/**
 * 기술 연출 — 바탕화면 펫이 기술을 쓰는 장면.
 *
 * ── 왜 합성하나 ──
 * 쓰는 스프라이트(5세대 애니메이션)에는 제자리 대기 동작 하나뿐이고,
 * 공격 모션을 쓸 만한 라이선스로 배포하는 곳이 없다. 그래서 가진 것으로 만든다:
 *
 *   몸   분류(물리·특수·변화)마다 하나. 돌진 / 기 모으기 / 번쩍이기
 *   효과 타입마다 색과 입자 모양
 *   전용 기술 이름으로 고른 모양을 그 위에 얹는다 — 물기는 이빨, 빔은 광선 (SIGS)
 *   크기 위력이 셀수록 크고 많이. 위력 100 이상은 창이 흔들린다
 *   이름 머리 위에 잠깐. 무슨 기술인지는 글자가 제일 정확하다
 *
 * 기술마다 따로 만들면 500개를 그려야 한다. 이름에는 규칙이 있다 — "펀치",
 * "빔", "엄니". 그 규칙 스무 개 남짓으로 대부분이 걸리고, 안 걸리면 타입 연출만 나간다.
 *
 * ── 비용 ──
 * 캔버스는 연출하는 1초 남짓만 그린다. 끝나면 requestAnimationFrame 을
 * 멈춘다 — 펫은 하루 종일 떠 있으므로 노는 동안 CPU 를 쓰면 안 된다.
 */
(function () {
  /*
   * 처음엔 1.1초였다. 직접 보니 "뭔가 번쩍였나?" 수준이라 기술을 쓴 것처럼 안 보였다.
   * 두 번 몰아치고(WAVE), 맞는 자리를 타입 색으로 한 번 밝히고(flash), 이름은 3초 둔다.
   */
  const DURATION = 2000;
  const WAVE = 520; // 두 번째 몰아치기까지

  /*
   * 타입 → 입자 모양·색. 색은 원작 타입 색에서 가져와 조금 밝혔다.
   * 투명 창이라 바탕이 무엇일지 모른다 — 너무 어두운 색은 안 보인다.
   */
  const FX = {
    normal: { k: "burst", c: ["#ffffff", "#e8e4d0"] },
    fighting: { k: "burst", c: ["#ff7043", "#ffc9a8"] },
    flying: { k: "wind", c: ["#e6ecff", "#b7a6f5"] },
    poison: { k: "bubble", c: ["#c060d0", "#e3a0f0"] },
    ground: { k: "dust", c: ["#e0c068", "#b8945a"] },
    rock: { k: "burst", c: ["#c8b048", "#9a8434"] },
    bug: { k: "leaf", c: ["#b8c830", "#d6e46a"] },
    ghost: { k: "ring", c: ["#9a7fd0", "#c9b5f0"] },
    steel: { k: "burst", c: ["#d0d0e8", "#ffffff"] },
    fire: { k: "ember", c: ["#ff6a00", "#ffb000", "#ff3d00"] },
    water: { k: "drop", c: ["#3fa9ff", "#8ad6ff", "#2a7de1"] },
    grass: { k: "leaf", c: ["#4caf50", "#8bd34a", "#2e9d32"] },
    electric: { k: "bolt", c: ["#ffe600", "#fff7b0"] },
    psychic: { k: "ring", c: ["#ff5c9a", "#ffa6c9"] },
    ice: { k: "shard", c: ["#c8f6ff", "#86e6ff", "#ffffff"] },
    dragon: { k: "ring", c: ["#8a5cff", "#b9a0ff"] },
    dark: { k: "ring", c: ["#8a7466", "#4a3c34"] },
    fairy: { k: "sparkle", c: ["#ff9ee5", "#ffd6f4"] },
  };
  const DEFAULT_FX = FX.normal;

  /** 이름표 바탕색. 원작 타입 색 그대로 — 글자는 흰색이라 진한 쪽이 낫다. */
  const TAG = {
    normal: "#a8a878", fighting: "#c03028", flying: "#a890f0", poison: "#a040a0",
    ground: "#e0c068", rock: "#b8a038", bug: "#a8b820", ghost: "#705898",
    steel: "#b8b8d0", fire: "#f08030", water: "#6890f0", grass: "#78c850",
    electric: "#f8d030", psychic: "#f85888", ice: "#98d8d8", dragon: "#7038f8",
    dark: "#705848", fairy: "#ee99ac",
  };

  const GLOW = { ember: 1, bolt: 1, sparkle: 1, shard: 1, ring: 1, beam: 1, orb: 1, slash: 1, glare: 1, hex: 1, star: 1 };

  /*
   * 전용 연출. 위에서부터 처음 걸리는 것 하나만 쓴다 — 순서가 곧 우선순위다.
   * "분노의앞니"는 분노보다 엄니가, "크로스촙"은 크로스(베기)보다 촙(주먹)이 맞다.
   *
   *   k     모양 (spawnSig)
   *   body  몸 연출을 분류 대신 이걸로 (pulse | charge | lunge | clone | sleep)
   *   solo  타입 입자를 뿌리지 않는다. 눈빛·자장가에 불꽃이 튀면 이상하다
   */
  const SIGS = [
    { re: /물기|깨물|엄니|앞니|꿀꺽|야금야금|벌레먹기|흡혈/, k: "jaws", body: "lunge" },
    { re: /대폭발|자폭|목숨걸기/, k: "explode", body: "pulse", solo: true },
    { re: /노래|풀피리/, k: "song", body: "pulse", solo: true },
    { re: /잠자기|하품|잠꼬대|코골기|게으름피우기|수면가루|버섯포자|악몽/, k: "sleep", body: "sleep", solo: true },
    { re: /째려보기|겁나는얼굴|뱀눈초리|검은눈빛|이상한빛|꿰뚫어보기|미라클아이|마음의눈|록온|판별|최면술/, k: "glare", body: "pulse", solo: true },
    { re: /^분노$|역린|난동부리기|객기|분발|화풀이|소란피기|분연|원한|원념|저주|분노가루/, k: "rage", body: "pulse", solo: true },
    { re: /회복|광합성|아침햇살|달빛|날개쉬기|희망사항|알낳기|치유|치료|아로마|아쿠아링|뿌리박기|리프레시|드레인|흡수|꿈먹기/, k: "heal" },
    { re: /^방어$|지키기|리플렉터|빛의장막|철벽|웅크리기|단단해지기|버티기|배리어|블록|가드|매직코트|미러코트|껍질에숨기|방어지령|대타출동|흰안개/, k: "shield", body: "pulse", solo: true },
    { re: /그림자분신|순간이동|바꿔치기|트릭$|흉내|따라하기|텍스처|작아지기/, k: "clone", body: "clone", solo: true },
    { re: /울음|울부짖|소리|보이스|금속음|초음파|소닉붐|에코|싱크로노이즈|멀리짖기|바크아웃/, k: "sound", body: "charge" },
    { re: /칼춤|용의춤|나비춤|기합$|명상|비축하기|나쁜음모|벌크업|성장|코스믹파워|요가포즈|똬리틀기|손톱갈기|자기암시|기충전|^충전$|고속이동|기어체인지|껍질깨기|부추기기|뽐내기|정신차리기|바디퍼지|깃털댄스|꽃잎댄스|불꽃춤/, k: "buff", body: "pulse", solo: true },
    { re: /꼬리흔들기|간지르기|애교부리기|거짓울음|유혹|모래뿌리기|연막|달콤한향기|실뿜기|전기자석파|독가루|저리가루|도발|트집|앙코르|봉인|흑안개|헤롱헤롱|천사의키스|악마의키스|핥기|스모그|독가스/, k: "debuff", body: "pulse" },
    { re: /지진|땅고르기|땅가르기|매그니튜드|대지의힘|눈사태|하드롤러|짓밟기/, k: "quake", body: "lunge" },
    { re: /번개$|눈보라|폭풍|모래바람|싸라기눈|눈싸라기|비바라기|쾌청|회오리|리프스톰|탁류|파도타기|조수|연옥|불대문자|돌떨구기|스톤샤워|고드름떨구기|스텔스록|오물웨이브|열탕/, k: "rain", body: "charge" },
    { re: /빔|광선|레이저|방사|펌프|대포|캐논|전자포|오버히트|해수스파우팅|분화|열풍|숨결|불꽃세례|거품광선|오로라|시그널|미러샷/, k: "beam", body: "charge" },
    { re: /볼$|구슬|폭탄|봄$|봄버|탄$|머드샷|얼음뭉치|파워젬|스피드스타|프레젠트|부메랑|씨기관총|록블라스트|암석포/, k: "orb", body: "charge" },
    { re: /파동|웨이브|사이코키네시스|신통력|염동력|사이코쇼크|진공파|전격파|방전|나이트헤드|원시의힘|미래예지/, k: "pulse", body: "charge" },
    { re: /펀치|주먹|촙|당수|손바닥|뺨치기|발경|해머|바위깨기|힘껏치기|막치기/, k: "punch", body: "lunge" },
    { re: /킥|차기|스탬프|안다리걸기/, k: "kick", body: "lunge" },
    { re: /베기|할퀴기|클로|커터|크로스|자르기|가르기|블레이드|칼|슬래시|가위|손톱|잎날|채찍|날개치기|강철날개/, k: "slash", body: "lunge" },
    { re: /휘감기|조이기|김밥말이|사슬묶기|풀묶기|거미집|일렉트릭네트|모래지옥|쥐어짜기/, k: "bind", body: "pulse" },
    { re: /바람/, k: "gust", body: "charge" },
    { re: /찌르기|뿔|니들|바늘|침$|쪼기|쪼아대기|드릴|메가혼|우드혼|부리|가시대포|압정/, k: "stab", body: "lunge" },
    { re: /박치기|돌진|태클|임팩트|브레이브버드|플레어드라이브|와일드볼트|아이언헤드|우드해머|누르기|니트로차지|폭포오르기|제트|전광석화|신속|테일|괴력|엄청난힘|인파이트|기습|속여때리기|애크러뱃|따라가때리기|집단구타|야습|구르기|바퀴|고속스핀|다이빙|공중날기|다이브|뛰어오르기|프리폴|휩|던지기|메탈버스트|카운터|리벤지|보복/, k: "impact", body: "lunge" },
  ];

  /**
   * 위력 → 크기. 위력 40(박치기)이 0.95, 120(파괴광선급)이 1.45 쯤이다.
   * 변화 기술은 위력이 없다 — 1로 둔다.
   */
  const scaleOf = (power) => (power ? Math.min(1.5, Math.max(0.8, 0.7 + power / 160)) : 1);

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  let canvas, ctx, tag, size = 128;
  let parts = [];
  let raf = 0;
  let endAt = 0;
  let playing = false;

  function ensure() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = "fx";
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
    tag = document.createElement("div");
    tag.id = "moveTag";
    document.body.appendChild(tag);
  }

  function resize() {
    size = Math.max(window.innerWidth, 64);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = canvas.style.height = size + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------- 입자 ---------------- */

  /**
   * 입자를 뿌린다. 원점은 분류마다 다르다 —
   * 물리는 앞쪽 부딪히는 자리, 특수는 몸에서 앞으로, 변화는 몸 둘레.
   */
  function spawn(fx, cls, dir, delay = 0, amount = 1, scale = 1) {
    const s = size;
    const body = { x: s / 2, y: s * 0.62 }; // 스프라이트는 아래에 붙어 있다
    const front = { x: s / 2 + dir * s * 0.3, y: s * 0.6 };
    const o = cls === "physical" ? front : body;
    const t0 = performance.now() + delay;
    // 맞는 자리가 잠깐 밝아진다. 입자보다 먼저 눈에 들어오는 신호다
    parts.push({ k: "flash", c: fx.c[0], x: o.x, y: o.y, born: t0, life: 480, sc: scale });
    if (amount <= 0) return;
    const n0 = { burst: 18, ember: 26, drop: 22, shard: 16, bolt: 3, leaf: 14, bubble: 14, ring: 3, sparkle: 16, wind: 8, dust: 18 }[fx.k] || 14;
    const n = Math.max(1, Math.round(n0 * amount * scale));

    for (let i = 0; i < n; i++) {
      const p = {
        k: fx.k,
        c: pick(fx.c),
        x: o.x, y: o.y, vx: 0, vy: 0,
        r: rnd(3, 5.5) * (s / 128) * scale,
        rot: rnd(0, Math.PI * 2), vr: rnd(-0.2, 0.2),
        born: t0 + (fx.k === "ring" ? i * 180 : rnd(0, 250)),
        life: rnd(900, 1400),
        ph: rnd(0, Math.PI * 2),
      };
      const sp = s / 128; // 창 크기에 맞춰 속도도 늘린다
      switch (fx.k) {
        case "burst": {
          const a = rnd(0, Math.PI * 2);
          const v = rnd(1.2, 3.2) * sp;
          p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v; p.life = rnd(500, 850);
          break;
        }
        case "ember":
          p.x += rnd(-0.25, 0.25) * s; p.y += rnd(-0.05, 0.2) * s;
          p.vx = dir * rnd(0.2, 1.2) * sp; p.vy = -rnd(0.8, 2.0) * sp; p.r *= 1.3;
          break;
        case "drop":
          p.vx = dir * rnd(1.2, 3.0) * sp; p.vy = -rnd(1.0, 2.6) * sp;
          break;
        case "shard":
          p.vx = dir * rnd(0.8, 2.6) * sp + rnd(-0.6, 0.6) * sp; p.vy = rnd(-1.6, 0.4) * sp; p.r *= 1.4;
          break;
        case "bolt":
          p.life = rnd(800, 1100);
          break;
        case "leaf":
          p.x += rnd(-0.2, 0.2) * s; p.y += rnd(-0.2, 0.15) * s;
          p.vx = dir * rnd(0.8, 2.0) * sp; p.vy = rnd(-0.8, 0.3) * sp; p.r *= 1.6;
          break;
        case "bubble":
          p.x += rnd(-0.28, 0.28) * s; p.y += rnd(0, 0.2) * s;
          p.vy = -rnd(0.5, 1.3) * sp; p.r *= rnd(1.2, 2.2);
          break;
        case "ring":
          p.life = 900;
          break;
        case "sparkle":
          p.x += rnd(-0.35, 0.35) * s; p.y += rnd(-0.4, 0.25) * s; p.r *= 1.6;
          p.vy = -rnd(0.1, 0.5) * sp;
          break;
        case "wind":
          p.x = dir > 0 ? rnd(0, 0.3) * s : rnd(0.7, 1) * s; p.y = rnd(0.25, 0.85) * s;
          p.vx = dir * rnd(2.5, 4.5) * sp; p.r = rnd(0.12, 0.25) * s;
          break;
        case "dust":
          p.y = s * rnd(0.86, 0.95); p.x += rnd(-0.1, 0.1) * s;
          p.vx = rnd(-2.2, 2.2) * sp; p.vy = -rnd(0.1, 0.7) * sp; p.r *= rnd(1.4, 2.6);
          break;
      }
      parts.push(p);
    }
    // 변화 기술은 무슨 타입이든 몸에서 퍼지는 고리 하나를 더한다 — "뭔가 걸었다"는 신호
    if (cls === "status") {
      parts.push({ k: "ring", c: fx.c[0], x: body.x, y: body.y, born: t0, life: 1000, r: 0 });
    }
  }

  function draw(p, t, now) {
    const a = Math.max(0, 1 - t);
    ctx.globalAlpha = a;
    ctx.fillStyle = ctx.strokeStyle = p.c;
    // 빛나는 것들만 번지게 한다. 바탕이 밝아도 윤곽이 보인다
    ctx.shadowBlur = GLOW[p.k] ? size / 20 : 0;
    ctx.shadowColor = p.c;
    switch (p.k) {
      case "flash": {
        const r = size * (0.2 + t * 0.3) * (p.sc || 1);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, p.c);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = 0.7 * a;
        ctx.shadowBlur = 0;
        ctx.fillStyle = g;
        ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
        break;
      }
      case "burst":
      case "dust":
      case "ember": {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (p.k === "ember" ? a : 1), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "drop": {
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.r * 0.8, p.r * 1.3, Math.atan2(p.vy, p.vx) + Math.PI / 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "shard":
      case "sparkle": {
        // 네 갈래 별. 얼음은 각지게, 반짝임은 가늘게
        const r = p.r * (p.k === "sparkle" ? 0.6 + 0.6 * Math.abs(Math.sin(now / 90 + p.ph)) : 1);
        const w = p.k === "sparkle" ? r * 0.25 : r * 0.45;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.moveTo(0, -r); ctx.lineTo(w, 0); ctx.lineTo(0, r); ctx.lineTo(-w, 0); ctx.closePath();
        ctx.moveTo(-r, 0); ctx.lineTo(0, w); ctx.lineTo(r, 0); ctx.lineTo(0, -w); ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }
      case "leaf": {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r * 1.4, p.r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
      case "bubble": {
        ctx.lineWidth = Math.max(1, size / 110);
        ctx.beginPath();
        ctx.arc(p.x + Math.sin(now / 160 + p.ph) * 3, p.y, p.r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "ring": {
        ctx.lineWidth = Math.max(1.5, size / 60) * a * (p.lw || 1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, size * 0.08 + t * size * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "wind": {
        ctx.lineWidth = Math.max(1.2, size / 90);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.quadraticCurveTo(p.x - Math.sign(p.vx) * p.r / 2, p.y - 4, p.x - Math.sign(p.vx) * p.r, p.y);
        ctx.stroke();
        break;
      }
      case "bolt": {
        // 매 프레임 새로 꺾는다 — 번개는 가만히 있지 않는다
        if (Math.random() < 0.2) break; // 깜빡임
        ctx.lineWidth = Math.max(1.5, size / 55);
        ctx.lineJoin = "round";
        let x = p.x + rnd(-0.3, 0.3) * size;
        let y = 0;
        ctx.beginPath();
        ctx.moveTo(x, y);
        while (y < p.y) {
          y += size * rnd(0.08, 0.16);
          x += rnd(-0.1, 0.1) * size;
          ctx.lineTo(x, Math.min(y, p.y));
        }
        ctx.stroke();
        break;
      }
      default:
        drawSig(p, t, now, a);
    }
  }

  /* ---------------- 전용 연출 ---------------- */

  // 두 번 몰아칠 때 다시 뿌리는 모양. 방벽·눈빛·노래·잠은 한 번이면 된다
  const REPEAT = new Set(["jaws", "punch", "kick", "slash", "stab", "impact", "orb", "pulse"]);

  /** 기술 이름으로 고른 모양을 뿌린다. 타입 입자와 따로 논다. */
  function spawnSig(k, fx, cls, dir, scale, delay) {
    const s = size;
    const t0 = performance.now() + delay;
    const B = { x: s / 2, y: s * 0.62 };
    const H = { x: s / 2 + dir * s * 0.08, y: s * 0.46 }; // 대략 머리
    const F = { x: s / 2 + dir * s * 0.3, y: s * 0.6 };
    const c0 = fx.c[0];
    const add = (p) => parts.push({ c: c0, born: t0, life: 900, ...p });
    switch (k) {
      case "jaws":
        add({ k: "jaws", x: F.x, y: F.y, life: 750, sc: scale });
        break;
      case "glare":
        // 노말·악의 째려보기는 흰색·갈색이라 안 보인다. 붉게 빛나는 눈이 "노려본다"에 맞다
        add({ k: "glare", x: H.x, y: H.y, life: 1200, dir, c: fx === FX.normal || fx === FX.dark ? "#ff3b3b" : c0 });
        break;
      case "rage":
        add({ k: "anger", x: s / 2 - dir * s * 0.2, y: s * 0.3, life: 1300 });
        spawn({ k: "ember", c: ["#ff2b2b", "#ff6a3a", "#ffb000"] }, "status", dir, delay, 1.1, 1);
        break;
      case "song":
        for (let i = 0; i < 6; i++) {
          add({ k: "text", g: pick(["♪", "♫", "♬"]), x: H.x, y: H.y, vx: dir * rnd(0.6, 1.4), vy: -rnd(0.3, 0.9), born: t0 + i * 150, life: 1300, fs: rnd(0.12, 0.17), ph: rnd(0, 6), c: pick(["#ff8ad8", "#ffffff", c0]) });
        }
        break;
      case "sleep":
        for (let i = 0; i < 3; i++) {
          add({ k: "text", g: "Z", x: s / 2 - dir * s * 0.12, y: s * 0.4, vx: -dir * 0.35, vy: -0.55, born: t0 + i * 380, life: 1400, fs: 0.13 + i * 0.05, ph: i, c: "#cfe3ff" });
        }
        break;
      case "heal":
        for (let i = 0; i < 9; i++) {
          add({ k: "text", g: "+", x: B.x + rnd(-0.3, 0.3) * s, y: B.y + rnd(-0.1, 0.25) * s, vx: 0, vy: -rnd(0.4, 0.9), born: t0 + rnd(0, 500), life: 1100, fs: rnd(0.12, 0.18), ph: rnd(0, 6), c: pick(["#5be37a", "#a6f5b5", "#ffffff"]) });
        }
        break;
      case "shield":
        add({ k: "hex", x: B.x, y: s * 0.55, life: 1400 });
        break;
      case "clone":
        for (let i = 0; i < 8; i++) {
          add({ k: "sparkle", x: B.x + rnd(-0.4, 0.4) * s, y: B.y + rnd(-0.35, 0.2) * s, vx: 0, vy: -0.2, r: rnd(3, 6) * (s / 128), rot: 0, vr: 0.05, born: t0 + rnd(0, 700), life: 700, ph: rnd(0, 6), c: pick(["#ffffff", c0]) });
        }
        break;
      case "sound":
        for (let i = 0; i < 4; i++) add({ k: "arc", x: H.x, y: H.y, dir, born: t0 + i * 160, life: 750 });
        break;
      case "buff":
        for (let i = 0; i < 6; i++) {
          add({ k: "arrow", up: true, x: B.x + rnd(-0.3, 0.3) * s, y: B.y + rnd(0, 0.2) * s, vy: -rnd(0.6, 1.1), born: t0 + i * 110, life: 900, c: pick(["#ff6a3a", "#ffb000", c0]) });
        }
        break;
      case "debuff":
        for (let i = 0; i < 5; i++) {
          add({ k: "arrow", up: false, x: F.x + rnd(-0.12, 0.12) * s, y: s * 0.25 + rnd(0, 0.1) * s, vy: rnd(0.6, 1.0), born: t0 + 250 + i * 120, life: 850, c: pick(["#5aa0ff", "#9cc6ff"]) });
        }
        break;
      case "quake":
        setTimeout(() => shake("quake"), delay);
        add({ k: "crack", x: B.x, y: s * 0.93, life: 1300, seed: Math.random() * 1000, c: "#e0c080" });
        spawn(FX.ground, "physical", dir, delay, 0.8, scale);
        break;
      case "rain": {
        // 위에서 쏟아진다. 모양은 타입 그대로(물방울·얼음·불씨·잎·번개), 바위·땅은 돌덩이
        const own = ["bolt", "drop", "shard", "ember", "leaf"];
        const kind = own.includes(fx.k) ? fx.k : fx.k === "burst" || fx.k === "dust" ? "rock" : "drop";
        const n = Math.round((kind === "bolt" ? 5 : 26) * scale);
        for (let i = 0; i < n; i++) {
          const p = {
            k: kind, c: pick(fx.c), fall: true,
            x: rnd(0.05, 0.95) * s, y: -rnd(0, 0.3) * s,
            vx: dir * rnd(0, 0.6), vy: rnd(2, 3.4) * (s / 128),
            r: rnd(3, 5.5) * (s / 128), rot: rnd(0, 6), vr: rnd(-0.2, 0.2),
            born: t0 + rnd(0, 700), life: rnd(700, 1000), ph: rnd(0, 6),
          };
          // 번개는 위에서 p.y 까지 내리꽂힌다
          if (kind === "bolt") { p.y = rnd(0.5, 0.95) * s; p.vx = p.vy = 0; p.life = rnd(250, 450); }
          parts.push(p);
        }
        break;
      }
      case "beam":
        add({ k: "beam", x: B.x + dir * s * 0.05, y: s * 0.55, dir, life: 950, sc: scale });
        break;
      case "orb":
        add({ k: "orb", x: F.x, y: s * 0.55, dir, life: 950, sc: scale });
        break;
      case "pulse":
        for (let i = 0; i < 3; i++) add({ k: "ring", x: B.x, y: B.y, born: t0 + i * 150, life: 900, lw: 2.2 * scale });
        break;
      case "punch":
        add({ k: "star", x: F.x, y: F.y - s * 0.05, life: 500, sc: scale, pts: 8 });
        for (let i = 0; i < 5; i++) add({ k: "speed", x: B.x, y: s * rnd(0.45, 0.75), dir, born: t0 + rnd(0, 120), life: 300 });
        break;
      case "kick":
        add({ k: "swoosh", x: F.x - dir * s * 0.05, y: s * 0.62, dir, life: 450 });
        add({ k: "star", x: F.x, y: s * 0.72, born: t0 + 150, life: 450, sc: scale * 0.9, pts: 6 });
        break;
      case "slash":
        for (let i = 0; i < 3; i++) add({ k: "slash", x: F.x, y: s * (0.4 + i * 0.12), dir, born: t0 + i * 90, life: 550, sc: scale });
        break;
      case "stab":
        for (let i = 0; i < 5; i++) add({ k: "speed", x: B.x, y: s * rnd(0.45, 0.72), dir, born: t0 + i * 70, life: 260, thick: true });
        add({ k: "star", x: F.x + dir * s * 0.05, y: F.y - s * 0.05, born: t0 + 200, life: 380, sc: scale * 0.7, pts: 4 });
        break;
      case "bind":
        // 몸을 칭칭 감는 고리 셋. 바깥에서 조여 들어온다
        for (let i = 0; i < 3; i++) add({ k: "bind", x: B.x, y: s * (0.5 + i * 0.13), born: t0 + i * 120, life: 1100, ph: i });
        break;
      case "gust":
        spawn({ k: "wind", c: fx === FX.normal ? FX.flying.c : fx.c }, "special", dir, delay, 1.6, scale);
        break;
      case "impact":
        add({ k: "star", x: F.x, y: F.y - s * 0.04, life: 550, sc: scale * 1.15, pts: 10 });
        break;
      case "explode":
        setTimeout(() => shake("shake"), delay);
        add({ k: "flash", x: B.x, y: B.y, life: 700, sc: 2.4, c: "#fff2b0" });
        spawn({ k: "burst", c: ["#ffffff", "#ffd24a", "#ff7a1a"] }, "status", dir, delay, 2.2, 1.3);
        break;
    }
  }

  function drawSig(p, t, now, a) {
    const s = size;
    switch (p.k) {
      case "jaws": {
        // 위아래 턱이 다물린다. 앞쪽 35% 동안 닫히고 나머지는 물고 있다
        const q = Math.min(1, t / 0.35);
        const e = 1 - Math.pow(1 - q, 3);
        const w = s * 0.34 * (p.sc || 1);
        const gap = (1 - e) * s * 0.2 + s * 0.015;
        ctx.shadowBlur = 0;
        ctx.lineWidth = Math.max(1.2, s / 80);
        for (const side of [-1, 1]) {
          const y = p.y + side * gap;
          ctx.beginPath();
          ctx.moveTo(p.x - w / 2, y);
          ctx.quadraticCurveTo(p.x, y + side * s * 0.16, p.x + w / 2, y);
          // 이빨 — 턱 안쪽으로 뾰족하게
          const teeth = 5;
          for (let i = teeth; i >= 0; i--) {
            const tx = p.x - w / 2 + (w * i) / teeth;
            ctx.lineTo(tx, y);
            if (i) ctx.lineTo(tx - w / teeth / 2, y - side * s * 0.05);
          }
          ctx.closePath();
          ctx.fillStyle = "#ffffff";
          ctx.fill();
          ctx.strokeStyle = p.c;
          ctx.stroke();
        }
        break;
      }
      case "glare": {
        // 눈 둘이 번쩍 뜨이고 앞으로 눈빛이 뻗는다
        const open = Math.min(1, t / 0.15);
        ctx.lineWidth = Math.max(1, s / 110);
        for (const ox of [-1, 1]) {
          const x = p.x + ox * s * 0.07;
          ctx.beginPath();
          ctx.ellipse(x, p.y, s * 0.045, s * 0.022 * open + 0.5, ox * 0.25 * p.dir, 0, Math.PI * 2);
          ctx.fill();
          const len = s * 0.25 * Math.min(1, t / 0.4);
          for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.moveTo(x + p.dir * s * 0.04, p.y);
            ctx.lineTo(x + p.dir * (s * 0.04 + len), p.y + i * len * 0.3);
            ctx.stroke();
          }
        }
        break;
      }
      case "anger": {
        // 💢 — 네 귀퉁이 곡선. 두근거리듯 커졌다 작아진다
        const r = s * 0.09 * (1 + 0.2 * Math.sin(now / 70));
        ctx.lineWidth = Math.max(2, s / 40);
        ctx.lineCap = "round";
        ctx.shadowBlur = s / 25;
        ctx.shadowColor = "#ff2b2b";
        ctx.strokeStyle = "#ff2b2b";
        for (let i = 0; i < 4; i++) {
          const ang = (i * Math.PI) / 2 + Math.PI / 4;
          const cx = p.x + Math.cos(ang) * r;
          const cy = p.y + Math.sin(ang) * r;
          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.6, ang + Math.PI * 0.75, ang + Math.PI * 1.25);
          ctx.stroke();
        }
        break;
      }
      case "text": {
        const fs = Math.round(s * p.fs * (0.8 + 0.4 * Math.min(1, t * 2)));
        ctx.font = `bold ${fs}px "Segoe UI Symbol", "Malgun Gothic", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowBlur = s / 30;
        ctx.shadowColor = "rgba(0,0,0,.5)";
        ctx.fillText(p.g, p.x + Math.sin(now / 180 + (p.ph || 0)) * s * 0.02, p.y);
        break;
      }
      case "hex": {
        // 몸을 감싸는 육각형 방벽. 깜빡이며 버티다 사라진다
        const r = s * 0.4 * Math.min(1, 0.6 + t * 2);
        ctx.globalAlpha = a * (0.65 + 0.35 * Math.sin(now / 60));
        ctx.lineWidth = Math.max(2, s / 45);
        ctx.beginPath();
        for (let i = 0; i <= 6; i++) {
          const ang = (i * Math.PI) / 3 + Math.PI / 6;
          const x = p.x + Math.cos(ang) * r;
          const y = p.y + Math.sin(ang) * r;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha *= 0.18;
        ctx.fill();
        break;
      }
      case "arc": {
        // 음파 — 입에서 앞으로 퍼지는 반원
        const r = s * (0.06 + t * 0.5);
        const base = p.dir > 0 ? 0 : Math.PI;
        ctx.lineWidth = Math.max(1.5, s / 55);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, base - 0.6, base + 0.6);
        ctx.stroke();
        break;
      }
      case "arrow": {
        // 능력치가 오르면 위로, 상대를 깎으면 아래로 — 원작 화면의 화살표 그대로
        const w = s * 0.06;
        const d = p.up ? -1 : 1;
        ctx.lineWidth = Math.max(2, s / 40);
        ctx.lineCap = ctx.lineJoin = "round";
        for (const off of [0, w * 0.9]) {
          ctx.beginPath();
          ctx.moveTo(p.x - w, p.y - d * off - d * w * 0.1);
          ctx.lineTo(p.x, p.y - d * off + d * w * 0.6);
          ctx.lineTo(p.x + w, p.y - d * off - d * w * 0.1);
          ctx.stroke();
        }
        break;
      }
      case "crack": {
        // 땅이 갈라진다. 프레임마다 같은 모양이어야 해서 seed 로 꺾는다
        let x = p.x - s * 0.45;
        let y = p.y;
        let k = p.seed;
        const end = p.x - s * 0.45 + s * 0.9 * Math.min(1, t * 3);
        ctx.lineWidth = Math.max(1.5, s / 60);
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(x, y);
        while (x < end) {
          k = (k * 9301 + 49297) % 233280;
          x += s * 0.06;
          y = p.y + (k / 233280 - 0.5) * s * 0.07;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
        break;
      }
      case "rock": {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.r, -p.r * 0.8, p.r * 2, p.r * 1.6);
        ctx.restore();
        break;
      }
      case "beam": {
        // 몸에서 창 끝까지 뻗는 광선. 바깥은 타입 색, 안쪽은 흰 심지
        const env = Math.sin(Math.PI * Math.min(1, t * 1.1));
        const th = s * 0.13 * (p.sc || 1) * env * (0.9 + 0.1 * Math.sin(now / 25));
        const x0 = p.x;
        const len = ((p.dir > 0 ? s : 0) - x0) * Math.min(1, t * 4);
        const left = Math.min(x0, x0 + len);
        ctx.fillRect(left, p.y - th / 2, Math.abs(len), th);
        ctx.beginPath();
        ctx.arc(x0, p.y, th * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(left, p.y - th * 0.18, Math.abs(len), th * 0.36);
        break;
      }
      case "orb": {
        // 앞에서 모였다가 날아간다
        const charge = Math.min(1, t / 0.35);
        const fly = Math.max(0, (t - 0.35) / 0.45);
        const r = s * 0.11 * (p.sc || 1) * (0.3 + 0.7 * charge) * (1 + 0.08 * Math.sin(now / 40));
        const x = p.x + p.dir * fly * s * 0.6;
        if (fly > 0) {
          ctx.globalAlpha = a * 0.35;
          ctx.beginPath();
          ctx.arc(x - p.dir * r * 1.2, p.y, r * 0.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = a;
        }
        ctx.beginPath();
        ctx.arc(x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,.75)";
        ctx.beginPath();
        ctx.arc(x - r * 0.3, p.y - r * 0.3, r * 0.35, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "star": {
        // 맞은 자리의 별 모양 충격. 확 커졌다가 사라진다
        const n = p.pts || 8;
        const R = s * 0.17 * (p.sc || 1) * (0.5 + Math.min(1, t * 3) * 0.6);
        ctx.beginPath();
        for (let i = 0; i <= n * 2; i++) {
          const ang = (i * Math.PI) / n - Math.PI / 2;
          const rr = i % 2 ? R * 0.45 : R;
          const x = p.x + Math.cos(ang) * rr;
          const y = p.y + Math.sin(ang) * rr;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, s / 60);
        ctx.strokeStyle = p.c;
        ctx.stroke();
        break;
      }
      case "speed": {
        // 앞으로 내지르는 속도선
        const len = s * (p.thick ? 0.45 : 0.3) * Math.min(1, t * 3);
        const x0 = p.x + p.dir * s * 0.05 + p.dir * t * s * 0.3;
        ctx.lineWidth = Math.max(1.2, s / (p.thick ? 45 : 80));
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x0, p.y);
        ctx.lineTo(x0 + p.dir * len, p.y);
        ctx.stroke();
        break;
      }
      case "swoosh": {
        // 발차기 궤적 — 아래에서 앞으로 휘두르는 호
        const sweep = Math.min(1, t / 0.5);
        const base = Math.PI / 2; // 발밑에서 시작
        const from = base;
        const to = base - p.dir * Math.PI * 0.9 * sweep;
        ctx.lineWidth = Math.max(3, s / 22) * (1 - t * 0.6);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(p.x, p.y - s * 0.1, s * 0.2, Math.min(from, to), Math.max(from, to));
        ctx.stroke();
        break;
      }
      case "bind": {
        const rx = s * (0.46 - 0.12 * Math.min(1, t * 2.5));
        ctx.lineWidth = Math.max(2, s / 38);
        ctx.setLineDash([s * 0.06, s * 0.03]);
        ctx.lineDashOffset = -now / 20 - p.ph * 10;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rx, rx * 0.28, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case "slash": {
        // 대각선으로 그어지는 베인 자국. 겉은 타입 색, 속은 흰 줄
        const q = Math.min(1, t / 0.3);
        const L = s * 0.34 * (p.sc || 1);
        const x0 = p.x - p.dir * L * 0.5;
        const y0 = p.y - L * 0.35;
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(2, s / 30);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + p.dir * L * q, y0 + L * 0.7 * q);
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(1, s / 90);
        ctx.stroke();
        break;
      }
    }
  }

  /** 창 전체를 흔든다. 지진·대폭발, 그리고 위력 100 이상 */
  function shake(kind) {
    document.body.classList.remove("shake", "quake");
    void document.body.offsetWidth;
    document.body.classList.add(kind);
    setTimeout(() => document.body.classList.remove(kind), kind === "quake" ? 1100 : 500);
  }

  function step(now) {
    ctx.clearRect(0, 0, size, size);
    const alive = [];
    for (const p of parts) {
      if (now < p.born) { alive.push(p); continue; }
      const t = (now - p.born) / p.life;
      if (t >= 1) continue;
      p.x += p.vx || 0;
      p.y += p.vy || 0;
      // 쏟아지는 것(rain)은 처음부터 떨어지는 속도로 시작한다. 중력을 더하면 너무 빨라진다
      if ((p.k === "drop" || p.k === "shard") && !p.fall) p.vy += 0.12 * (size / 128); // 떨어진다
      if (p.k === "dust") { p.vx *= 0.94; p.vy *= 0.96; }
      if (p.k === "leaf") { p.vy += Math.sin(now / 120 + p.ph) * 0.08; }
      if (p.rot != null) p.rot += p.vr || 0;
      draw(p, t, now);
      alive.push(p);
    }
    ctx.globalAlpha = 1;
    parts = alive;
    if (parts.length || now < endAt) raf = requestAnimationFrame(step);
    else { raf = 0; ctx.clearRect(0, 0, size, size); }
  }

  /* ---------------- 몸 ---------------- */

  const BODY = { physical: "mv-lunge", special: "mv-charge", status: "mv-pulse" };
  const BODY_OF = { lunge: "mv-lunge", charge: "mv-charge", pulse: "mv-pulse", clone: "mv-clone", sleep: "mv-sleep" };

  function moveBody(el, cls, dir, glow) {
    if (!el) return;
    el.style.setProperty("--dir", dir);
    el.style.setProperty("--glow", glow);
    const name = BODY_OF[cls] || BODY[cls] || BODY.status;
    for (const c of Object.values(BODY_OF)) el.classList.remove(c);
    void el.offsetWidth; // 같은 연출을 연달아 걸면 다시 시작하도록
    el.classList.add(name);
    setTimeout(() => el.classList.remove(name), DURATION);
  }

  /**
   * 기술 하나를 쓴다.
   *
   *   move  { name, typeKey, damageClass }  — profile.movesOf 가 주는 그대로
   *   opts  { body: 움직일 요소, dir: -1(왼쪽) | 1(오른쪽), isNew }
   *
   * 이미 쓰는 중이면 무시한다. 겹치면 입자가 두 배가 되어 지저분하다.
   */
  function play(move, opts = {}) {
    if (!move || playing) return false;
    ensure();
    resize();
    playing = true;
    setTimeout(() => (playing = false), DURATION);

    const fx = FX[move.typeKey] || DEFAULT_FX;
    const cls = move.damageClass || "status";
    const dir = opts.dir || -1;
    const sig = SIGS.find((x) => x.re.test(move.name)) || null;
    const scale = scaleOf(move.power);

    tag.textContent = (opts.isNew ? "NEW · " : "") + move.name;
    tag.style.background = TAG[move.typeKey] || TAG.normal;
    tag.style.fontSize = Math.max(11, Math.round(size * 0.1)) + "px";
    tag.classList.remove("on");
    void tag.offsetWidth;
    tag.classList.add("on");

    // 움직임 줄이기를 켠 사람에게는 이름만 보여 준다
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;

    moveBody(opts.body, (sig && sig.body) || cls, dir, TAG[move.typeKey] || TAG.normal);
    if ((move.power || 0) >= 100 && !(sig && sig.k === "quake")) setTimeout(() => shake("shake"), 260);
    // 돌진은 부딪히는 순간에, 특수는 기를 다 모은 순간에 터져야 한다.
    // 처음부터 터지면 맞기 전에 터진다. 몸 연출(pet.html)의 정점과 맞춘 값이다
    setTimeout(() => {
      // 전용 모양이 있으면 타입 입자는 거들기만 한다. 둘 다 세게 뿌리면 무슨 모양인지 안 보인다
      const amount = sig ? (sig.solo ? 0 : 0.5) : 1;
      if (sig) {
        spawnSig(sig.k, fx, cls, dir, scale, 0);
        // 한 번으로 끝나는 모양(방벽·눈빛·노래·잠)은 다시 뿌리지 않는다
        if (REPEAT.has(sig.k)) spawnSig(sig.k, fx, cls, dir, scale, WAVE);
      }
      spawn(fx, cls, dir, 0, amount, scale);
      spawn(fx, cls, dir, WAVE, amount, scale);
      endAt = performance.now() + DURATION;
      if (!raf) raf = requestAnimationFrame(step);
    }, cls === "physical" ? 250 : cls === "special" ? 560 : 250);
    return true;
  }

  /** 이름으로 어떤 전용 연출이 걸리는지. 점검용 */
  const sigOf = (name) => (SIGS.find((x) => x.re.test(name)) || {}).k || null;

  window.ptbMoves = { play, sigOf, SIGS, DURATION };
})();
