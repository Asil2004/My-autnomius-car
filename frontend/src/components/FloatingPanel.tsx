import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * Suzuvchi (modal bo'lmagan) panel: video ustida turadi, sarlavhasidan sudrab surish mumkin, joyi eslab qolinadi.
 * Panel ochiq paytda ham orqadagi kadr va boshqaruvlar ishlayveradi (fon qoraytirilmaydi, fokus tutilmaydi).
 * Joylashuv ota-elementga (position: relative) nisbatan hisoblanadi.
 */
const STORAGE_KEY = 'qalqon.hud.panels.v1';
const EDGE = 12;

type Pos = { x: number; y: number };
export type PanelAnchor = 'tl' | 'tr' | 'bl' | 'br';

// Ochilgan panel oldinga chiqadi: umumiy hisoblagich
let zCounter = 30;

const readSaved = (id: string): Pos | null => {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, Pos>;
    const p = all[id];
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch {
    return null;
  }
};

const savePos = (id: string, pos: Pos) => {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, Pos>;
    all[id] = pos;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // saqlab bo'lmasa, panel o'sha sessiyada ishlayveradi
  }
};

interface FloatingPanelProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onClose: () => void;
  /** Birinchi ochilganda qaysi burchakka qo'yilsin */
  anchor: PanelAnchor;
  width?: number;
  children: React.ReactNode;
}

export const FloatingPanel: React.FC<FloatingPanelProps> = ({
  id,
  title,
  icon,
  open,
  onClose,
  anchor,
  width = 320,
  children
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Pos | null>(() => readSaved(id));
  const [z, setZ] = useState(() => ++zCounter);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const clampToHost = useCallback((p: Pos): Pos => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return p;
    const maxX = Math.max(EDGE, host.clientWidth - el.offsetWidth - EDGE);
    const maxY = Math.max(EDGE, host.clientHeight - el.offsetHeight - EDGE);
    return { x: Math.min(maxX, Math.max(EDGE, p.x)), y: Math.min(maxY, Math.max(EDGE, p.y)) };
  }, []);

  // Ochilganda: saqlangan joy bo'lsa uni (ekranga sig'adigan qilib), bo'lmasa burchakdagi boshlang'ich joyni hisoblaydi
  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    setZ(++zCounter);
    if (pos) {
      setPos(clampToHost(pos));
      return;
    }
    const x = anchor === 'tl' || anchor === 'bl' ? EDGE : host.clientWidth - el.offsetWidth - EDGE;
    const y = anchor === 'tl' || anchor === 'tr' ? EDGE : host.clientHeight - el.offsetHeight - EDGE;
    setPos(clampToHost({ x, y }));
    // faqat ochilish paytida hisoblanadi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const el = ref.current;
    if (!el || !pos) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    setZ(++zCounter);
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setPos(clampToHost({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }));
  };
  const onHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (pos) savePos(id, pos);
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      data-panel={id}
      onPointerDown={() => setZ(++zCounter)}
      className="float-window float-enter pointer-events-auto absolute flex flex-col"
      style={{
        width,
        maxWidth: 'calc(100% - 24px)',
        maxHeight: 'calc(100% - 24px)',
        left: pos?.x ?? EDGE,
        top: pos?.y ?? EDGE,
        zIndex: z,
        // Birinchi o'lchashgacha ko'rinmaydi (joy hisoblanayotganda sakramasligi uchun)
        visibility: pos ? 'visible' : 'hidden'
      }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 border-b border-tactical-700 cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-slate-100">
          <span className="text-police-cyan">{icon}</span>
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          title="Yopish (Esc)"
          aria-label={`${title} panelini yopish`}
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-tactical-800"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="p-3 overflow-y-auto">{children}</div>
    </div>
  );
};
