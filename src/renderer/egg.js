"use strict";
/**
 * 알 그림.
 *
 * 이모지(🥚)를 키워 쓰고 있었는데 흐릿하고 포켓몬 느낌도 안 났다.
 * PokéAPI에는 쓸 만한 알 스프라이트가 없다 —
 *   pokemon/0.png 는 "?" 플레이스홀더,
 *   items/mystery-egg.png 는 30x30이라 112px로 키우면 뭉갠다.
 * 그래서 SVG로 그린다. 어떤 크기에서도 선명하고 색도 테마에 맞출 수 있다.
 *
 * 상점의 알 셋도 여기서 그린다 — 셋 다 🥚 하나라 어느 게 비싼 알인지 그림으로는 몰랐다.
 *   plain   포켓몬 알  크림색 + 초록 점
 *   super   슈퍼 알    하늘색 + 흰 지그재그 띠 + 별
 *   legend  희귀 알    금빛 + 보라 왕관 무늬 + 반짝이(희귀도 색 #c084fc 와 맞춘다)
 *   mythic  전설의 알  진주빛 은색 + 무지개 띠 + 무지개 빛 — 희귀 알의 금빛과 한눈에 달라야 한다.
 *           박스 · 홈에서도 전설의 알은 이 그림이다(eggSvg 의 두 번째 인자)
 *
 * 쓰는 쪽: <div>${eggSvg(112)}</div> · 상점 아이콘은 window.ptbEgg.svg("super", 28)
 */
(function () {
  const SHAPE = "M50 4 C71 4 91 33 91 58 C91 82 72 99 50 99 C28 99 9 82 9 58 C9 33 29 4 50 4 Z";
  const KIND = {
    plain: {
      body: ["#fffaf0", "#f3e6cd", "#d9c8a8"], line: "#b9a684",
      deco: `<g fill="#7ec8a9" opacity=".92">
          <ellipse cx="30" cy="46" rx="11" ry="9"/>
          <ellipse cx="62" cy="34" rx="8" ry="6.5"/>
          <ellipse cx="70" cy="62" rx="12" ry="9.5"/>
          <ellipse cx="42" cy="74" rx="9" ry="7.5"/>
          <ellipse cx="18" cy="70" rx="7" ry="6"/>
        </g>`,
    },
    super: {
      body: ["#f2fbff", "#9fd8ff", "#4a9eff"], line: "#2f6fd6",
      // 가운데를 두르는 흰 지그재그 띠 — 깨지는 금처럼 보여 "곧 뭔가 나온다"는 느낌이 난다
      deco: `<path d="M0 52 L12 44 L24 54 L36 44 L48 54 L60 44 L72 54 L84 44 L100 54 L100 66 L84 56 L72 66 L60 56 L48 66 L36 56 L24 66 L12 56 L0 64 Z"
              fill="#fff" opacity=".9"/>
        <path d="M0 52 L12 44 L24 54 L36 44 L48 54 L60 44 L72 54 L84 44 L100 54" fill="none" stroke="#2f6fd6" stroke-width="2" stroke-linejoin="round" opacity=".55"/>
        <path d="M0 64 L12 56 L24 66 L36 56 L48 66 L60 56 L72 66 L84 56 L100 66" fill="none" stroke="#2f6fd6" stroke-width="2" stroke-linejoin="round" opacity=".55"/>
        <g fill="#fff">
          <path d="M62 22 l3 6.5 7 1 -5 5 1.2 7 -6.2 -3.3 -6.2 3.3 1.2 -7 -5 -5 7 -1 Z"/>
          <path d="M30 80 l2 4.4 4.8.7 -3.5 3.4.8 4.8 -4.1 -2.3 -4.1 2.3.8 -4.8 -3.5 -3.4 4.8 -.7 Z" opacity=".85"/>
        </g>
        <circle cx="74" cy="80" r="4" fill="#2f6fd6" opacity=".35"/>
        <circle cx="24" cy="32" r="3" fill="#2f6fd6" opacity=".3"/>`,
    },
    legend: {
      body: ["#fff8d6", "#ffd45e", "#e09a1f"], line: "#9a5c0c",
      // 아래 절반은 보라, 경계는 왕관처럼 뾰족하게
      deco: `<path d="M0 60 L16 48 L26 58 L38 42 L50 56 L62 42 L74 58 L84 48 L100 60 L100 104 L0 104 Z" fill="#8b4fd8"/>
        <path d="M0 60 L16 48 L26 58 L38 42 L50 56 L62 42 L74 58 L84 48 L100 60" fill="none" stroke="#fff3b0" stroke-width="2.5" stroke-linejoin="round"/>
        <circle cx="38" cy="42" r="3.4" fill="#fff3b0"/>
        <circle cx="62" cy="42" r="3.4" fill="#fff3b0"/>
        <circle cx="50" cy="76" r="7" fill="#c084fc" stroke="#fff3b0" stroke-width="2"/>
        <circle cx="48" cy="74" r="2.2" fill="#fff" opacity=".8"/>
        <path d="M60 18 l2 7 7 2 -7 2 -2 7 -2 -7 -7 -2 7 -2 Z" fill="#fff"/>`,
      // 알 밖까지 번지는 빛 — 비싼 알은 멀리서도 다르게 보여야 한다
      halo: ["#ffd45e", "#c084fc"],
    },
    mythic: {
      body: ["#ffffff", "#e4e9f2", "#9aa6bb"], line: "#5d6b84",
      rainbow: true,
      // 가운데를 비스듬히 두르는 무지개 띠와 위아래 은빛 물결
      deco: (u) => `<path d="M0 50 C25 38 75 62 100 48 L100 66 C75 80 25 56 0 68 Z" fill="url(#er-${u})" opacity=".95"/>
        <path d="M0 50 C25 38 75 62 100 48" fill="none" stroke="#fff" stroke-width="2.2" opacity=".9"/>
        <path d="M0 68 C25 56 75 80 100 66" fill="none" stroke="#fff" stroke-width="2.2" opacity=".9"/>
        <path d="M14 30 C30 24 44 30 58 24" fill="none" stroke="#b9c3d6" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M30 86 C44 80 58 86 74 80" fill="none" stroke="#b9c3d6" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M66 22 l2 7 7 2 -7 2 -2 7 -2 -7 -7 -2 7 -2 Z" fill="#fff"/>
        <circle cx="50" cy="58" r="5" fill="#fff" stroke="#5d6b84" stroke-width="1.5"/>`,
      halo: ["#a5f3fc", "#f0abfc"],
    },
  };

  let n = 0;
  /** svg 한 장. uid 는 한 문서에 여러 개 있어도 그라데이션 · clipPath id 가 겹치지 않게 */
  function svg(kind = "plain", size = 112) {
    const k = KIND[kind] || KIND.plain;
    const u = `${kind}${++n}`;
    return `
<svg viewBox="0 0 100 104" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" class="eggsvg egg-${kind}" aria-hidden="true">
  <defs>
    <radialGradient id="eb-${u}" cx="38%" cy="30%" r="78%">
      <stop offset="0%" stop-color="${k.body[0]}"/>
      <stop offset="62%" stop-color="${k.body[1]}"/>
      <stop offset="100%" stop-color="${k.body[2]}"/>
    </radialGradient>
    <!-- 무늬가 알 밖으로 새지 않게 잘라낸다 -->
    <clipPath id="ec-${u}"><path d="${SHAPE}"/></clipPath>
    <!-- 둥근 그림자 — 무늬 위에 덮어야 무늬도 알 표면을 따라 휘어 보인다 -->
    <radialGradient id="es-${u}" cx="36%" cy="28%" r="80%">
      <stop offset=".5" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity=".26"/>
    </radialGradient>
    ${k.halo ? `<radialGradient id="eh-${u}"><stop offset=".45" stop-color="${k.halo[0]}" stop-opacity=".55"/><stop offset="1" stop-color="${k.halo[1]}" stop-opacity="0"/></radialGradient>` : ""}
    ${k.rainbow ? `<linearGradient id="er-${u}" x1="0" x2="1">${["#ff6b6b", "#ffb347", "#ffe66d", "#7ee08a", "#5ec8ff", "#a78bfa", "#f472b6"].map((c, j) => `<stop offset="${j / 6}" stop-color="${c}"/>`).join("")}</linearGradient>` : ""}
  </defs>
  ${k.halo ? `<circle class="egg-halo" cx="50" cy="54" r="50" fill="url(#eh-${u})"/>` : ""}
  <ellipse cx="50" cy="99" rx="26" ry="4" fill="rgba(0,0,0,.28)"/>
  <path d="${SHAPE}" fill="url(#eb-${u})"/>
  <g clip-path="url(#ec-${u})">${typeof k.deco === "function" ? k.deco(u) : k.deco}<path d="${SHAPE}" fill="url(#es-${u})"/></g>
  <path d="${SHAPE}" fill="none" stroke="${k.line}" stroke-width="2.5"/>
  <!-- 광택. 있으면 평평한 타원이 아니라 알로 보인다 -->
  <ellipse cx="36" cy="28" rx="9" ry="13" fill="#fff" opacity=".5" transform="rotate(-20 36 28)"/>
  ${k.halo ? `<g class="egg-spark" fill="#fff">
    <path d="M88 14 l1.6 5 5 1.6 -5 1.6 -1.6 5 -1.6 -5 -5 -1.6 5 -1.6 Z"/>
    <path d="M10 26 l1.2 3.6 3.6 1.2 -3.6 1.2 -1.2 3.6 -1.2 -3.6 -3.6 -1.2 3.6 -1.2 Z"/>
    <path d="M90 74 l1 3 3 1 -3 1 -1 3 -1 -3 -3 -1 3 -1 Z"/>
  </g>` : ""}
</svg>`;
  }

  /* ---------------- 🦖 디지타마 — 깨어날 성장기마다 무늬가 다르다 ----------------
   * 메인(worlds/digimon.js)이 { h: 바탕 색상, a: 무늬 색상, m: 무늬 } 를 준다. 색은 여기서 HSL 로 푼다 */
  const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;
  const star = (cx, cy, r) => {
    const p = [];
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r, t = (Math.PI / 5) * i - Math.PI / 2;
      p.push(`${(cx + rr * Math.cos(t)).toFixed(1)} ${(cy + rr * Math.sin(t)).toFixed(1)}`);
    }
    return `<path d="M${p.join(" L")} Z"/>`;
  };
  const heart = (cx, cy, r) =>
    `<path d="M${cx} ${cy + r * 0.9} C${cx - r * 1.5} ${cy - r * 0.2} ${cx - r * 0.7} ${cy - r * 1.3} ${cx} ${cy - r * 0.45} C${cx + r * 0.7} ${cy - r * 1.3} ${cx + r * 1.5} ${cy - r * 0.2} ${cx} ${cy + r * 0.9} Z"/>`;
  const MOTIF = {
    stripes: () => [26, 52, 78].map((y) => `<path d="M-2 ${y} C18 ${y - 9} 32 ${y + 9} 50 ${y} C68 ${y - 9} 82 ${y + 9} 102 ${y} L102 ${y + 9} C82 ${y + 18} 68 ${y} 50 ${y + 9} C32 ${y + 18} 18 ${y} -2 ${y + 9} Z"/>`).join(""),
    stars: () => star(32, 40, 15) + star(68, 30, 11) + star(62, 72, 16) + star(24, 80, 9),
    rings: () => `<g fill="none" stroke-width="7"><circle cx="30" cy="52" r="17"/><circle cx="72" cy="36" r="12"/><circle cx="66" cy="80" r="13"/></g>`,
    hearts: () => heart(32, 44, 13) + heart(68, 34, 10) + heart(60, 76, 15) + heart(22, 82, 8),
    bands: () => `<rect x="0" y="34" width="100" height="12"/><rect x="0" y="56" width="100" height="7"/><rect x="0" y="74" width="100" height="12"/>`,
    spots: () => `<ellipse cx="28" cy="40" rx="13" ry="11"/><ellipse cx="68" cy="30" rx="9" ry="8"/><ellipse cx="66" cy="66" rx="15" ry="12"/><ellipse cx="34" cy="80" rx="10" ry="8"/><ellipse cx="86" cy="52" rx="6" ry="6"/>`,
    triangles: () => `<path d="M14 30 L40 30 L27 52 Z"/><path d="M56 44 L86 44 L71 70 Z"/><path d="M22 66 L46 66 L34 88 Z"/><path d="M62 12 L78 12 L70 26 Z"/>`,
    zigzag: () => `<path d="M-2 46 L14 32 L30 46 L46 32 L62 46 L78 32 L94 46 L102 40 L102 60 L94 66 L78 52 L62 66 L46 52 L30 66 L14 52 L-2 66 Z"/>`,
    diamonds: () => [[26, 34], [58, 26], [44, 58], [76, 56], [30, 84], [64, 86]].map(([x, y]) => `<path d="M${x} ${y - 11} L${x + 8} ${y} L${x} ${y + 11} L${x - 8} ${y} Z"/>`).join(""),
    flames: () => `<path d="M-2 104 L-2 70 C8 76 10 58 18 50 C20 62 26 66 30 60 C34 50 32 40 40 32 C42 48 50 56 54 50 C58 44 56 36 62 30 C66 44 72 54 78 52 C82 50 82 42 88 38 C90 52 96 60 102 62 L102 104 Z"/>`,
    waves: () => [18, 42, 66].map((x) => `<path d="M${x} -2 C${x + 10} 14 ${x - 10} 30 ${x} 46 C${x + 10} 62 ${x - 10} 78 ${x} 94 L${x} 106 L${x + 10} 106 L${x + 10} 94 C${x} 78 ${x + 20} 62 ${x + 10} 46 C${x} 30 ${x + 20} 14 ${x + 10} -2 Z"/>`).join(""),
  };

  function digi(e, size = 112) {
    const u = `dg${++n}`;
    const m = MOTIF[e.m] || MOTIF.spots;
    const deco = m();
    const ring = e.m === "rings";
    return `
<svg viewBox="0 0 100 104" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" class="eggsvg egg-digi" aria-hidden="true">
  <defs>
    <radialGradient id="eb-${u}" cx="38%" cy="30%" r="78%">
      <stop offset="0%" stop-color="${hsl(e.h, 85, 95)}"/>
      <stop offset="62%" stop-color="${hsl(e.h, 70, 80)}"/>
      <stop offset="100%" stop-color="${hsl(e.h, 55, 60)}"/>
    </radialGradient>
    <clipPath id="ec-${u}"><path d="${SHAPE}"/></clipPath>
    <radialGradient id="es-${u}" cx="36%" cy="28%" r="80%">
      <stop offset=".5" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity=".26"/>
    </radialGradient>
  </defs>
  <ellipse cx="50" cy="99" rx="26" ry="4" fill="rgba(0,0,0,.28)"/>
  <path d="${SHAPE}" fill="url(#eb-${u})"/>
  <g clip-path="url(#ec-${u})"><g ${ring ? `stroke="${hsl(e.a, 65, 52)}"` : `fill="${hsl(e.a, 65, 52)}"`} opacity=".9">${deco}</g><path d="${SHAPE}" fill="url(#es-${u})"/></g>
  <path d="${SHAPE}" fill="none" stroke="${hsl(e.h, 45, 38)}" stroke-width="2.5"/>
  <ellipse cx="36" cy="28" rx="9" ry="13" fill="#fff" opacity=".5" transform="rotate(-20 36 28)"/>
</svg>`;
  }

  /* ---------------- 🦖 디지코드 알 — 상점의 디지타마. 무엇이 나올지 모른다 ----------------
   * 디지몬 세계의 글자처럼 각진 기호를 알 모양으로 채운다. 기호는 이 앱이 만든 모양이다(원작 글꼴이 아니다) —
   * 3 × 4 점 위에 선 두세 개를 긋는다. 씨앗이 고정이라 그릴 때마다 같은 알이고, 줄마다 깜박임이 어긋난다 */
  const GLYPHS = (() => {
    let s = 20231105;
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
    const pt = (i) => [(i % 3) * 2.1, Math.floor(i / 3) * 1.8]; // 4.2 × 5.4 — 글자 사이가 떠야 미로가 아니라 글자로 보인다
    return Array.from({ length: 24 }, () => {
      const segs = [];
      const k = 2 + Math.floor(rnd() * 2);
      for (let j = 0; j < k; j++) {
        let a = Math.floor(rnd() * 12), b = Math.floor(rnd() * 12);
        if (a === b) b = (b + 4) % 12;
        const [x1, y1] = pt(a), [x2, y2] = pt(b);
        // 각진 글자 — 대각선은 꺾어서 가로 · 세로로만
        segs.push(`M${x1} ${y1} L${x2} ${y1} L${x2} ${y2}`);
      }
      return segs.join(" ");
    });
  })();
  function digicode(size = 112) {
    const u = `dc${++n}`;
    const rows = [];
    let g = 0;
    for (let r = 0; r < 11; r++) {
      const y = 9 + r * 8.8;
      const cells = [];
      for (let c = 0; c < 11; c++) {
        const x = 7 + c * 8 + (r % 2 ? 3.5 : 0);
        const dim = (g * 13 + r * 7) % 5 === 0 ? ' opacity=".45"' : ""; // 몇 글자는 흐리게 — 화면 글자처럼
        cells.push(`<path transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" d="${GLYPHS[(g++ * 7 + r * 5) % GLYPHS.length]}"${dim}/>`);
      }
      rows.push(`<g class="dc-row" style="animation-delay:${((r * 0.37) % 2.2).toFixed(2)}s">${cells.join("")}</g>`);
    }
    return `
<svg viewBox="0 0 100 104" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" class="eggsvg egg-digicode" aria-hidden="true">
  <defs>
    <radialGradient id="eb-${u}" cx="40%" cy="32%" r="80%">
      <stop offset="0%" stop-color="#16402f"/>
      <stop offset="70%" stop-color="#0a2219"/>
      <stop offset="100%" stop-color="#04110c"/>
    </radialGradient>
    <clipPath id="ec-${u}"><path d="${SHAPE}"/></clipPath>
  </defs>
  <circle class="egg-halo" cx="50" cy="54" r="50" fill="#38ffb0" opacity=".10"/>
  <ellipse cx="50" cy="99" rx="26" ry="4" fill="rgba(0,0,0,.28)"/>
  <path d="${SHAPE}" fill="url(#eb-${u})"/>
  <g clip-path="url(#ec-${u})" fill="none" stroke="#3dffb4" stroke-width="1" stroke-linecap="square">${rows.join("")}
    <rect class="dc-scan" x="0" y="0" width="100" height="10" fill="#3dffb4" stroke="none" opacity=".12"/>
  </g>
  <path d="${SHAPE}" fill="none" stroke="#3dffb4" stroke-width="2" opacity=".85"/>
  <text x="50" y="62" text-anchor="middle" font-size="26" font-weight="800" fill="#eafff6" stroke="#04110c" stroke-width="3" paint-order="stroke" font-family="Segoe UI, sans-serif">?</text>
</svg>`;
  }

  /* ---------------- 🦖 진화 캡슐 — 상점의 이상한사탕 자리. 반은 빛나는 데이터, 반은 금속 ---------------- */
  function capsule(size = 34) {
    const u = `cp${++n}`;
    return `
<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" class="capsvg" aria-hidden="true">
  <defs>
    <linearGradient id="cg-${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9dffd8"/><stop offset=".5" stop-color="#2fe3a0"/><stop offset="1" stop-color="#0c8a5e"/></linearGradient>
    <linearGradient id="cm-${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8ecf4"/><stop offset=".45" stop-color="#9aa3b5"/><stop offset="1" stop-color="#4c5468"/></linearGradient>
    <clipPath id="cc-${u}"><rect x="12" y="34" width="38" height="32" rx="16"/></clipPath>
  </defs>
  <circle cx="50" cy="50" r="44" fill="#3dffb4" opacity=".12"/>
  <g transform="rotate(-35 50 50)">
    <rect x="12" y="34" width="76" height="32" rx="16" fill="#04110c" opacity=".35" transform="translate(2 4)"/>
    <path d="M50 34 H72 A16 16 0 0 1 72 66 H50 Z" fill="url(#cm-${u})" stroke="#2c3242" stroke-width="2"/>
    <path d="M28 34 H50 V66 H28 A16 16 0 0 1 28 34 Z" fill="url(#cg-${u})" stroke="#0a6b48" stroke-width="2"/>
    <g clip-path="url(#cc-${u})" stroke="#e8fff6" stroke-width="2" fill="none" opacity=".75">
      <path d="M20 44 h5 v4 M30 42 h4 v6 h-4 M38 46 h5 M22 56 v-3 h6 M33 54 h6 v4 M42 52 v6"/>
    </g>
    <rect x="49" y="34" width="3" height="32" fill="#2c3242"/>
    <ellipse cx="30" cy="40" rx="10" ry="3" fill="#fff" opacity=".55"/>
    <ellipse cx="68" cy="40" rx="9" ry="2.6" fill="#fff" opacity=".6"/>
  </g>
  <path d="M80 14 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2 Z" fill="#eafff6"/>
</svg>`;
  }

  window.ptbEgg = { svg: (kind, size) => (kind === "digicode" ? digicode(size) : svg(kind, size)), digi, digicode, capsule };
  // 키우는 아이 자리의 알 — 평범한 알, 진화 없는 종(전설의 알에서 온 아이)이면 전설의 알.
  // 🦖 디지타마 무늬(egg)가 오면 그 무늬로
  window.eggSvg = (size = 112, single = false, egg = null) => (egg ? digi(egg, size) : svg(single ? "mythic" : "plain", size));
})();
