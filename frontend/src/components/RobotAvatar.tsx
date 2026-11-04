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
const MOUTH_Y = 807; // lab burchaklari
const MOUTH_MID_Y = 827; // yopiq lab chizig'ining o'rtasi
const MOUTH_HALF = 92;
const POINTER_FOLLOW_MS = 2500;

// Og'iz shakllari: open = ochilish (0..1), width = kenglik koeffitsiyenti
const VISEMES = [
  { open: 1.0, width: 1.0 }, // A
  { open: 0.45, width: 1.14 }, // E
  { open: 0.3, width: 1.18 }, // I
  { open: 0.8, width: 0.62 }, // O
  { open: 0.5, width: 0.5 }, // U
  { open: 0.0, width: 0.96 } // M, B, P
];
const MAX_H = 80; // eng katta ochilishda lab o'rtasidagi balandlik (px)

// Chap ko'z shakli (bodom). O'ng ko'z shu shaklning ko'zgudagi aksi
const EYE_UPPER = 'M 316 633 Q 384 538 452 628';
const EYE_LOWER = 'M 316 633 Q 384 696 452 628';
const EYE_SHAPE = `${EYE_UPPER} Q 384 696 316 633 Z`;

// ---- Erkak qiyofasi (asl rasm ustidan chiziladi, chap yarmi; o'ng yarmi ko'zgudagi aksi) ----
const CAP = '#2e3a50'; // furajka rangi
const HAIR = '#3b2a23';
// Asl rasmdagi gerb chegarasi: x 446..578, y 250..385
const BADGE_CX = 512;
const BADGE_CY = 318;
const GERB_W = 142;
const GERB_H = (GERB_W * 563) / 577;
// Jag'ni kengaytiruvchi bo'lak: yangi to'rtburchakroq chiziqdan asl kontur bo'ylab orqaga
const JAW_WEDGE =
  'M 268 745 Q 272 822 302 872 Q 338 926 420 952 L 440 950 ' +
  'L 393 920 L 368 900 L 346 880 L 327 860 L 310 840 L 297 820 L 289 800 L 281 780 L 274 760 Z';
const SIDEBURN = 'M 242 560 L 276 560 L 282 734 Q 268 744 255 732 L 246 650 Z';
const BROW = 'M 297 560 Q 294 530 330 513 Q 386 494 464 506 L 466 548 Q 402 540 346 549 Q 318 554 297 560 Z';
const STUBBLE =
  'M 276 768 Q 282 850 312 888 Q 352 940 430 958 Q 512 970 594 958 Q 672 940 712 888 Q 742 850 748 768 ' +
  'Q 712 790 668 784 Q 640 772 600 766 Q 512 758 424 766 Q 384 772 356 784 Q 312 790 276 768 Z';

const MaleFeatures: React.FC = () => (
  <g>
    <defs>
      <filter id="maleSoft" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="6" />
      </filter>
      <filter id="maleSoftSm" x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="2" />
      </filter>
    </defs>
    {/* Furajkadagi eski gerbni yopish va O'zbekiston Respublikasi gerbini qo'yish */}
    <ellipse cx={BADGE_CX} cy={BADGE_CY} rx="78" ry="80" fill={CAP} filter="url(#maleSoftSm)" />
    <image
      href={gerbUrl}
      x={BADGE_CX - GERB_W / 2}
      y={BADGE_CY - GERB_H / 2}
      width={GERB_W}
      height={GERB_H}
      preserveAspectRatio="xMidYMid meet"
    />
    {[false, true].map(mirror => (
      <g key={String(mirror)} transform={mirror ? `translate(${MID_X * 2} 0) scale(-1 1)` : undefined}>
        <path d={JAW_WEDGE} fill={SKIN} />
        <path d={SIDEBURN} fill={HAIR} />
      </g>
    ))}
    {/* Soqol o'rni (yengil soya) va iyak ostidagi jag' chizig'i */}
    <path d={STUBBLE} fill="#2b1d18" opacity="0.14" filter="url(#maleSoft)" />
    <path
      d="M 300 874 Q 340 930 420 955 Q 512 975 604 955 Q 684 930 724 874"
      fill="none"
      stroke="#7d5644"
      strokeOpacity="0.4"
      strokeWidth="9"
      strokeLinecap="round"
      filter="url(#maleSoftSm)"
    />
    {/* Burun */}
    <path d="M 498 698 Q 489 732 502 743 Q 512 749 525 742" fill="none" stroke="#956a54" strokeOpacity="0.5" strokeWidth="4.5" strokeLinecap="round" />
    {/* Qalin, to'g'ri qoshlar */}
    {[false, true].map(mirror => (
      <path
        key={`brow-${mirror}`}
        d={BROW}
        fill={HAIR}
        stroke={HAIR}
        strokeWidth="3"
        strokeLinejoin="round"
        transform={mirror ? `translate(${MID_X * 2} 0) scale(-1 1)` : undefined}
      />
    ))}
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
      <path d={EYE_UPPER} fill="none" stroke="#101010" strokeWidth="11" strokeLinecap="round" />
      <path d="M 320 631 Q 308 628 298 617" fill="none" stroke="#101010" strokeWidth="7" strokeLinecap="round" />
    </g>
  </g>
);

export const RobotAvatar: React.FC<RobotAvatarProps> = ({ inputRef }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const irisL = useRef<SVGGElement | null>(null);
  const irisR = useRef<SVGGElement | null>(null);
  const lidL = useRef<SVGGElement | null>(null);
  const lidR = useRef<SVGGElement | null>(null);
  const mouthRef = useRef<SVGGElement | null>(null);
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
    let width = 0.96;
    let tOpen = 0;
    let tWidth = 0.96;
    let visemeIdx = 5;
    let nextViseme = 0;
    let nod = 0;

    const onPointerMove = (e: PointerEvent) => {
      pointerX = clamp((e.clientX / window.innerWidth - 0.5) * 2);
      pointerY = clamp((e.clientY / window.innerHeight - 0.5) * 2);
      lastPointer = performance.now();
    };
    window.addEventListener('pointermove', onPointerMove);

    const setMouth = (o: number, w: number) => {
      const H = o * MAX_H;
      const hw = MOUTH_HALF * w;
      const lx = MID_X - hw;
      const rx = MID_X + hw;
      if (H < 1.5) {
        mouthRef.current?.setAttribute('display', 'none');
        return;
      }
      mouthRef.current?.setAttribute('display', 'inline');
      const upper = `M ${lx} ${MOUTH_Y} Q ${MID_X} ${2 * MOUTH_MID_Y - MOUTH_Y} ${rx} ${MOUTH_Y}`;
      const lowerCtl = 2 * (MOUTH_MID_Y + H) - MOUTH_Y;
      const lower = `Q ${MID_X} ${lowerCtl} ${lx} ${MOUTH_Y}`;
      const shape = `${upper} ${lower} Z`;
      cavityRef.current?.setAttribute('d', shape);
      clipPathRef.current?.setAttribute('d', shape);
      // Yuqori tishlar: yuqori chiziq bo'ylab oq tasma
      const t = Math.min(15, H * 0.34);
      teethRef.current?.setAttribute(
        'd',
        `M ${lx} ${MOUTH_Y - 2} Q ${MID_X} ${2 * MOUTH_MID_Y - MOUTH_Y} ${rx} ${MOUTH_Y - 2} L ${rx} ${MOUTH_Y + t} Q ${MID_X} ${2 * MOUTH_MID_Y - MOUTH_Y + 2 * t} ${lx} ${MOUTH_Y + t} Z`
      );
      const tongue = tongueRef.current;
      if (tongue) {
        tongue.setAttribute('cx', String(MID_X));
        tongue.setAttribute('cy', String(MOUTH_MID_Y + H * 0.82));
        tongue.setAttribute('rx', String(hw * 0.52));
        tongue.setAttribute('ry', String(Math.max(2, H * 0.34)));
      }
      upperLipRef.current?.setAttribute('d', upper);
      lowerLipRef.current?.setAttribute('d', `M ${rx} ${MOUTH_Y} ${lower}`);
      // Pastki lab ostidagi yengil soya (chuqurlik hissi)
      shadowRef.current?.setAttribute('d', `M ${rx - 8} ${MOUTH_Y + 6} Q ${MID_X} ${lowerCtl + 10} ${lx + 8} ${MOUTH_Y + 6}`);
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
        tOpen = v.open * (0.4 + 0.6 * Math.min(1, speech));
        tWidth = v.width;
      } else {
        tOpen = 0;
        tWidth = 0.96;
        nextViseme = 0;
      }
      const km = 1 - Math.exp(-dt * 24);
      open += (tOpen - open) * km;
      width += (tWidth - width) * km;
      setMouth(open < 0.02 ? 0 : open, width);

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
          <MaleFeatures />
          <Eye id="eyeL" irisRef={irisL} lidRef={lidL} />
          <Eye id="eyeR" irisRef={irisR} lidRef={lidR} mirror />
          {/* Og'iz bo'shlig'i, tishlar, til va lablar (yopiq paytda yashirin, asl lab chizig'i ko'rinadi) */}
          <g ref={mouthRef} display="none">
            <clipPath id="mouthClip">
              <path ref={clipPathRef} d="" />
            </clipPath>
            <path ref={shadowRef} d="" fill="none" stroke="#8d5f49" strokeOpacity="0.35" strokeWidth="9" strokeLinecap="round" />
            <path ref={cavityRef} d="" fill="#3a1418" />
            <g clipPath="url(#mouthClip)">
              <ellipse ref={tongueRef} cx={MID_X} cy={MOUTH_MID_Y} rx="40" ry="8" fill="#c2566a" />
              <path ref={teethRef} d="" fill="#f4f1ea" />
            </g>
            <path ref={upperLipRef} d="" fill="none" stroke="#a65b47" strokeWidth="4.5" strokeLinecap="round" />
            <path ref={lowerLipRef} d="" fill="none" stroke="#b5664f" strokeWidth="5.5" strokeLinecap="round" />
          </g>
        </svg>
      </div>
    </div>
  );
};
