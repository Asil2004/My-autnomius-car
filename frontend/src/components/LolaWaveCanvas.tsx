import React, { useEffect, useRef } from 'react';

export type LolaWaveState = 'sleep' | 'listen' | 'think' | 'speak' | 'off';

interface LolaWaveCanvasProps {
  state: LolaWaveState;
  audioLevel?: number; // 0..1
  onTap?: () => void;
  className?: string;
}

const LAYERS = [
  // [chastota, tezlik, faza, qalinlik, shaffoflik, amplituda ulushi]
  [1.6, 1.1, 0.0, 3.0, 1.0, 1.0],
  [2.4, -1.5, 1.7, 2.2, 0.65, 0.78],
  [3.5, 1.9, 3.1, 1.8, 0.45, 0.58],
  [5.2, -2.3, 4.4, 1.4, 0.3, 0.38]
];

const COL: Record<LolaWaveState, [number, number, number]> = {
  off: [110, 118, 140],
  sleep: [90, 130, 255],     // Tinch moviy (uyqu / kutish)
  listen: [255, 110, 140],   // Qizil / marjon (eshitish)
  think: [255, 196, 90],     // Oltin sariq (fikrlash)
  speak: [70, 235, 170]      // Zumrad yashil (Lola gapirmoqda)
};

export const LolaWaveCanvas: React.FC<LolaWaveCanvasProps> = ({
  state,
  audioLevel = 0,
  onTap,
  className = ''
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(audioLevel);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    levelRef.current = audioLevel;
  }, [audioLevel]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const g = cv.getContext('2d');
    if (!g) return;

    let W = 0;
    let H = 0;
    let DPR = 1;
    let amp = 0.05;
    const col: [number, number, number] = [...COL[stateRef.current]];
    let rafId: number;

    const resize = () => {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.width = window.innerWidth * DPR;
      H = cv.height = window.innerHeight * DPR;
    };

    window.addEventListener('resize', resize);
    resize();

    const t0 = performance.now();

    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      const st = stateRef.current;
      const curLevel = levelRef.current;

      let target = 0.02;
      if (st === 'speak') {
        target = Math.max(0.12, Math.min(1.0, curLevel * 1.4));
      } else if (st === 'listen') {
        target = Math.max(0.10, Math.min(0.9, curLevel * 1.6));
      } else if (st === 'think') {
        target = 0.28 + 0.14 * Math.sin(t * 5);
      } else if (st === 'sleep') {
        target = 0.05 + 0.025 * Math.sin(t * 1.3);
      } else {
        target = 0.015;
      }

      // Amplitudani silliq ko'tarish va tushirish
      amp += (target - amp) * (target > amp ? 0.35 : 0.12);

      // Rangni bosqichma-bosqich yangi holatga moslash
      const tc = COL[st] || COL.off;
      for (let i = 0; i < 3; i++) {
        col[i] += (tc[i] - col[i]) * 0.08;
      }

      g.clearRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';

      const cy = H / 2;
      const maxA = H * 0.28;
      const flow = st === 'think' ? 2.2 : 1.0;

      for (const [fq, sp, ph, lw, al, k] of LAYERS) {
        g.beginPath();
        for (let x = 0; x <= W; x += Math.max(2, DPR * 2)) {
          const u = x / W;
          const env = Math.pow(Math.sin(Math.PI * u), 2.2); // Chetlarda to'lqin so'nishi
          const y =
            cy +
            Math.sin(u * fq * Math.PI * 2 + t * sp * flow + ph) * maxA * amp * k * env +
            Math.sin(u * fq * 5.3 + t * sp * 0.7 + ph) * maxA * amp * 0.18 * k * env;
          if (x === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.strokeStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${al})`;
        g.lineWidth = lw * DPR;
        g.shadowColor = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
        g.shadowBlur = 14 * DPR;
        g.stroke();
      }

      g.globalCompositeOperation = 'source-over';
      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div
      onClick={onTap}
      className={`absolute inset-0 cursor-pointer overflow-hidden select-none bg-[#070a12] ${className}`}
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};
