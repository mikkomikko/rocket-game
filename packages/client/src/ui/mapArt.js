import { mulberry32 } from '../util/math.js';

/* Map pictures for the All maps picker: one small SVG drawing per map, in a 180 × 110 box. */
const svgPts = (pts, dx = 0, dy = 0, ang = 0) => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return pts.map(([x, y]) => `${(x * c - y * s + dx).toFixed(1)},${(x * s + y * c + dy).toFixed(1)}`).join(' ');
};
const artPoly = (pts, fill, dx = 0, dy = 0, ang = 0) => `<polygon points="${svgPts(pts, dx, dy, ang)}" fill="${fill}"/>`;
function artStarPath(cx, cy, R, r) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R;
    d += (i ? 'L' : 'M') + (cx + Math.cos(a) * rr).toFixed(1) + ' ' + (cy + Math.sin(a) * rr).toFixed(1);
  }
  return d + 'Z';
}
function artStars(n, seed, maxY = 110) {
  const rng = mulberry32(seed);
  let s = '';
  for (let i = 0; i < n; i++) s += `<circle cx="${(rng() * 180).toFixed(1)}" cy="${(rng() * maxY).toFixed(1)}" r="${(0.5 + rng() * 0.9).toFixed(2)}" fill="#e8e6ff" opacity="${(0.35 + rng() * 0.6).toFixed(2)}"/>`;
  return s;
}
const artRocket = (x, y, a, c, s = 0.75) => `<g transform="translate(${x} ${y}) rotate(${a}) scale(${s})"><path d="M-3.5 7 L0 19 L3.5 7Z" fill="#ff8f3d"/><path d="M-1.6 7 L0 13 L1.6 7Z" fill="#fff1c2"/><path d="M0 -12 L8 8 L0 4.5 L-8 8Z" fill="${c}"/><path d="M0 -6 L2.6 1 L-2.6 1Z" fill="#1b1640"/></g>`;
export const svgWrap = (id, body) => `<svg viewBox="0 0 180 110" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMid slice">${body}</svg>`;

// The cyan T-rex, in the same proportions as the one in the game (y up, feet at 0).
function artDino(x, y, s) {
  const B = '#2fe6f0', F = '#1aa3b4';
  let g = `<g transform="translate(${x} ${y}) scale(${s} ${-s})">`;
  g += artPoly([[-12, 33], [-5, 38], [1, 33], [0, 23], [-6, 15], [-10, 16], [-12, 24]], F);
  g += artPoly([[-8, 17], [-4, 15], [-12, 5], [-15, 6]], F) + artPoly([[-16, 4], [-12, 4], [-6, 0], [-17, 0]], F);
  g += artPoly([[0, 0], [5, -3], [7, -6], [5, -7], [3, -4], [-1, -2]], F, 21, 38);
  g += artPoly([[-50, 31], [-34, 36], [-16, 41], [0, 45], [12, 48], [20, 54], [27, 52], [24, 42], [16, 32], [6, 26], [-6, 25], [-20, 28], [-36, 30]], B);
  for (const [cx, cy, r] of [[-34, 33.5, 3.2], [-22, 37, 3.6], [-10, 40.5, 3.8], [2, 43, 3.4]]) g += `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${(r * 0.55).toFixed(2)}" fill="#1cb8c8"/>`;
  g += artPoly([[3, 1.5], [22, 2], [20, -6], [6, -5]], '#0b3640', 22, 50);
  g += artPoly([[-6, 4], [0, 11], [10, 13], [19, 10], [23, 6], [22, 2], [12, 1], [2, 0], [-5, -2]], B, 22, 50);
  for (let tx = 8; tx <= 20; tx += 3) g += artPoly([[tx, 1.4], [tx + 1.6, 1.4], [tx + 0.8, -1.8]], '#f4fbff', 22, 50);
  const jawAng = -0.5;
  g += artPoly([[-1, 0.8], [8, 0.9], [17, 0.8], [16, -2], [8, -5], [0, -4], [-2, -1]], B, 26, 50.5, jawAng);
  for (let tx = 5; tx <= 15; tx += 3) g += artPoly([[tx, 0.6], [tx + 1.4, 0.6], [tx + 0.7, 3]], '#f4fbff', 26, 50.5, jawAng);
  g += `<circle cx="31" cy="58" r="2.6" fill="#000000"/>`;
  g += artPoly([[-9, 33], [-2, 38], [5, 33], [4, 23], [1, 15], [-3, 14], [-7, 21]], B);
  g += artPoly([[-2, 16], [3, 16], [6, 4], [2, 3]], B) + artPoly([[1, 4.5], [6, 4.5], [13, 0], [0, 0]], B);
  g += artPoly([[0, 0], [5, -3], [7, -6], [5, -7], [3, -4], [-1, -2]], B, 18, 37);
  return g + '</g>';
}
function artAraucaria(x, base, h, trunk, green) {
  let g = `<rect x="${x - 2}" y="${base - h}" width="4" height="${h}" fill="${trunk}"/>`;
  for (let i = 0; i < 5; i++) {
    const yy = base - h * 0.45 - i * h * 0.12, len = 22 - i * 3.5;
    for (const sd of [-1, 1]) {
      g += `<path d="M${x} ${yy} Q ${x + sd * len * 0.6} ${yy + 3} ${x + sd * len} ${yy - 4}" stroke="${green}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
      g += `<ellipse cx="${x + sd * len}" cy="${yy - 5}" rx="4" ry="3" fill="${green}"/>`;
    }
  }
  return g + `<ellipse cx="${x}" cy="${base - h - 2}" rx="5" ry="4" fill="${green}"/>`;
}
function artFern(x, base, h) {
  let g = `<path d="M${x} ${base} Q ${x + 2} ${base - h / 2} ${x - 1} ${base - h}" stroke="#5a4128" stroke-width="4" fill="none"/>`;
  for (let j = 0; j < 7; j++) {
    const a = Math.PI * (0.08 + 0.84 * j / 6), len = 20;
    const ex = x - 1 + Math.cos(a) * len, ey = base - h - Math.sin(a) * len * 0.7 + 9 * (1 - Math.sin(a) * 0.6);
    g += `<path d="M${x - 1} ${base - h} Q ${(x - 1 + Math.cos(a) * len * 0.5).toFixed(1)} ${(base - h - Math.sin(a) * len * 0.75).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}" stroke="#3aa14c" stroke-width="3" fill="none" stroke-linecap="round" stroke-dasharray="3 1.2"/>`;
  }
  return g;
}

export const MAP_ART = {
  cave: () => svgWrap('cave', `
    <defs><linearGradient id="artCaveRock" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a1f4e"/><stop offset="1" stop-color="#b8633f"/></linearGradient></defs>
    <rect width="180" height="110" fill="url(#artCaveRock)"/>
    <path d="M18 102 C 18 44, 58 16, 90 16 C 122 16, 162 44, 162 102 Z" fill="#120f2e"/>
    <path d="M18 102 C 18 44, 58 16, 90 16 C 122 16, 162 44, 162 102" fill="none" stroke="#f0a35e" stroke-width="2" opacity="0.55"/>
    ${artStars(10, 5, 60).replace(/opacity="[^"]+"/g, 'opacity="0.25"')}
    <polygon points="44,36 54,30 50,56" fill="#6e3654"/><polygon points="70,22 82,19 77,48" fill="#6e3654"/>
    <polygon points="98,18 110,20 104,42" fill="#6e3654"/><polygon points="124,28 134,33 128,54" fill="#6e3654"/>
    <polygon points="36,102 50,102 43,78" fill="#9a4f45"/><polygon points="118,102 134,102 126,72" fill="#9a4f45"/>
    <polygon points="92,102 100,102 96,88" fill="#9a4f45"/>
    <rect y="100" width="180" height="10" fill="#b8633f"/>
    ${artRocket(78, 62, 35, '#ffe066')}`),
  clear: () => svgWrap('clear', `
    <defs><radialGradient id="artClearGlow"><stop offset="0" stop-color="#ffe066" stop-opacity="0.55"/><stop offset="1" stop-color="#ffe066" stop-opacity="0"/></radialGradient></defs>
    <rect width="180" height="110" fill="#0b0a24"/>
    ${artStars(34, 11)}
    <circle cx="90" cy="55" r="48" fill="url(#artClearGlow)"/>
    <path d="${artStarPath(90, 57, 32, 13)}" fill="#ffe066" stroke="#fff6c8" stroke-width="2" stroke-linejoin="round"/>
    <path d="${artStarPath(90, 57, 20, 8)}" fill="#fff1a8" opacity="0.6"/>
    <rect x="3" y="3" width="174" height="104" rx="4" fill="none" stroke="#2b2650" stroke-width="6"/>`),
  open: () => svgWrap('open', `
    <defs><linearGradient id="artOpenSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1b4a"/><stop offset="1" stop-color="#0b1230"/></linearGradient></defs>
    <rect width="180" height="110" fill="url(#artOpenSky)"/>
    ${artStars(18, 23, 70)}
    <circle cx="150" cy="22" r="10" fill="#f3e6c4"/><circle cx="154" cy="19" r="9" fill="#2a1b4a"/>
    <path d="M38 38 Q 58 26 78 38 Q 70 44 62 56 Q 56 46 38 38Z" fill="#8a4a4f"/><path d="M38 38 Q 58 26 78 38" stroke="#f0a35e" stroke-width="2" fill="none"/>
    <path d="M100 56 Q 116 47 132 56 Q 124 61 118 72 Q 112 62 100 56Z" fill="#8a4a4f"/><path d="M100 56 Q 116 47 132 56" stroke="#f0a35e" stroke-width="2" fill="none"/>
    <path d="M14 68 Q 24 62 34 68 Q 28 72 24 80 Q 20 72 14 68Z" fill="#7a3d55"/>
    <path d="M0 92 Q 30 82 60 90 T 120 88 T 180 90 V110 H0Z" fill="#9a4f45"/>
    ${artRocket(140, 40, -40, '#6ee7ff')}`),
  forest: () => svgWrap('forest', `
    <defs><linearGradient id="artForestSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#301c40"/><stop offset="1" stop-color="#0b2a28"/></linearGradient></defs>
    <rect width="180" height="110" fill="url(#artForestSky)"/>
    ${artStars(14, 41, 50)}
    <circle cx="36" cy="22" r="13" fill="#f2cf9c"/><circle cx="32" cy="19" r="3" fill="#d9b07c"/><circle cx="41" cy="27" r="2" fill="#d9b07c"/>
    <circle cx="96" cy="14" r="5" fill="#9fe0db"/>
    ${artAraucaria(18, 90, 52, '#143633', '#143633')}${artAraucaria(70, 90, 44, '#143633', '#143633')}${artAraucaria(118, 90, 56, '#143633', '#143633')}
    <path d="M0 88 Q 45 80 90 86 T 180 84 V110 H0Z" fill="#3f2f20"/>
    <path d="M0 88 Q 45 80 90 86 T 180 84" fill="none" stroke="#3c8c3a" stroke-width="3"/>
    ${artAraucaria(152, 86, 64, '#5a4128', '#1f6b3f')}
    ${artFern(22, 88, 24)}
    <path d="M118 88 l-3 -12 M121 88 l0 -15 M124 88 l3 -11" stroke="#7fae45" stroke-width="2"/>
    ${artDino(80, 88, 0.62)}`),
  desert: () => svgWrap('desert', `
    <defs><linearGradient id="artDesertSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#24133a"/><stop offset="0.55" stop-color="#8a3f55"/><stop offset="1" stop-color="#f28c4c"/></linearGradient></defs>
    <rect width="180" height="110" fill="url(#artDesertSky)"/>
    ${artStars(10, 97, 30)}
    <circle cx="150" cy="66" r="22" fill="#ffd08a" opacity="0.35"/><circle cx="150" cy="66" r="14" fill="#fff0c4"/>
    <ellipse cx="96" cy="18" rx="17" ry="4.5" fill="none" stroke="#efd3b0" stroke-width="2" transform="rotate(-18 96 18)"/>
    <circle cx="96" cy="18" r="7.5" fill="#9cc6d8"/>
    <path d="M89 22 A17 4.5 -18 0 0 113 13" fill="none" stroke="#efd3b0" stroke-width="2"/>
    <polygon points="14,110 22,44 46,44 54,110" fill="#9a5a44"/><rect x="22" y="44" width="24" height="4" fill="#c98a5e"/>
    <path d="M0 92 Q 30 80 60 89 T 120 87 T 180 89 V110 H0Z" fill="#d9a066"/>
    <path d="M0 92 Q 30 80 60 89 T 120 87 T 180 89" fill="none" stroke="#f5d29a" stroke-width="2"/>
    <path d="M80 92 Q 98 18 122 52" fill="none" stroke="#c98f6b" stroke-width="11" stroke-linecap="round"/>
    <path d="M80 92 Q 98 18 122 52" fill="none" stroke="#a5674c" stroke-width="11" stroke-dasharray="3 5"/>
    <circle cx="122" cy="52" r="8" fill="#b8735a"/>
    <ellipse cx="126" cy="57" rx="2.8" ry="6" fill="#a8384e" transform="rotate(-36 126 57)"/>
    <ellipse cx="126.4" cy="57.4" rx="1.8" ry="4.4" fill="#3a0f1c" transform="rotate(-36 126.4 57.4)"/>
    <circle cx="74" cy="88" r="2" fill="#f5d29a"/><circle cx="86" cy="84" r="1.6" fill="#f5d29a"/><circle cx="79" cy="80" r="1.3" fill="#f5d29a"/>
    <rect x="162" y="62" width="6" height="28" rx="3" fill="#3f8f52"/>
    <path d="M162 76 h-5 v-8" fill="none" stroke="#3f8f52" stroke-width="4" stroke-linecap="round"/><path d="M168 72 h5 v-7" fill="none" stroke="#3f8f52" stroke-width="4" stroke-linecap="round"/>
    ${artRocket(140, 30, -40, '#6ee7ff')}`),
  hangar: () => svgWrap('hangar', `
    <rect width="180" height="110" fill="#14152a"/>
    <path d="${Array.from({ length: 7 }, (_, i) => `M${i * 30} 8V102`).join('')}M0 40H180M0 72H180" stroke="#22243e" stroke-width="1.5"/>
    <rect y="0" width="180" height="8" fill="#3a3e52"/><rect y="102" width="180" height="8" fill="#3a3e52"/>
    <rect x="96" y="6" width="38" height="4" fill="#ffb020"/>
    <path d="M8 98 L60 98 L70 92 L62 84 L44 80 L14 80 Z" fill="#d8dbe6"/><rect x="18" y="88" width="34" height="2" fill="#3d7bff"/>
    <path d="M70 30 L104 30 L110 34 L104 38 L70 38 L66 34 Z" fill="#e8a23a"/><rect x="80" y="8" width="2" height="22" fill="#4a5068"/><rect x="94" y="8" width="2" height="22" fill="#4a5068"/>
    <g transform="translate(138 102)">
      <rect x="-14" y="-38" width="7" height="34" fill="#3f465e"/><rect x="7" y="-38" width="7" height="34" fill="#3f465e"/>
      <rect x="-17" y="-5" width="13" height="5" fill="#3f465e"/><rect x="5" y="-5" width="13" height="5" fill="#3f465e"/>
      <rect x="-14" y="-46" width="28" height="9" fill="#272c3e"/>
      <polygon points="-22,-46 22,-46 26,-80 -26,-80" fill="#7a83a0"/><polygon points="-18,-48 18,-48 21,-78 -21,-78" fill="#a3abc4"/>
      <rect x="-8" y="-66" width="16" height="12" fill="#121522"/><rect x="-8" y="-66" width="16" height="12" fill="#ff2b3d" opacity="0.35"/>
      <rect x="-12" y="-96" width="24" height="15" fill="#7a83a0"/><rect x="-10" y="-92" width="20" height="7" fill="#121522"/>
      <circle cx="-4" cy="-88.5" r="2.6" fill="#ff2b3d"/>
      <circle cx="-26" cy="-76" r="6" fill="#3f465e"/><circle cx="26" cy="-76" r="6" fill="#3f465e"/>
      <rect x="-60" y="-80" width="34" height="7" fill="#7a83a0" transform="rotate(-18 -26 -76)"/>
      <rect x="-70" y="-86" width="12" height="12" fill="#a3abc4" transform="rotate(-18 -26 -76)"/>
      <rect x="22" y="-72" width="6" height="30" fill="#7a83a0"/><rect x="19" y="-44" width="12" height="11" fill="#a3abc4"/>
    </g>
    <path d="M134 13.5 L60 50" stroke="#ff2b3d" stroke-width="3" opacity="0.85"/><path d="M134 13.5 L60 50" stroke="#fff1f1" stroke-width="1"/>
    <path d="${artStarPath(60, 50, 6, 2.5)}" fill="#ffb020"/>
    ${artRocket(48, 58, 60, '#ffe066', 0.7)}${artRocket(30, 40, 70, '#6ee7ff', 0.7)}
    <g transform="translate(150 52)">${'<path d="M0 -4 L4 3 L-4 3Z" fill="#ff4d5e"/>'}</g><g transform="translate(160 62)"><path d="M0 -4 L4 3 L-4 3Z" fill="#ff4d5e"/></g>`),
  pillars: () => svgWrap('pillars', `
    <defs><linearGradient id="artPillar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b8633f"/><stop offset="1" stop-color="#6e3654"/></linearGradient></defs>
    <rect width="180" height="110" fill="#120f2e"/>
    ${artStars(16, 57)}
    <rect x="30" y="-8" width="16" height="66" rx="8" fill="url(#artPillar)"/>
    <rect x="66" y="42" width="16" height="70" rx="8" fill="url(#artPillar)"/>
    <rect x="102" y="-8" width="16" height="74" rx="8" fill="url(#artPillar)"/>
    <rect x="138" y="38" width="16" height="74" rx="8" fill="url(#artPillar)"/>
    <rect y="102" width="180" height="8" fill="#9a4f45"/>
    <path d="M10 30 C 40 92, 58 92, 74 30 S 110 92, 128 86 S 150 20, 172 26" fill="none" stroke="#ffe066" stroke-width="1.6" stroke-dasharray="3 4" opacity="0.6"/>
    ${artRocket(92, 34, 40, '#ffe066')}`),
  maze: () => svgWrap('maze', `
    <rect width="180" height="110" fill="#7a3d55"/>
    <path d="M18 20 H70 V50 H36 V86 H96 V58 H134 V20 H104 M134 58 V90 H162 M70 20 H96 V40 M162 90 V40 H150" fill="none" stroke="#120f2e" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="3" y="3" width="174" height="104" rx="4" fill="none" stroke="#2b2650" stroke-width="6"/>
    ${artRocket(30, 20, 90, '#ffe066', 0.6)}${artRocket(150, 90, -90, '#6ee7ff', 0.6)}`),
  divide: () => svgWrap('divide', `
    <rect width="180" height="110" fill="#120f2e"/>
    ${artStars(16, 71)}
    <rect y="100" width="180" height="10" fill="#9a4f45"/>
    <rect x="84" y="0" width="12" height="20" fill="#8a4a4f"/><rect x="84" y="34" width="12" height="14" fill="#8a4a4f"/>
    <rect x="84" y="62" width="12" height="14" fill="#8a4a4f"/><rect x="84" y="90" width="12" height="20" fill="#8a4a4f"/>
    <ellipse cx="50" cy="30" rx="9" ry="6" fill="#7a3d55"/><ellipse cx="130" cy="30" rx="9" ry="6" fill="#7a3d55"/>
    <ellipse cx="58" cy="78" rx="7" ry="5" fill="#7a3d55"/><ellipse cx="122" cy="78" rx="7" ry="5" fill="#7a3d55"/>
    ${artRocket(40, 56, 90, '#ffe066')}${artRocket(140, 56, -90, '#6ee7ff')}`),
  floors: () => svgWrap('floors', `
    <defs>
      <linearGradient id="artFloorsGlow" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff6a1a" stop-opacity="0.8"/><stop offset="0.6" stop-color="#ff6a1a" stop-opacity="0"/></linearGradient>
      <linearGradient id="artFloorsLava" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd25a"/><stop offset="0.35" stop-color="#ff7a1a"/><stop offset="1" stop-color="#8a1206"/></linearGradient>
    </defs>
    <rect width="180" height="110" fill="#120f2e"/>
    ${artStars(10, 83, 70)}
    <rect x="0" y="0" width="34" height="110" fill="#3a3e52"/><rect x="146" y="0" width="34" height="110" fill="#3a3e52"/>
    <path d="M34 0 V110 M146 0 V110" stroke="#5a5f7a" stroke-width="2"/>
    <path d="M0 26 H34 M0 58 H34 M146 26 H180 M146 58 H180" stroke="#2a2d3d" stroke-width="2"/>
    <rect x="34" y="18" width="60" height="10" fill="#1d1a2c"/>
    ${[36, 46, 56, 66, 76, 86].map((x) => `<polygon points="${x},28 ${x + 4},28 ${x + 8},18 ${x + 4},18" fill="#ffcc33"/>`).join('')}
    <rect width="180" height="110" fill="url(#artFloorsGlow)"/>
    ${artRocket(112, 50, 0, '#ffe066', 1.1)}
    <path d="M0 110 V84 Q 12 70 22 82 Q 30 62 42 80 Q 52 66 60 82 Q 72 58 84 80 Q 94 68 104 82 Q 116 60 126 80 Q 136 70 146 82 Q 160 62 170 80 Q 176 74 180 78 V110Z" fill="url(#artFloorsLava)"/>
    <path d="M0 110 V94 Q 14 86 24 94 Q 36 80 48 92 Q 60 84 70 94 Q 84 78 96 92 Q 108 84 118 94 Q 132 80 144 92 Q 158 84 168 94 Q 174 90 180 92 V110Z" fill="#ffd25a" opacity="0.85"/>
    <circle cx="40" cy="64" r="1.6" fill="#ffb347"/><circle cx="78" cy="52" r="1.3" fill="#ffd25a"/><circle cx="132" cy="58" r="1.7" fill="#ff8a3d"/><circle cx="158" cy="48" r="1.2" fill="#ffd25a"/>`),
  starship: () => svgWrap('starship', `
    <rect width="180" height="110" fill="#15142a"/>
    <path d="M0 40 H180 M0 72 H180 M45 0 V110 M90 0 V110 M135 0 V110" stroke="#22213a" stroke-width="2"/>
    <rect y="56" width="180" height="2" fill="#5aa0ff" opacity="0.45"/>
    <rect y="0" width="180" height="12" fill="#3a3e52"/><rect y="98" width="180" height="12" fill="#3a3e52"/>
    <polygon points="72,12 108,12 100,22 80,22" fill="#4a4f66"/>
    <polygon points="88,24 92,24 70,92 62,92" fill="#ff2b3d" opacity="0.45"/><polygon points="89.2,24 90.8,24 67.5,92 64.5,92" fill="#fff1f1"/>
    <g transform="rotate(18 90 24)"><rect x="86" y="22" width="8" height="18" fill="#6b7290"/><rect x="86" y="36" width="8" height="4" fill="#ff4d5e"/></g>
    <circle cx="90" cy="23" r="5" fill="#2a2e40"/><circle cx="90" cy="23" r="2.2" fill="#ff2b3d"/>
    <rect x="10" y="72" width="28" height="26" fill="#7a8aa6" stroke="#3a404e" stroke-width="2"/><path d="M12 74 L36 96 M36 74 L12 96" stroke="#3a404e" stroke-width="1.5"/>
    <rect x="40" y="82" width="20" height="16" fill="#a07a52" stroke="#4e3a26" stroke-width="2"/>
    <rect x="138" y="70" width="30" height="28" fill="#6f8f6a" stroke="#33442f" stroke-width="2"/><rect x="144" y="58" width="18" height="12" fill="#9a5f5f" stroke="#4a2c2c" stroke-width="2"/>
    <circle cx="118" cy="46" r="1.6" fill="#ff4d5e"/><circle cx="108" cy="52" r="1.6" fill="#ff4d5e"/><circle cx="56" cy="48" r="1.6" fill="#ffe066"/><circle cx="64" cy="45" r="1.6" fill="#ffe066"/>
    ${artRocket(134, 38, -120, '#ff4d5e', 0.85)}${artRocket(152, 52, -100, '#ff4d5e', 0.6)}${artRocket(124, 60, -135, '#ff4d5e', 0.6)}
    ${artRocket(42, 54, 65, '#ffe066', 0.85)}`),
};
