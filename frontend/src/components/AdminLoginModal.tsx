import React, { useState } from 'react';
import { ShieldCheck, X, AlertTriangle, RefreshCw } from 'lucide-react';
import { RemoteLink, loadRemoteConfig, normalizeBaseUrl, saveRemoteConfig } from '../services/remoteClient';

interface AdminLoginModalProps {
  onClose: () => void;
  onConnected: (link: RemoteLink) => void;
}

/** Admin kirishi: Pi API manzili (Cloudflare Tunnel) va admin token. Token Pi tomonida tekshiriladi */
export const AdminLoginModal: React.FC<AdminLoginModalProps> = ({ onClose, onConnected }) => {
  const saved = loadRemoteConfig();
  const [url, setUrl] = useState(saved.baseUrl);
  const [token, setToken] = useState(saved.token);
  const [remember, setRemember] = useState(!!saved.token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const baseUrl = normalizeBaseUrl(url);
    if (!baseUrl) {
      setError("Pi API manzili noto'g'ri. Masalan: https://nom.trycloudflare.com");
      return;
    }
    if (!token.trim()) {
      setError('Admin tokenni kiriting');
      return;
    }
    setBusy(true);
    setError(null);
    const link = new RemoteLink({ baseUrl, token: token.trim() });
    const res = await link.verify();
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    saveRemoteConfig({ baseUrl, token: token.trim() }, remember);
    onConnected(link);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 select-none">
      <form onSubmit={submit} className="float-window w-full max-w-md p-6 flex flex-col gap-4" aria-label="Admin kirishi">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-police-blue/20 text-police-cyan">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Admin kirishi</h2>
              <p className="text-xs text-slate-400">Masofaviy qo'lda boshqaruv</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Yopish" className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-tactical-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-300">
          Raspberry Pi API manzili
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://nom.trycloudflare.com"
            className="bg-tactical-950 border border-tactical-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-police-cyan"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-300">
          Admin token
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="bg-tactical-950 border border-tactical-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-police-cyan"
          />
        </label>

        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-police-cyan" />
          Tokenni shu planshetda eslab qolish
        </label>

        {error && (
          <div role="alert" className="p-2.5 rounded-lg bg-police-red/10 border border-police-red/50 text-police-red text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2.5 rounded-lg bg-police-cyan text-tactical-950 text-sm font-semibold flex items-center justify-center gap-2 transition-transform active:scale-95 disabled:opacity-60"
        >
          {busy && <RefreshCw className="w-4 h-4 animate-spin" />}
          {busy ? 'Tekshirilmoqda...' : 'Ulanish'}
        </button>
      </form>
    </div>
  );
};
