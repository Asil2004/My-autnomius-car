import React, { useEffect, useRef } from 'react';
import baseUrl from '../assets/avatar/avatar-base.webp';
import gerbUrl from '../assets/avatar/gerb.webp';

/**
 * Robotning 2D yuzi. Eski 3D modeldan (Tripo, result.glb) bir marta oflayn chizilgan bitta rasm (avatar-base.webp,
 * frontal bosh va yelka) asosida. Ko'zlar va og'iz vektor (SVG) shaklida ustiga chiziladi, shuning uchun to'liq boshqariladi:
 * qarash, ko'z qisish, og'izning ochilishi (A, E, I, O, U, M shakllari), tishlar va til. three.js va WebGL kerak emas.
 *
 * Hamma harakat DOM ga to'g'ridan-to'g'ri yoziladi (React holati ishlatilmaydi), shuning uchun yengil.
 * Koordinatalar asl rasm (1024x1280) piksellarida.
 */
export interface EyeInput {
  /** Yuzning kadrdagi gorizontal o'rni, -1 (chap) .. 1 (o'ng), ko'zguga moslangan */
  faceX: number;
  /** Vertikal o'rni, -1 (tepa) .. 1 (past) */
  faceY: number;
  hasFace: boolean;
  /** 0..1, nutq balandligi (0 = jim) */
  speech: number;
  /** Tanilgan shaxs oldida turibdi */
  happy: boolean;
}

interface RobotAvatarProps {
  inputRef: React.MutableRefObject<EyeInput>;
}

const clamp = (v: number, a = -1, b = 1) => Math.min(b, Math.max(a, v));

// ---- Rasm koordinatalari (tahlil qilingan: teri #c1987c, tekis rang) ----
const SKIN = '#c1987c';
const MID_X = 511.5;
const EYE_Y = 630; // ko'z qisish o'qi
const EYE_CX = 382;
const MOUTH_CY = 822; // og'iz chizig'ining o'rtasi (tinch holat)
const MOUTH_HALF = 82; // og'iz yarim kengligi
const POINTER_FOLLOW_MS = 2500;

// Og'iz shakllari: open = vertikal ochilish (0..1), width = kenglik (deyarli o'zgarmaydi:
// og'iz yon tomonga cho'zilmaydi, lablar tepa-pastga ochilib yopiladi)
const VISEMES = [
  { open: 1.0, width: 1.0 }, // A
  { open: 0.62, width: 0.98 }, // E
  { open: 0.45, width: 0.97 }, // I
  { open: 0.85, width: 0.86 }, // O
  { open: 0.55, width: 0.84 }, // U
  { open: 0.06, width: 1.0 } // M, B, P
];
const MAX_H = 58; // eng katta ochilishda lablar orasidagi masofa (px)
const UPPER_SHARE = 0.3; // ochilishning qancha qismi yuqori labga (qolgani pastki jag')
const Q = 4 / 3; // kubik egri: boshqaruv nuqtasi -> haqiqiy cho'qqi koeffitsiyenti

// Chap ko'z shakli (bodom). O'ng ko'z shu shaklning ko'zgudagi aksi
const EYE_UPPER = 'M 316 633 Q 384 538 452 628';
const EYE_LOWER = 'M 316 633 Q 384 696 452 628';
const EYE_SHAPE = `${EYE_UPPER} Q 384 696 316 633 Z`;

// ---- Furajkadagi gerb ----
const CAP = '#2e3a50'; // furajka rangi
// Asl rasmdagi gerb chegarasi: x 446..578, y 250..385
const BADGE_CX = 512;
const BADGE_CY = 318;
const GERB_W = 142;
const GERB_H = (GERB_W * 563) / 577;

// ---- Erkak lablari ----
// Erkak lab ranglari: qizil emas, teriga yaqin jigarrang
const LIP_UPPER = '#7f5242';
const LIP_LOWER = '#8f5d4a';
const NOSE_SHADE = '#8d5f49';

const BadgeNoseAndMouthBase: React.FC = () => (
  <g>
    <defs>
      <filter id="badgeSoft" x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="2" />
      </filter>
      <filter id="faceSoft" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="4" />
      </filter>
    </defs>
    {/* Furajkadagi eski gerbni yopish va O'zbekiston Respublikasi gerbini qo'yish */}
    <ellipse cx={BADGE_CX} cy={BADGE_CY} rx="78" ry="80" fill={CAP} filter="url(#badgeSoft)" />
    <image
      href={gerbUrl}
      x={BADGE_CX - GERB_W / 2}
      y={BADGE_CY - GERB_H / 2}
      width={GERB_W}
      height={GERB_H}
      preserveAspectRatio="xMidYMid meet"
    />
    {/* Rasmdagi tabassumli qizil lab chizig'i to'liq teri bilan yopiladi: gapirganda orqadan ko'rinmaydi.
        Lablar endi faqat animatsiyali og'iz qatlamida chiziladi */}
    <ellipse cx={MID_X} cy="816" rx="120" ry="30" fill={SKIN} />

    {/* Burun: burun qirrasi soyasi, uchi, qanotlari va pastki soya */}
    <path d="M 500 650 Q 494 692 489 728" fill="none" stroke={NOSE_SHADE} strokeOpacity="0.22" strokeWidth="10" strokeLinecap="round" filter="url(#faceSoft)" />
    <ellipse cx={MID_X} cy="764" rx="30" ry="7" fill={NOSE_SHADE} opacity="0.28" filter="url(#faceSoft)" />
    <ellipse cx={MID_X + 3} cy="742" rx="13" ry="9" fill="#fff" opacity="0.16" filter="url(#faceSoft)" />
    <path d="M 489 734 Q 478 747 488 756 Q 492 759 497 758" fill="none" stroke={NOSE_SHADE} strokeOpacity="0.55" strokeWidth="4" strokeLinecap="round" />
    <path d="M 534 734 Q 545 747 535 756 Q 531 759 526 758" fill="none" stroke={NOSE_SHADE} strokeOpacity="0.55" strokeWidth="4" strokeLinecap="round" />
    <path d="M 503 761 Q 511.5 763.5 520 761" fill="none" stroke={NOSE_SHADE} strokeOpacity="0.3" strokeWidth="3" strokeLinecap="round" />
  </g>
);

const Eye: React.FC<{ id: string; irisRef: React.RefObject<SVGGElement | null>; lidRef: React.RefObject<SVGGElement | null>; mirror?: boolean }> = ({
  id,
  irisRef,
  lidRef,
  mirror
}) => (
  <g transform={mirror ? `translate(${MID_X * 2} 0) scale(-1 1)` : undefined}>
    {/* Asl (rasmdagi) ko'zni yopuvchi teri qoplami */}
    <ellipse cx={EYE_CX} cy="618" rx="88" ry="58" fill={SKIN} />
    <clipPath id={`${id}-clip`}>
      <path d={EYE_SHAPE} />
    </clipPath>
    <g ref={lidRef}>
      <path d={EYE_SHAPE} fill="#f1f1ef" />
      <g clipPath={`url(#${id}-clip)`}>
        <g ref={irisRef}>
          <circle cx={EYE_CX + 2} cy="622" r="33" fill="#2c2c2c" />
          <circle cx={EYE_CX + 2} cy="622" r="21" fill="#121212" />
          <circle cx={EYE_CX - 8} cy="609" r="9" fill="#fff" />
          <circle cx={EYE_CX + 11} cy="634" r="3.5" fill="#fff" opacity="0.85" />
        </g>
        {/* Yuqori qovoqning soyasi */}
        <path d={EYE_UPPER} fill="none" stroke="#000" strokeOpacity="0.18" strokeWidth="16" />
      </g>
      <path d={EYE_LOWER} fill="none" stroke="#5b3f33" strokeOpacity="0.55" strokeWidth="2.5" strokeLinecap="round" />
      {/* Erkak kipriklari: ingichka, uchi yuqoriga qayrilmagan (ayolona "qanot" olib tashlangan) */}
      <path d={EYE_UPPER} fill="none" stroke="#1d1611" strokeWidth="6.5" strokeLinecap="round" />
    </g>
  </g>
);

export const RobotAvatar: React.FC<RobotAvatarProps> = ({ inputRef }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const irisL = useRef<SVGGElement | null>(null);
  const irisR = useRef<SVGGElement | null>(null);
  const lidL = useRef<SVGGElement | null>(null);
  const lidR = useRef<SVGGElement | null>(null);
  const openRef = useRef<SVGGElement | null>(null);
  const cavityRef = useRef<SVGPathElement | null>(null);
  const clipPathRef = useRef<SVGPathElement | null>(null);
  const teethRef = useRef<SVGPathElement | null>(null);
  const tongueRef = useRef<SVGEllipseElement | null>(null);
  const upperLipRef = useRef<SVGPathElement | null>(null);
  const lowerLipRef = useRef<SVGPathElement | null>(null);
  const shadowRef = useRef<SVGPathElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let gx = 0;
    let gy = 0;
    let tx = 0;
    let ty = 0;
    let blink = 0;
    let nextBlink = performance.now() + 2200;
    let blinkStart = -1;
    let nextWander = 0;
    let lastPointer = -Infinity;
    let pointerX = 0;
    let pointerY = 0;
    // Og'iz
    let open = 0;
    let width = 1;
    let tOpen = 0;
    let tWidth = 1;
    let smile = 0;
    let visemeIdx = 5;
    let nextViseme = 0;
    let nod = 0;

    const onPointerMove = (e: PointerEvent) => {
      pointerX = clamp((e.clientX / window.innerWidth - 0.5) * 2);
      pointerY = clamp((e.clientY / window.innerHeight - 0.5) * 2);
      lastPointer = performance.now();
    };
    window.addEventListener('pointermove', onPointerMove);

    const f = (n: number) => n.toFixed(1);
    /**
     * o: vertikal ochilish 0..1, w: kenglik koeffitsiyenti, smile: 0..1 (faqat tanilgan shaxs oldida).
     * Og'iz har doim shu yerda chiziladi (yopiq holatda ham), shuning uchun orqasida boshqa lab ko'rinmaydi.
     */
    const setMouth = (o: number, w: number, smile: number) => {
      const H = o * MAX_H;
      // Ochilganda burchaklar biroz ichkariga yig'iladi (yon tomonga cho'zilmaydi)
      const hw = MOUTH_HALF * w * (1 - 0.1 * o);
      const lx = MID_X - hw;
      const rx = MID_X + hw;
      const cornerY = MOUTH_CY - 1 - smile * 7;
      const restMid = MOUTH_CY + 2 + smile * 3; // tinch holatda deyarli to'g'ri chiziq
      const upperMid = restMid - H * UPPER_SHARE;
      const lowerMid = restMid + H * (1 - UPPER_SHARE);
      const cU = cornerY + (upperMid - cornerY) * Q;
      const cL = cornerY + (lowerMid - cornerY) * Q;
      const kx = hw * 0.42;
      const upper = `M ${f(lx)} ${f(cornerY)} C ${f(lx + kx)} ${f(cU)} ${f(rx - kx)} ${f(cU)} ${f(rx)} ${f(cornerY)}`;
      const lowerBack = `C ${f(rx - kx)} ${f(cL)} ${f(lx + kx)} ${f(cL)} ${f(lx)} ${f(cornerY)}`;
      const shape = `${upper} ${lowerBack} Z`;

      const isOpen = H >= 1.2;
      openRef.current?.setAttribute('display', isOpen ? 'inline' : 'none');
      if (isOpen) {
        cavityRef.current?.setAttribute('d', shape);
        clipPathRef.current?.setAttribute('d', shape);
        // Yuqori tishlar: yuqori lab ostida oq tasma, pastki cheti egri
        const t = Math.min(11, H * 0.3);
        teethRef.current?.setAttribute(
          'd',
          `M ${f(lx)} ${f(cornerY - 14)} L ${f(rx)} ${f(cornerY - 14)} L ${f(rx)} ${f(cornerY + t * 0.2)} ` +
            `C ${f(rx - kx)} ${f(cU + t * Q)} ${f(lx + kx)} ${f(cU + t * Q)} ${f(lx)} ${f(cornerY + t * 0.2)} Z`
        );
        const tongue = tongueRef.current;
        if (tongue) {
          tongue.setAttribute('cx', String(MID_X));
          tongue.setAttribute('cy', f(lowerMid - H * 0.08));
          tongue.setAttribute('rx', f(hw * 0.55));
          tongue.setAttribute('ry', f(Math.max(2, H * 0.3)));
        }
      }
      upperLipRef.current?.setAttribute('d', upper);
      lowerLipRef.current?.setAttribute('d', `M ${f(rx)} ${f(cornerY)} ${lowerBack}`);
      lowerLipRef.current?.setAttribute('stroke-width', f(3 + Math.min(1, H / 14) * 2.5));
      // Pastki lab hajmi: lab ostidagi yumshoq soya jag' bilan birga pastga tushadi
      const sy = lowerMid + 13;
      shadowRef.current?.setAttribute(
        'd',
        `M ${f(MID_X - hw * 0.5)} ${f(sy - 3)} Q ${f(MID_X)} ${f(sy + 5)} ${f(MID_X + hw * 0.5)} ${f(sy - 3)}`
      );
    };

    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const input = inputRef.current;

      // ---- Qarash ----
      if (input.hasFace) {
        tx = clamp(input.faceX);
        ty = clamp(input.faceY);
      } else if (now - lastPointer < POINTER_FOLLOW_MS) {
        tx = pointerX;
        ty = pointerY;
      } else if (!reduce && now > nextWander) {
        tx = (Math.random() * 2 - 1) * 0.85;
        ty = (Math.random() * 2 - 1) * 0.5;
        nextWander = now + 1800 + Math.random() * 2400;
      } else if (reduce) {
        tx = 0;
        ty = 0;
      }
      const k = 1 - Math.exp(-dt * (input.hasFace ? 9 : 5));
      gx += (tx - gx) * k;
      gy += (ty - gy) * k;

      // ---- Ko'z qisish ----
      if (!reduce) {
        if (blinkStart < 0 && now > nextBlink) blinkStart = now;
        if (blinkStart >= 0) {
          const p = (now - blinkStart) / 170;
          blink = p < 0.5 ? p * 2 : Math.max(0, 2 - p * 2);
          if (p >= 1) {
            blink = 0;
            blinkStart = -1;
            nextBlink = now + 2500 + Math.random() * 3500;
          }
        }
      }
      const lidScale = Math.max(0.06, 1 - blink * 0.94 - (input.happy ? 0.12 : 0));
      const lidT = `translate(0 ${EYE_Y}) scale(1 ${lidScale.toFixed(3)}) translate(0 ${-EYE_Y})`;
      lidL.current?.setAttribute('transform', lidT);
      lidR.current?.setAttribute('transform', lidT);
      // Qorachiq: o'ng ko'z ko'zgudagi aksi bo'lgani uchun gorizontal siljish teskari
      const ix = gx * 12;
      const iy = gy * 6;
      irisL.current?.setAttribute('transform', `translate(${ix.toFixed(2)} ${iy.toFixed(2)})`);
      irisR.current?.setAttribute('transform', `translate(${(-ix).toFixed(2)} ${iy.toFixed(2)})`);

      // ---- Og'iz: nutq balandligiga qarab shakllar almashadi ----
      const speech = input.speech;
      if (speech > 0.05) {
        if (now > nextViseme) {
          let next = Math.floor(Math.random() * VISEMES.length);
          if (next === visemeIdx) next = (next + 1) % VISEMES.length;
          visemeIdx = next;
          nextViseme = now + 90 + Math.random() * 90;
        }
        const v = VISEMES[visemeIdx];
        // Ochilish asosan ovoz balandligiga bog'liq (jim joylarda og'iz yopiladi), shakl esa visemadan
        tOpen = v.open * (0.25 + 0.75 * Math.min(1, speech));
        tWidth = v.width;
      } else {
        tOpen = 0;
        tWidth = 1;
        nextViseme = 0;
      }
      // Ochilish tez, yopilish biroz sekinroq: tabiiy jag' harakati
      const km = 1 - Math.exp(-dt * (tOpen > open ? 22 : 15));
      open += (tOpen - open) * km;
      width += (tWidth - width) * (1 - Math.exp(-dt * 14));
      // Tabassum faqat tanilgan shaxs oldida va jim turganda
      const tSmile = input.happy && speech <= 0.05 ? 1 : 0;
      smile += (tSmile - smile) * (1 - Math.exp(-dt * 4));
      setMouth(open < 0.02 ? 0 : open, width, smile);

      // ---- Bosh: nafas, burilish, nutq paytida yengil tebranish ----
      nod += ((speech > 0.05 ? Math.sin(now / 95) * speech * 0.7 : 0) - nod) * (1 - Math.exp(-dt * 12));
      const breath = reduce ? 0 : Math.sin(now / 1100) * 0.35;
      root.style.transform =
        `perspective(1400px) translate3d(${(gx * 0.9).toFixed(2)}%, ${(breath + gy * 0.6 + nod).toFixed(2)}%, 0) ` +
        `rotateY(${(gx * 5).toFixed(2)}deg) rotateX(${(-gy * 3).toFixed(2)}deg) rotateZ(${(gx * 1.2).toFixed(2)}deg)`;
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [inputRef]);

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
      <div ref={rootRef} style={{ height: 'min(94%, 1100px)', aspectRatio: '1024 / 1280', willChange: 'transform' }}>
        <svg viewBox="0 0 1024 1280" className="w-full h-full block" role="img">
          <image href={baseUrl} x="0" y="0" width="1024" height="1280" />
          <BadgeNoseAndMouthBase />
          <Eye id="eyeL" irisRef={irisL} lidRef={lidL} />
          <Eye id="eyeR" irisRef={irisR} lidRef={lidR} mirror />
          {/* Og'iz: yagona animatsiyali qatlam (tinch holatdagi lab chizig'i ham shu yerda) */}
          <g>
            <path ref={shadowRef} d="" fill="none" stroke="#8d5f49" strokeOpacity="0.22" strokeWidth="7" strokeLinecap="round" filter="url(#badgeSoft)" />
            <g ref={openRef} display="none">
              <clipPath id="mouthClip">
                <path ref={clipPathRef} d="" />
              </clipPath>
              <path ref={cavityRef} d="" fill="#2b0f12" />
              <g clipPath="url(#mouthClip)">
                <ellipse ref={tongueRef} cx={MID_X} cy={MOUTH_CY} rx="40" ry="8" fill="#b4505f" />
                <path ref={teethRef} d="" fill="#f2eee6" />
              </g>
            </g>
            <path ref={upperLipRef} d="" fill="none" stroke={LIP_UPPER} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            <path ref={lowerLipRef} d="" fill="none" stroke={LIP_LOWER} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </svg>
      </div>
    </div>
  );
};
