import React, { useState } from 'react';
import { Lock, KeyRound, User, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { tacticalAudio } from '../services/audioService';

interface OperatorAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const OperatorAuthModal: React.FC<OperatorAuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [username, setUsername] = useState('operator');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    tacticalAudio.playClick();

    // Default operator credentials (login: operator / admin, parol: 102 yoki admin102)
    const validLogin = username.trim().toLowerCase() === 'operator' || username.trim().toLowerCase() === 'admin';
    const validPass = password === '102' || password === 'admin102' || password === 'admin';

    if (validLogin && validPass) {
      setError(false);
      setSuccess(true);
      tacticalAudio.playCommandBeep();
      setTimeout(() => {
        setSuccess(false);
        setPassword('');
        onSuccess();
      }, 600);
    } else {
      setError(true);
      tacticalAudio.playObstacleAlert();
      setTimeout(() => setError(false), 2500);
    }
  };

  const handleQuickKey = (num: string) => {
    tacticalAudio.playClick();
    setPassword((prev) => (prev.length < 8 ? prev + num : prev));
  };

  const handleClear = () => {
    tacticalAudio.playClick();
    setPassword('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-tactical-950/80 backdrop-blur-md select-none">
      <div className="hud-panel rounded-2xl w-full max-w-md p-6 border-2 border-police-cyan/60 shadow-[0_0_40px_rgba(0,229,255,0.25)] relative">
        {/* Close Button */}
        <button
          onClick={() => {
            tacticalAudio.playClick();
            onClose();
          }}
          className="absolute top-4 right-4 p-1.5 rounded-lg bg-tactical-900 text-slate-400 hover:text-white border border-tactical-700 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3 mb-5">
          <div className="w-12 h-12 rounded-xl bg-police-blue/20 border border-police-cyan flex items-center justify-center shadow-inner">
            <Lock className="w-6 h-6 text-police-cyan animate-pulse" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-white font-mono tracking-wider">
              OPERATOR AUTENTIFIKATSIYASI
            </h2>
            <p className="text-xs font-mono text-slate-400">
              IIV "QALQON" Boshqaruv Markaziga Kirish
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 font-mono text-xs">
          <div>
            <label className="block text-slate-300 font-bold mb-1 flex items-center space-x-1.5">
              <User className="w-3.5 h-3.5 text-police-cyan" />
              <span>OPERATOR LOGINI:</span>
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="operator"
              className="w-full bg-tactical-950 border border-tactical-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-police-cyan"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-bold mb-1 flex items-center space-x-1.5">
              <KeyRound className="w-3.5 h-3.5 text-police-cyan" />
              <span>MAXFIY PAROL / PIN (Masalan: 102):</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••"
              className="w-full bg-tactical-950 border border-tactical-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-lg tracking-widest text-center focus:outline-none focus:border-police-cyan"
            />
          </div>

          {/* Quick On-Screen Numpad for Touchscreen */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  if (key === 'C') handleClear();
                  else if (key === '⌫') setPassword((p) => p.slice(0, -1));
                  else handleQuickKey(key);
                }}
                className={`py-2 rounded-lg border font-mono font-bold text-sm transition-all active:scale-95 ${
                  key === 'C'
                    ? 'bg-rose-950/60 text-rose-300 border-rose-800'
                    : key === '⌫'
                    ? 'bg-tactical-800 text-slate-300 border-tactical-700'
                    : 'bg-tactical-900 text-white border-tactical-700 hover:border-police-cyan'
                }`}
              >
                {key}
              </button>
            ))}
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-700 text-rose-300 flex items-center space-x-2 text-[11px] animate-shake">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Xato: Login yoki parol noto'g'ri! (Parol: 102)</span>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="p-2.5 rounded-lg bg-emerald-950/80 border border-emerald-700 text-emerald-300 flex items-center space-x-2 text-[11px]">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Ruxsat berildi! Operator paneli ochilmoqda...</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-gradient-to-r from-police-blue to-blue-600 hover:from-blue-600 hover:to-police-blue text-white font-mono font-bold text-sm shadow-[0_0_20px_rgba(29,99,255,0.4)] active:scale-95 transition-all mt-2"
          >
            PANELNI OCHISH
          </button>
        </form>

        <div className="text-center font-mono text-[10px] text-slate-400 mt-4">
          Standart ruxsat: Login: <span className="text-white">operator</span> • Parol: <span className="text-white">102</span>
        </div>
      </div>
    </div>
  );
};
