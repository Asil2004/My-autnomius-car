import React, { useEffect, useState } from 'react';
import { Radio, RefreshCw, Copy, Check } from 'lucide-react';
import { camLinkSettings, normalizeKey, normalizeRobotId, type CamLinkSettings } from '../services/camLinkSettings';
import { robotCamBroadcaster, type BroadcastStatus } from '../services/robotCamLink';

/**
 * Sozlamalar: kamera translyatsiyasi. Robot planshet tasvir chiqaradi, dispetcher markazidagi operatorlar kuzatadi.
 */
export const CamLinkCard: React.FC = () => {
  const [s, setS] = useState<CamLinkSettings>(() => camLinkSettings.get());
  const [keyInput, setKeyInput] = useState(s.key);
  const [idInput, setIdInput] = useState(s.robotId);
  const [nameInput, setNameInput] = useState(s.operatorName);
  const [turn, setTurn] = useState({ url: s.turnUrl, user: s.turnUser, pass: s.turnPass });
  const [status, setStatus] = useState<BroadcastStatus>(() => robotCamBroadcaster.getStatus());
  const [copied, setCopied] = useState(false);

  useEffect(
    () =>
      camLinkSettings.subscribe((n) => {
        setS(n);
        setKeyInput(n.key);
        setIdInput(n.robotId);
        setNameInput(n.operatorName);
      }),
    []
  );
  useEffect(() => robotCamBroadcaster.subscribe(setStatus), []);

  const keyValid = normalizeKey(keyInput).length >= 8;
  const keyChanged = normalizeKey(keyInput) !== normalizeKey(s.key);
  const turnChanged = turn.url !== s.turnUrl || turn.user !== s.turnUser || turn.pass !== s.turnPass;

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(s.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard ruxsati yo'q */
    }
  };

  const roleBtn = (role: CamLinkSettings['role'], title: string, sub: string) => (
    <button
      type="button"
      onClick={() => camLinkSettings.set({ role })}
      aria-pressed={s.role === role}
      className={`flex-1 min-w-[200px] text-left p-3 rounded-lg border transition-colors ${
        s.role === role
          ? 'bg-police-blue/20 border-police-cyan text-white'
          : 'bg-tactical-950 border-tactical-800 text-slate-300 hover:border-tactical-600'
      }`}
    >
      <div className="font-bold text-sm">{title}</div>
      <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>
    </button>
  );

  return (
    <div className="hud-panel rounded-xl p-4 space-y-3 font-mono" data-cam-link-settings>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Radio className="w-4 h-4 text-police-cyan" />
          ROBOTLAR PARKI: TASVIR VA TELEMETRIYA (ROBOT → DISPETCHER)
        </h3>
        {s.role === 'robot' && (
          <span className={`text-xs font-bold ${status.duplicate ? 'text-rose-400' : status.state === 'online' ? 'text-police-green' : status.state === 'error' ? 'text-rose-400' : 'text-amber-300'}`}>
            {status.duplicate
              ? status.error
              : status.state === 'online'
              ? `${status.robotId} efirda • ${status.viewers} operator${status.viewerNames.length ? `: ${status.viewerNames.join(', ')}` : ''}`
              : status.state === 'error'
              ? `Xato: ${status.error ?? ''}`
              : 'Ulanmoqda...'}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-400">
        Har bir robot planshet o'z kamerasini ochadi va tasvir, joylashuv, tezlik, yo'nalish (giroskop), batareya va sonar
        ma'lumotlarini uzatadi. Dispetcher kompyuterlari o'z kamerasini ishlatmaydi: barcha robotlar ro'yxatini ko'radi va
        tanlangan robotni kuzatadi. Bitta robotni bir vaqtda 6 tagacha operator kuzata oladi.
      </p>

      <div className="flex gap-3 flex-wrap">
        {roleBtn('robot', 'Robot planshet', 'Bu qurilma kamerani ochadi va tasvir + telemetriyani uzatadi')}
        {roleBtn('operator', 'Operator (dispetcher)', "Bu qurilma robotlarni kuzatadi")}
      </div>

      {s.role === 'robot' ? (
        <div className="p-3 rounded-lg bg-tactical-950 border border-tactical-800 space-y-2">
          <div className="text-xs text-slate-300 font-bold">Robot ID</div>
          <div className="text-[11px] text-slate-500">Har bir robotda boshqacha bo'lsin: QALQON-01, QALQON-02 ...</div>
          <div className="flex gap-2 items-center">
            <input
              value={idInput}
              onChange={(e) => setIdInput(normalizeRobotId(e.target.value) || e.target.value.toUpperCase())}
              spellCheck={false}
              className="flex-1 min-w-[160px] bg-tactical-900 border border-tactical-700 rounded-lg px-3 py-2 text-white text-base tracking-widest focus:outline-none focus:border-police-cyan"
            />
            {normalizeRobotId(idInput) !== s.robotId && (
              <button
                type="button"
                onClick={() => camLinkSettings.set({ robotId: normalizeRobotId(idInput) })}
                className="px-3 py-2 rounded-lg bg-police-blue text-white text-xs font-bold"
              >
                Saqlash
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="p-3 rounded-lg bg-tactical-950 border border-tactical-800 space-y-2">
          <div className="text-xs text-slate-300 font-bold">Operator ismi (ixtiyoriy)</div>
          <div className="text-[11px] text-slate-500">Robot planshetida kim kuzatayotgani ko'rinadi. ID berish shart emas.</div>
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={() => nameInput !== s.operatorName && camLinkSettings.set({ operatorName: nameInput.trim().slice(0, 40) })}
            placeholder="Masalan: Navbatchi 1"
            className="w-full bg-tactical-900 border border-tactical-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-police-cyan"
          />
        </div>
      )}

      <div className="p-3 rounded-lg bg-tactical-950 border border-tactical-800 space-y-2">
        <div className="text-xs text-slate-300 font-bold">Park kodi</div>
        <div className="text-[11px] text-slate-500">
          Barcha robot va operator qurilmalarida BIR XIL bo'lishi kerak. Kodni bilmagan odam hech narsani ko'ra olmaydi
          (barcha xabarlar shu kod bilan shifrlanadi).
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <input
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
            spellCheck={false}
            className="flex-1 min-w-[180px] bg-tactical-900 border border-tactical-700 rounded-lg px-3 py-2 text-white text-base tracking-widest focus:outline-none focus:border-police-cyan"
          />
          {keyChanged && (
            <button
              type="button"
              disabled={!keyValid}
              onClick={() => camLinkSettings.set({ key: keyInput.trim() })}
              className="px-3 py-2 rounded-lg bg-police-blue text-white text-xs font-bold disabled:opacity-40"
            >
              Saqlash
            </button>
          )}
          <button
            type="button"
            onClick={copyKey}
            title="Nusxa olish"
            className="px-3 py-2 rounded-lg bg-tactical-800 border border-tactical-700 text-slate-200 text-xs flex items-center gap-1.5"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Nusxa
          </button>
          {s.role === 'robot' && (
            <button
              type="button"
              onClick={() => camLinkSettings.regenerateKey()}
              title="Yangi park kodi: uni barcha robot va operator qurilmalariga ham kiritish kerak"
              className="px-3 py-2 rounded-lg bg-tactical-800 border border-tactical-700 text-slate-200 text-xs flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Yangi kod
            </button>
          )}
        </div>
        {!keyValid && <div className="text-[11px] text-rose-400">Kod kamida 8 ta harf/raqamdan iborat bo'lsin</div>}
      </div>

      <details className="p-3 rounded-lg bg-tactical-950 border border-tactical-800 text-xs">
        <summary className="cursor-pointer text-slate-300 font-bold">TURN server (ixtiyoriy)</summary>
        <div className="text-[11px] text-slate-500 mt-2">
          Robot mobil internetda bo'lsa, ba'zan to'g'ridan-to'g'ri ulanish bo'lmaydi. Shunda ikkala qurilmaga bir xil TURN server
          kiriting (masalan turn:turn.example.com:3478). Bir nechta manzilni vergul bilan ajrating.
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
          <input placeholder="turn:host:3478" value={turn.url} onChange={(e) => setTurn({ ...turn, url: e.target.value })} className="bg-tactical-900 border border-tactical-700 rounded px-2 py-1.5 text-white" />
          <input placeholder="Foydalanuvchi" value={turn.user} onChange={(e) => setTurn({ ...turn, user: e.target.value })} className="bg-tactical-900 border border-tactical-700 rounded px-2 py-1.5 text-white" />
          <input placeholder="Parol" type="password" value={turn.pass} onChange={(e) => setTurn({ ...turn, pass: e.target.value })} className="bg-tactical-900 border border-tactical-700 rounded px-2 py-1.5 text-white" />
        </div>
        {turnChanged && (
          <button
            type="button"
            onClick={() => camLinkSettings.set({ turnUrl: turn.url.trim(), turnUser: turn.user, turnPass: turn.pass })}
            className="mt-2 px-3 py-1.5 rounded-lg bg-police-blue text-white font-bold"
          >
            TURN ni saqlash
          </button>
        )}
      </details>
    </div>
  );
};
