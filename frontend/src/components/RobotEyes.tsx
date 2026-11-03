import React, { useEffect, useRef } from 'react';

/**
 * Robotning 2D yuzi: ikkita ko'z va yengil yuz plitasi.
 * Hamma harakat DOM ga to'g'ridan-to'g'ri yoziladi (React holati ishlatilmaydi), shuning uchun 60 kadr/s da ham yengil.
 *
 * Holatlar:
 *  - Kamera yuz topmagan: ko'zlar atrofga qaraydi, vaqti-vaqti bilan ko'z qisadi. Kursor/barmoq yaqinda qimirlagan bo'lsa, shunga qaraydi.
 *  - Kamera yuz topgan: ko'zlar odamni kuzatadi, yuz plitasi biroz unga qarab buriladi.
 *  - Tanilgan shaxs (happy): pastki qovoqlar ko'tariladi (tabassum ko'zlari).
 *  - Nutq: ko'zlar nutq ritmida yengil kengayib-torayadi.
 * prefers-reduced-motion yoqilgan bo'lsa: ko'z qisish va o'zi qarash o'chadi, faqat yuzni kuzatish qoladi.
 */
export interface EyeInput {
  /** Yuzning kadrdagi gorizontal o'rni, -1 (chap) .. 1 (o'ng), ko'zguga moslangan */
  faceX: number;
  /** Vertikal o'rni, -1 (tepa) .. 1 (past) */
  faceY: number;
  hasFace: boolean;
  /** 0..1, nutq balandligi */
  speech: number;
  /** Tanilgan shaxs oldida turibdi */
  happy: boolean;
}

interface RobotEyesProps {
  inputRef: React.MutableRefObject<EyeInput>;
}

const clamp = (v: number, a = -1, b = 1) => Math.min(b, Math.max(a, v));
const POINTER_FOLLOW_MS = 2500;
const EYE_CLASS = 'bg-police-cyan';
const EYE_STYLE: React.CSSProperties = {
  width: 'min(13vw, 17vh)',
  height: 'min(19vw, 25vh)',
  borderRadius: '38%',
  willChange: 'transform, clip-path'
};

export const RobotEyes: React.FC<RobotEyesProps> = ({ inputRef }) => {
  const plateRef = useRef<HTMLDivElement | null>(null);
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const plate = plateRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    if (!plate || !left || !right) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let gx = 0; // joriy qarash
    let gy = 0;
    let tx = 0; // maqsad
    let ty = 0;
    let happy = 0;
    let blink = 0; // 0 ochiq, 1 yopiq
    let nextBlink = performance.now() + 2200;
    let blinkStart = -1;
    let nextWander = 0;
    let lastPointer = -Infinity;
    let pointerX = 0;
    let pointerY = 0;
    let surprise = 0;

    const onPointerMove = (e: PointerEvent) => {
      pointerX = clamp((e.clientX / window.innerWidth - 0.5) * 2);
      pointerY = clamp((e.clientY / window.innerHeight - 0.5) * 2);
      lastPointer = performance.now();
    };
    // Tegilganda ko'zlar bir lahzaga kengayadi (yuz "sezganini" bildiradi)
    const onPointerDown = () => {
      if (!reduce) surprise = 1;
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerdown', onPointerDown);

    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const input = inputRef.current;

      // Maqsad: yuz, kursor yoki o'zi qarash
      if (input.hasFace) {
        tx = clamp(input.faceX);
        ty = clamp(input.faceY);
      } else if (now - lastPointer < POINTER_FOLLOW_MS) {
        tx = pointerX;
        ty = pointerY;
      } else if (!reduce && now > nextWander) {
        tx = (Math.random() * 2 - 1) * 0.8;
        ty = (Math.random() * 2 - 1) * 0.45;
        nextWander = now + 1800 + Math.random() * 2400;
      } else if (reduce) {
        tx = 0;
        ty = 0;
      }

      // Ko'zlar tez, yuz plitasi sekin ergashadi: ikki qatlamli "jonlilik"
      const k = 1 - Math.exp(-dt * (input.hasFace ? 9 : 5));
      gx += (tx - gx) * k;
      gy += (ty - gy) * k;

      happy += ((input.happy ? 1 : 0) - happy) * (1 - Math.exp(-dt * 6));
      surprise = Math.max(0, surprise - dt * 3.2);

      // Ko'z qisish
      if (!reduce) {
        if (blinkStart < 0 && now > nextBlink) blinkStart = now;
        if (blinkStart >= 0) {
          const p = (now - blinkStart) / 160;
          blink = p < 0.5 ? p * 2 : Math.max(0, 2 - p * 2);
          if (p >= 1) {
            blink = 0;
            blinkStart = -1;
            nextBlink = now + 2500 + Math.random() * 3500;
          }
        }
      }

      const speech = input.speech;
      const speechPulse = speech > 0.05 ? Math.sin(now / 70) * speech * 0.05 : 0;
      const grow = 1 + surprise * 0.1 + speechPulse;

      // Qovoqlar: yuqorisi ko'z qisishda tushadi, pastki qismi tabassumda ko'tariladi (clip-path orqali)
      const top = blink * 48;
      const bottom = happy * 26 + blink * 48;
      const clip = `inset(${top.toFixed(1)}% 0 ${bottom.toFixed(1)}% 0 round 38%)`;
      const eyeX = gx * 14;
      const eyeY = gy * 10;
      const eyeTransform = `translate(${eyeX.toFixed(2)}%, ${eyeY.toFixed(2)}%) scale(${grow.toFixed(3)})`;
      left.style.transform = eyeTransform;
      right.style.transform = eyeTransform;
      left.style.clipPath = clip;
      right.style.clipPath = clip;

      // Yuz plitasi: ozgina siljiydi va buriladi
      plate.style.transform = `translate(${(gx * 1.4).toFixed(2)}%, ${(gy * 1.2).toFixed(2)}%) rotate(${(gx * 1.1).toFixed(2)}deg)`;
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [inputRef]);

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
      <div
        ref={plateRef}
        className="relative flex items-center justify-center rounded-[2.5rem] border border-tactical-700 bg-tactical-900"
        style={{ width: 'min(78vw, 880px)', height: 'min(52vh, 520px)', willChange: 'transform' }}
      >
        <div className="flex items-center" style={{ gap: 'min(7vw, 9vh)' }}>
          <div ref={leftRef} className={EYE_CLASS} style={EYE_STYLE} />
          <div ref={rightRef} className={EYE_CLASS} style={EYE_STYLE} />
        </div>
      </div>
    </div>
  );
};
