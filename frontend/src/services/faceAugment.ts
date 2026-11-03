/**
 * Yuz rasmiga sun'iy aksessuar (ko'zoynak, bosh kiyim, kapyushon, niqob, taturovka) chizish.
 * Bazadagi rasmdan "aksessuar taqqan" variantlar yasash uchun ishlatiladi: har bir variantdan embedding olinadi va
 * jonli yuz barcha variantlar bilan solishtiriladi. Joylashuv 68 landmark nuqtasiga qarab hisoblanadi.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface AccessoryStyle {
  /** Tasodifiy sonlar urug'i: bir xil urug' = bir xil chizma */
  seed: number;
  /** Aksessuar o'lchami koeffitsienti (1 = standart) */
  k: number;
}

export const ACCESSORIES = [
  'glasses',
  'sunglasses',
  'cap',
  'beanie',
  'hood',
  'mask_blue',
  'mask_white',
  'mask_black',
  'tattoo'
] as const;

/** Bazaga qo'shiladigan variantlar. "+" bilan birlashtirilganlari bir vaqtda taqilgan holat */
export const TRAIN_VARIANTS: string[] = [
  'glasses',
  'sunglasses',
  'cap',
  'beanie',
  'hood',
  'mask_blue',
  'mask_black',
  'tattoo',
  'sunglasses+mask_blue',
  'glasses+mask_white',
  'cap+sunglasses',
  'cap+mask_black',
  'hood+mask_black',
  'hood+sunglasses',
  'beanie+sunglasses+mask_blue'
];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const center = (pts: Pt[]): Pt => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length
});

interface Geom {
  fw: number; // yuz kengligi
  L: number; // qosh va iyak orasi
  browY: number;
  cx: number;
  eyeL: Pt;
  eyeR: Pt;
  eyeDist: number;
}

function geometry(P: Pt[]): Geom {
  const fw = dist(P[0], P[16]);
  const browY = P.slice(17, 27).reduce((s, p) => s + p.y, 0) / 10;
  const eyeL = center(P.slice(36, 42));
  const eyeR = center(P.slice(42, 48));
  return { fw, L: P[8].y - browY, browY, cx: (P[0].x + P[16].x) / 2, eyeL, eyeR, eyeDist: dist(eyeL, eyeR) };
}

function drawGlasses(ctx: CanvasRenderingContext2D, P: Pt[], g: Geom, r: () => number, k: number, sun: boolean) {
  const lw = Math.max(1.5, g.fw * (0.014 + r() * 0.008) * k);
  const frame = ['#161616', '#3a2a1c', '#5d5d63', '#1c2a4a'][Math.floor(r() * 4)];
  const rx = g.eyeDist * (0.40 + r() * 0.06) * k;
  const ry = rx * (0.62 + r() * 0.2);
  const rounded = r() < 0.5;
  ctx.save();
  ctx.lineWidth = lw;
  ctx.strokeStyle = frame;
  ctx.fillStyle = sun ? `rgba(8,8,12,${0.82 + r() * 0.12})` : 'rgba(190,215,235,0.14)';
  for (const e of [g.eyeL, g.eyeR]) {
    ctx.beginPath();
    if (rounded) {
      ctx.ellipse(e.x, e.y, rx, ry, 0, 0, Math.PI * 2);
    } else {
      const rr = Math.min(rx, ry) * 0.35;
      ctx.roundRect(e.x - rx, e.y - ry, rx * 2, ry * 2, rr);
    }
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(g.eyeL.x + rx, g.eyeL.y - ry * 0.2);
  ctx.lineTo(g.eyeR.x - rx, g.eyeR.y - ry * 0.2);
  ctx.moveTo(g.eyeL.x - rx, g.eyeL.y - ry * 0.1);
  ctx.lineTo(P[0].x, g.eyeL.y - ry * 0.1);
  ctx.moveTo(g.eyeR.x + rx, g.eyeR.y - ry * 0.1);
  ctx.lineTo(P[16].x, g.eyeR.y - ry * 0.1);
  ctx.stroke();
  ctx.restore();
}

function drawMask(ctx: CanvasRenderingContext2D, P: Pt[], g: Geom, r: () => number, k: number, color: string) {
  const topY = P[29].y - 0.02 * g.L - r() * 0.04 * g.L;
  const spread = 0.02 * g.fw * k;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, g.fw * 0.006);
  ctx.beginPath();
  ctx.moveTo(P[2].x - spread, topY + 0.1 * g.L);
  ctx.quadraticCurveTo(g.cx, topY - 0.12 * g.L, P[14].x + spread, topY + 0.1 * g.L);
  for (let i = 14; i >= 2; i--) {
    const down = i === 8 ? 0.07 * g.L * k : 0.02 * g.L;
    ctx.lineTo(P[i].x + (i > 8 ? spread : -spread) * (i === 8 ? 0 : 1), P[i].y + down);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // burmalar
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  for (const f of [0.3, 0.5, 0.7]) {
    const y = topY + 0.1 * g.L + f * (P[8].y - topY - 0.05 * g.L);
    ctx.beginPath();
    ctx.moveTo(P[2].x, y);
    ctx.quadraticCurveTo(g.cx, y + 0.03 * g.L, P[14].x, y);
    ctx.stroke();
  }
  // quloq ilmoqlari
  ctx.strokeStyle = 'rgba(200,200,205,0.8)';
  ctx.beginPath();
  ctx.moveTo(P[2].x - spread, topY + 0.14 * g.L);
  ctx.lineTo(P[0].x - 0.02 * g.fw, P[0].y - 0.12 * g.L);
  ctx.moveTo(P[14].x + spread, topY + 0.14 * g.L);
  ctx.lineTo(P[16].x + 0.02 * g.fw, P[16].y - 0.12 * g.L);
  ctx.stroke();
  ctx.restore();
}

function drawCap(ctx: CanvasRenderingContext2D, g: Geom, r: () => number, k: number, w: number) {
  const colors = ['#1b2230', '#2e3b2c', '#3a1f1f', '#2a2a2a', '#4a4f57'];
  const color = colors[Math.floor(r() * colors.length)];
  const capY = g.browY - (0.08 + r() * 0.08) * g.L;
  const xl = g.cx - g.fw * 0.62 * k;
  const xr = g.cx + g.fw * 0.62 * k;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(xl, -w);
  ctx.lineTo(xr, -w);
  ctx.lineTo(xr, capY + 0.02 * g.L);
  ctx.quadraticCurveTo(g.cx, capY + 0.12 * g.L, xl, capY + 0.02 * g.L);
  ctx.closePath();
  ctx.fill();
  // soyabon
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(g.cx, capY + 0.15 * g.L, g.fw * 0.5 * k, 0.05 * g.L, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(g.cx, capY + 0.11 * g.L, g.fw * 0.52 * k, 0.05 * g.L, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBeanie(ctx: CanvasRenderingContext2D, g: Geom, r: () => number, k: number, w: number) {
  const colors = ['#23262e', '#5a2a2a', '#2c4a5a', '#6a6a70'];
  const color = colors[Math.floor(r() * colors.length)];
  const edgeY = g.browY - 0.02 * g.L - r() * 0.05 * g.L;
  const xl = g.cx - g.fw * 0.66 * k;
  const xr = g.cx + g.fw * 0.66 * k;
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(xl, -w, xr - xl, edgeY + w);
  // quloq va chakka qismlari
  ctx.fillRect(xl, edgeY, g.fw * 0.2 * k, g.eyeL.y - edgeY + 0.05 * g.L);
  ctx.fillRect(xr - g.fw * 0.2 * k, edgeY, g.fw * 0.2 * k, g.eyeR.y - edgeY + 0.05 * g.L);
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = Math.max(1, g.fw * 0.008);
  for (let x = xl; x < xr; x += g.fw * 0.045) {
    ctx.beginPath();
    ctx.moveTo(x, edgeY - 0.18 * g.L);
    ctx.lineTo(x, edgeY);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHood(ctx: CanvasRenderingContext2D, P: Pt[], g: Geom, r: () => number, k: number, W: number, H: number) {
  const topY = g.browY - (0.18 + r() * 0.1) * g.L;
  const botY = P[8].y + 0.03 * g.L;
  ctx.save();
  ctx.fillStyle = ['#23252b', '#2f3a3f', '#3b2b30'][Math.floor(r() * 3)];
  ctx.beginPath();
  ctx.rect(-W, -H, W * 3, H * 3);
  ctx.ellipse(g.cx, (topY + botY) / 2, g.fw * 0.6 * k, (botY - topY) / 2, 0, 0, Math.PI * 2);
  ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = g.fw * 0.05;
  ctx.beginPath();
  ctx.ellipse(g.cx, (topY + botY) / 2, g.fw * 0.6 * k, (botY - topY) / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawTattoo(ctx: CanvasRenderingContext2D, P: Pt[], g: Geom, r: () => number, k: number) {
  ctx.save();
  ctx.strokeStyle = `rgba(18,28,78,${0.55 + r() * 0.2})`;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = Math.max(1.5, g.fw * 0.013 * k);
  ctx.lineCap = 'round';
  const cheeks: [Pt, number][] = [
    [{ x: P[3].x + g.fw * 0.04, y: g.eyeL.y + 0.1 * g.L }, 1],
    [{ x: P[13].x - g.fw * 0.04, y: g.eyeR.y + 0.1 * g.L }, -1]
  ];
  for (const [s, dir] of cheeks) {
    for (let i = 0; i < 3; i++) {
      const y0 = s.y + i * 0.07 * g.L * k;
      ctx.beginPath();
      ctx.moveTo(s.x, y0);
      ctx.bezierCurveTo(
        s.x + dir * g.fw * (0.06 + r() * 0.04),
        y0 - 0.05 * g.L,
        s.x + dir * g.fw * (0.12 + r() * 0.05),
        y0 + 0.06 * g.L,
        s.x + dir * g.fw * (0.17 + r() * 0.04),
        y0 + (r() - 0.3) * 0.05 * g.L
      );
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(s.x + dir * g.fw * 0.05, s.y - 0.06 * g.L, g.fw * 0.014 * k, 0, Math.PI * 2);
    ctx.fill();
  }
  // peshonadagi chiziqlar
  for (let i = 0; i < 2; i++) {
    const x = g.cx + (i - 0.5) * g.fw * 0.14;
    ctx.beginPath();
    ctx.moveTo(x, g.browY - 0.2 * g.L);
    ctx.quadraticCurveTo(x + g.fw * 0.03, g.browY - 0.12 * g.L, x - g.fw * 0.01, g.browY - 0.07 * g.L);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * base — yuzli rasm chizilgan canvas, P — shu rasmdagi 68 landmark.
 * Yangi canvas qaytaradi (asl canvas o'zgarmaydi). name: aksessuarlar "+" bilan, masalan "hood+mask_black".
 */
export function renderVariant(base: HTMLCanvasElement, P: Pt[], name: string, style: AccessoryStyle): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = base.width;
  out.height = base.height;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(base, 0, 0);
  const g = geometry(P);
  const r = rng(style.seed);
  const tokens = name.split('+');
  const has = (t: string) => tokens.includes(t);

  // Tartib: taturovka (teri ustida), niqob, ko'zoynak, bosh kiyim (eng ustida)
  if (has('tattoo')) drawTattoo(ctx, P, g, r, style.k);
  for (const t of tokens) {
    if (t === 'mask_blue') drawMask(ctx, P, g, r, style.k, '#9fd0e6');
    if (t === 'mask_white') drawMask(ctx, P, g, r, style.k, '#f1f3f5');
    if (t === 'mask_black') drawMask(ctx, P, g, r, style.k, '#1d1f24');
  }
  if (has('glasses')) drawGlasses(ctx, P, g, r, style.k, false);
  if (has('sunglasses')) drawGlasses(ctx, P, g, r, style.k, true);
  if (has('hood')) drawHood(ctx, P, g, r, style.k, out.width, out.height);
  if (has('beanie')) drawBeanie(ctx, g, r, style.k, out.height);
  if (has('cap')) drawCap(ctx, g, r, style.k, out.height);
  return out;
}
