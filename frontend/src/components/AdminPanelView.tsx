import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  LogOut,
  RotateCcw,
  RotateCw,
  ShieldCheck,
  Square,
  VideoOff,
  Wifi,
  WifiOff
} from 'lucide-react';
import type { RemoteLink, RemoteTelemetry } from '../services/remoteClient';
import type { MecanumCommand, RemoteEvent } from '../types/robot';

interface AdminPanelViewProps {
  link: RemoteLink;
  onExit: () => void;
}

// Yuborish oralig'i: Pi dagi deadman muddati (700 ms) dan ancha qisqa, bitta yo'qolgan paket robotni to'xtatmaydi
const REPEAT_MS = 250;

const CMD_NAMES: Record<string, string> = {
  F: 'Oldinga',
  B: 'Orqaga',
  L: 'Chapga burilish',
  R: "O'ngga burilish",
  Q: 'Chapga siljish',
  E: "O'ngga siljish",
  S: "To'xtatish",
  U: 'Minora yuqoriga',
  D: 'Minora pastga'
};

const KEYPAD: ({ cmd: MecanumCommand; label: string; icon: React.ElementType } | null)[] = [
  { cmd: 'Q', label: 'Chapga siljish', icon: RotateCcw },
  { cmd: 'F', label: 'Oldinga', icon: ArrowUp },
  { cmd: 'E', label: "O'ngga siljish", icon: RotateCw },
  { cmd: 'L', label: 'Chapga burilish', icon: ArrowLeft },
  null,
  { cmd: 'R', label: "O'ngga burilish", icon: ArrowRight },
  null,
  { cmd: 'B', label: 'Orqaga', icon: ArrowDown },
  null
];

const KEY_MAP: Record<string, MecanumCommand> = {
  w: 'F',
  arrowup: 'F',
  s: 'B',
  arrowdown: 'B',
  a: 'L',
  arrowleft: 'L',
  d: 'R',
  arrowright: 'R',
  q: 'Q',
  e: 'E'
};

const fmtTime = (t: number) => new Date(t * 1000).toLocaleTimeString('uz-UZ', { hour12: false });
const srcLabel = (s: RemoteEvent['src']) => (s === 'admin' ? 'Admin' : s === 'local' ? 'Monitor' : 'Tizim');

export const AdminPanelView: React.FC<AdminPanelViewProps> = ({ link, onExit }) => {
  const [telemetry, setTelemetry] = useState<RemoteTelemetry | null>(null);
  const [connected, setConnected] = useState(false);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeCmd, setActiveCmd] = useState<MecanumCommand | null>(null);
  const [speed, setSpeed] = useState(1);
  const [videoOk, setVideoOk] = useState(true);
  const [videoNonce, setVideoNonce] = useState(0);

  const holdRef = useRef<{ cmd: MecanumCommand; timer: number } | null>(null);

  // Telemetriya (WebSocket) va aloqa kechikishi
  useEffect(() => {
    const close = link.openTelemetry(setTelemetry, setConnected);
    return close;
  }, [link]);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const ms = await link.ping();
      if (alive) setPingMs(ms);
    };
    run();
    const t = window.setInterval(run, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [link]);

  // Video uzilsa vaqti-vaqti bilan qayta uriniladi
  useEffect(() => {
    if (videoOk) return;
    const t = window.setInterval(() => {
      setVideoNonce((n) => n + 1);
      setVideoOk(true);
    }, 8000);
    return () => clearInterval(t);
  }, [videoOk]);

  const send = useCallback(
    async (cmd: MecanumCommand) => {
      const res = await link.sendCommand(cmd);
      if (res.ok) {
        setNotice(null);
        return;
      }
      setNotice(res.message);
      // Ruxsat yo'q bo'lsa, takrorlashni to'xtatamiz (STOP baribir yuboriladi)
      if (res.reason === 'locked' || res.reason === 'local_override' || res.reason === 'unauthorized') {
        if (holdRef.current) {
          clearInterval(holdRef.current.timer);
          holdRef.current = null;
          setActiveCmd(null);
        }
      }
    },
    [link]
  );

  const stopHold = useCallback(
    (sendStop: boolean) => {
      if (holdRef.current) {
        clearInterval(holdRef.current.timer);
        holdRef.current = null;
        setActiveCmd(null);
        if (sendStop) void link.sendCommand('S');
      }
    },
    [link]
  );

  const startHold = useCallback(
    (cmd: MecanumCommand) => {
      if (holdRef.current?.cmd === cmd) return;
      if (holdRef.current) {
        clearInterval(holdRef.current.timer);
        holdRef.current = null;
      }
      void send(cmd);
      const timer = window.setInterval(() => void send(cmd), REPEAT_MS);
      holdRef.current = { cmd, timer };
      setActiveCmd(cmd);
    },
    [send]
  );

  // STOP: ikki marta yuboriladi (bitta paket yo'qolsa ham to'xtaydi)
  const emergencyStop = useCallback(() => {
    stopHold(false);
    void link.sendCommand('S');
    window.setTimeout(() => void link.sendCommand('S'), 120);
  }, [link, stopHold]);

  // Aloqa uzilsa, takrorlash to'xtaydi (Pi deadman robotni to'xtatadi)
  useEffect(() => {
    if (!connected) stopHold(false);
  }, [connected, stopHold]);

  // Klaviatura: ushlab turilganda yuradi, qo'yib yuborilganda to'xtaydi
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'escape') {
        e.preventDefault();
        emergencyStop();
      } else if (KEY_MAP[k]) {
        e.preventDefault();
        startHold(KEY_MAP[k]);
      }
    };
    const up = (e: KeyboardEvent) => {
      const cmd = KEY_MAP[e.key.toLowerCase()];
      if (cmd && holdRef.current?.cmd === cmd) stopHold(true);
    };
    const hide = () => stopHold(true);
    const visibility = () => {
      if (document.hidden) stopHold(true);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', visibility);
      stopHold(true);
    };
  }, [emergencyStop, startHold, stopHold]);

  const remote = telemetry?.remote;
  const locked = remote ? !remote.allowed : false;
  const localHold = remote?.local_hold ?? false;
  const maxSpeed = remote?.max_speed ?? 2;
  const controlBlocked = locked || localHold;

  const statusChip = locked
    ? { tone: 'warn', text: "Monitor masofaviy boshqaruvni o'chirgan" }
    : localHold
    ? { tone: 'warn', text: 'Robot yonidagi operator boshqaryapti' }
    : { tone: 'ok', text: 'Boshqaruv sizda' };

  const sonar = telemetry?.sonars;

  return (
    <div className="flex flex-col h-screen w-screen bg-tactical-950 text-slate-100 overflow-hidden select-none">
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-tactical-900 border-b border-tactical-700">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-police-blue/20 text-police-cyan">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">QALQON Admin</div>
            <div className="text-[11px] text-slate-400 truncate max-w-[40vw]">{link.baseUrl.replace(/^https?:\/\//, '')}</div>
          </div>
        </div>

        <div
          data-status={statusChip.tone}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
            statusChip.tone === 'ok'
              ? 'bg-tactical-850 text-police-green border-tactical-700'
              : 'bg-police-amber/15 text-police-amber border-police-amber/50'
          }`}
        >
          {statusChip.text}
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border ${
              connected ? 'text-police-green border-tactical-700 bg-tactical-850' : 'text-police-red border-police-red/50 bg-police-red/10'
            }`}
          >
            {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {connected ? `Ulangan${pingMs !== null ? `, ${pingMs} ms` : ''}` : 'Uzilgan'}
          </span>
          <button
            onClick={() => {
              stopHold(true);
              onExit();
            }}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 text-slate-300 hover:bg-tactical-800 border border-tactical-700"
          >
            <LogOut className="w-3.5 h-3.5" /> Chiqish
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto p-3 grid gap-3 lg:grid-cols-[1fr_340px]">
        <section className="flex flex-col gap-3 min-h-0">
          <div className="relative bg-black rounded-xl overflow-hidden border border-tactical-700" style={{ aspectRatio: '16 / 9' }}>
            {videoOk ? (
              <img
                key={videoNonce}
                src={link.videoUrl(videoNonce)}
                alt="Robot kamerasi"
                onError={() => setVideoOk(false)}
                className="absolute inset-0 w-full h-full object-contain"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-500">
                <VideoOff className="w-8 h-8" />
                <span className="text-xs">Video oqimi yo'q, qayta uriniladi</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {(
              [
                ['Old', sonar?.front],
                ['Orqa', sonar?.rear],
                ['Chap', sonar?.left],
                ["O'ng", sonar?.right]
              ] as const
            ).map(([label, v]) => (
              <div
                key={label}
                className={`rounded-lg border py-2 ${
                  v !== undefined && v <= 22
                    ? 'border-police-red/60 bg-police-red/10 text-police-red'
                    : v !== undefined && v <= 45
                    ? 'border-police-amber/50 bg-police-amber/10 text-police-amber'
                    : 'border-tactical-700 bg-tactical-900 text-police-green'
                }`}
              >
                <div className="text-[10px] text-slate-400">{label} sonar</div>
                <div className="text-sm font-semibold">{v !== undefined ? `${v} sm` : '...'}</div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-tactical-700 bg-tactical-900 p-3">
            <div className="text-xs font-semibold text-slate-300 mb-2">Oxirgi buyruqlar</div>
            <ul className="text-[11px] space-y-1 max-h-40 overflow-y-auto">
              {(remote?.events ?? []).length === 0 && <li className="text-slate-500">Hozircha buyruq yo'q</li>}
              {[...(remote?.events ?? [])].reverse().map((ev, i) => (
                <li key={`${ev.t}-${i}`} className="flex gap-2">
                  <span className="text-slate-500">{fmtTime(ev.t)}</span>
                  <span className={ev.src === 'admin' ? 'text-police-cyan' : ev.src === 'local' ? 'text-police-amber' : 'text-slate-400'}>
                    {srcLabel(ev.src)}
                  </span>
                  <span className="text-slate-200">
                    {CMD_NAMES[ev.cmd] ?? ev.cmd}
                    {ev.reason === 'deadman' ? ' (aloqa uzildi, avto-to\'xtash)' : ''}
                    {!ev.ok ? ' (rad etildi)' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <aside className="flex flex-col gap-3">
          <div className="rounded-xl border border-tactical-700 bg-tactical-900 p-3 flex flex-col gap-3">
            <div className="flex items-center justify-between rounded-lg bg-tactical-850 p-1.5">
              <span className="text-[11px] text-slate-300 pl-1">Tezlik</span>
              <div className="flex gap-1">
                {[1, 2, 3].map((lvl) => (
                  <button
                    key={lvl}
                    disabled={lvl > maxSpeed}
                    onClick={() => {
                      setSpeed(lvl);
                      void link.setSpeed(lvl);
                    }}
                    aria-pressed={speed === lvl}
                    title={lvl > maxSpeed ? `Masofadan eng ko'pi ${maxSpeed}-daraja` : undefined}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                      speed === lvl ? 'bg-police-blue text-white' : 'text-slate-300 hover:bg-tactical-800'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Yo'nalish tugmalari (ushlab turing)">
              {KEYPAD.map((k, i) => {
                if (!k) return <span key={i} />;
                const Icon = k.icon;
                const active = activeCmd === k.cmd;
                return (
                  <button
                    key={k.cmd}
                    disabled={controlBlocked}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      startHold(k.cmd);
                    }}
                    onPointerUp={() => stopHold(true)}
                    onPointerCancel={() => stopHold(true)}
                    onContextMenu={(e) => e.preventDefault()}
                    data-cmd={k.cmd}
                    className={`py-4 rounded-lg border flex flex-col items-center justify-center gap-1 text-[11px] font-medium touch-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      active ? 'bg-police-blue border-police-blue text-white' : 'bg-tactical-850 border-tactical-700 text-slate-200 hover:bg-tactical-800'
                    }`}
                  >
                    <Icon className="w-6 h-6" />
                    <span>{k.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(['U', 'D'] as const).map((cmd) => (
                <button
                  key={cmd}
                  disabled={controlBlocked}
                  onClick={() => void send(cmd)}
                  className="py-2 rounded-lg border border-tactical-700 bg-tactical-850 text-slate-200 hover:bg-tactical-800 text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {cmd === 'U' ? <ChevronsUp className="w-4 h-4" /> : <ChevronsDown className="w-4 h-4" />}
                  {CMD_NAMES[cmd]}
                </button>
              ))}
            </div>

            <button
              onClick={emergencyStop}
              data-stop
              className="py-4 rounded-lg border-2 border-police-red bg-police-red/15 text-police-red text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
            >
              <Square className="w-5 h-5" /> STOP
            </button>

            {notice && (
              <div role="status" className="p-2 rounded-lg bg-police-amber/10 border border-police-amber/40 text-police-amber text-xs">
                {notice}
              </div>
            )}

            <p className="text-[11px] text-slate-400 text-center">
              Tugmani ushlab turing: qo'yib yuborsangiz robot to'xtaydi. Klaviatura: <span className="text-police-cyan">W A S D Q E</span>, Space/Esc
              (STOP).
            </p>
          </div>

          <div className="rounded-xl border border-tactical-700 bg-tactical-900 p-3 text-xs">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-slate-400">Robot harakati</dt>
              <dd className="text-right text-slate-100">{telemetry?.motion?.is_moving ? CMD_NAMES[telemetry.motion.last_cmd ?? ''] ?? telemetry.motion.last_cmd : "To'xtagan"}</dd>
              <dt className="text-slate-400">Akkumulyator</dt>
              <dd className="text-right text-slate-100">
                {telemetry?.battery?.percentage !== undefined ? `${Math.round(telemetry.battery.percentage)}%` : '...'}
              </dd>
              <dt className="text-slate-400">Oldinda to'siq</dt>
              <dd className={`text-right ${telemetry?.is_front_blocked ? 'text-police-red' : 'text-police-green'}`}>
                {telemetry?.is_front_blocked ? 'Bor, oldinga yurish bloklangan' : "Yo'q"}
              </dd>
              <dt className="text-slate-400">Aloqa himoyasi</dt>
              <dd className="text-right text-slate-100">{remote ? `${remote.lease_ms} ms ichida yangilanmasa to'xtaydi` : '...'}</dd>
            </dl>
          </div>
        </aside>
      </main>
    </div>
  );
};
