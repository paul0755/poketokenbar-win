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

  window.ptbEgg = { svg };
  // 키우는 아이 자리의 알 — 평범한 알, 진화 없는 종(전설의 알에서 온 아이)이면 전설의 알
  window.eggSvg = (size = 112, single = false) => svg(single ? "mythic" : "plain", size);
})();
