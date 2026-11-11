// Animasi gol di layar TV: gawang tampak menyerong (perspektif, menjauh ke kanan), jaring dari garis yang mengikuti perspektif, bola bershading masuk lalu menghantam jaring belakang.
// Semuanya SVG + CSS (tanpa video), jadi ringan dan tajam di layar berapa pun.
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const f = (p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
/** Garis jaring di dalam segiempat p00-p10 (sisi atas), p01-p11 (sisi bawah). nu = jumlah kolom, nv = jumlah baris. */
function mesh(p00, p10, p11, p01, nu, nv) {
  let d = "";
  for (let i = 0; i <= nu; i++) { const t = i / nu; d += `M${f(lerp(p00, p10, t))}L${f(lerp(p01, p11, t))}`; }
  for (let j = 0; j <= nv; j++) { const t = j / nv; d += `M${f(lerp(p00, p01, t))}L${f(lerp(p10, p11, t))}`; }
  return d;
}
const poly = (...p) => p.map(f).join(" ");

export function goalFxMarkup() {
  const V = [930, 300], k = 0.8; // titik hilang di kanan; gawang bagian belakang lebih kecil dan mengarah ke sana
  const F1 = [150, 100], F2 = [640, 150], F3 = [640, 470], F4 = [150, 530];
  const back = (p) => [V[0] + (p[0] - V[0]) * k, V[1] + (p[1] - V[1]) * k];
  const B1 = back(F1), B2 = back(F2), B3 = back(F3), B4 = back(F4);
  // bola dari assets/ball.png (hitam, latar transparan) di atas dasar putih, plus shading supaya terlihat bulat
  const ball = (cls) => `<g class="gb ${cls}"><g class="gb-spin"><circle r="50" fill="#fff"/><image href="assets/ball.png" x="-50" y="-50" width="100" height="100"/></g><circle r="50" fill="url(#gbShade)"/></g>`;
  return `<svg class="gfx3d" viewBox="0 0 1000 640" aria-hidden="true">
  <defs>
    <radialGradient id="gbShade" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></radialGradient>
    <linearGradient id="gPost" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#e3eaf2"/><stop offset="1" stop-color="#9db0c4"/></linearGradient>
    <filter id="gBlur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
  </defs>
  <ellipse cx="520" cy="540" rx="430" ry="42" fill="#000" opacity=".5" filter="url(#gBlur)"/>
  <g class="g-net-back">
    <polygon points="${poly(B1, B2, B3, B4)}" fill="#fff" fill-opacity=".05"/>
    <path d="${mesh(B1, B2, B3, B4, 28, 15)}" stroke="#fff" stroke-opacity=".55" stroke-width="1.5" fill="none"/>
  </g>
  <g class="g-net-side">
    <polygon points="${poly(F1, B1, B4, F4)}" fill="#fff" fill-opacity=".04"/>
    <path d="${mesh(F1, B1, B4, F4, 10, 15)}" stroke="#fff" stroke-opacity=".38" stroke-width="1.3" fill="none"/>
    <polygon points="${poly(F2, B2, B3, F3)}" fill="#fff" fill-opacity=".07"/>
    <path d="${mesh(F2, B2, B3, F3, 10, 15)}" stroke="#fff" stroke-opacity=".5" stroke-width="1.4" fill="none"/>
    <polygon points="${poly(F1, F2, B2, B1)}" fill="#fff" fill-opacity=".06"/>
    <path d="${mesh(F1, F2, B2, B1, 28, 7)}" stroke="#fff" stroke-opacity=".45" stroke-width="1.4" fill="none"/>
  </g>
  <g stroke="#b9c7d6" stroke-width="7" stroke-linecap="round" fill="none">
    <path d="M${f(B1)}L${f(B2)}M${f(B1)}L${f(B4)}M${f(B2)}L${f(B3)}M${f(F4)}L${f(B4)}M${f(F3)}L${f(B3)}"/>
  </g>
  ${ball("gb-in")}
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M${f(F4)}L${f(F1)}L${f(F2)}L${f(F3)}" stroke="#000" stroke-opacity=".28" stroke-width="19" transform="translate(5 6)"/>
    <path d="M${f(F4)}L${f(F1)}L${f(F2)}L${f(F3)}" stroke="url(#gPost)" stroke-width="16"/>
    <path d="M${f(F4)}L${f(F1)}L${f(F2)}L${f(F3)}" stroke="#fff" stroke-opacity=".7" stroke-width="3" transform="translate(-3 -2)"/>
  </g>
  ${ball("gb-out")}
</svg>`;
}
