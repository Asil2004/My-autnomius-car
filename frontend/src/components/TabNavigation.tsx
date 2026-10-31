import React from 'react';
import { useRobot } from '../context/RobotContext';
import {
  Gamepad2,
  PhoneCall,
  BrainCircuit,
  Radar,
  Sliders
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface TabItem {
  id: 'hud' | 'sos' | 'ai' | 'telemetry' | 'settings';
  label: string;
  icon: LucideIcon;
  alert?: boolean;
}

export const TabNavigation: React.FC = () => {
  const { activeTab, setActiveTab, sos } = useRobot();

  const tabs: TabItem[] = [
    { id: 'hud', label: 'Boshqaruv HUD', icon: Gamepad2 },
    { id: 'sos', label: 'SOS 102', icon: PhoneCall, alert: sos.active },
    { id: 'ai', label: 'AI & Avtonom', icon: BrainCircuit },
    { id: 'telemetry', label: 'LiDAR Radar', icon: Radar },
    { id: 'settings', label: 'Sozlamalar', icon: Sliders },
  ];

  return (
    <nav className="w-full bg-tactical-950/95 border-t border-tactical-700/60 backdrop-blur-md px-2 py-1.5 flex items-center justify-around z-30 select-none">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative flex flex-col items-center justify-center flex-1 py-1.5 px-1 rounded-md transition-all ${
              isActive
                ? 'text-police-cyan bg-police-blue/15 border-t-2 border-police-cyan shadow-[0_0_12px_rgba(0,229,255,0.2)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-tactical-900/60'
            }`}
          >
            {tab.alert && (
              <span className="absolute top-1 right-1/4 w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            )}
            <Icon className={`w-5 h-5 ${isActive ? 'text-police-cyan drop-shadow-[0_0_6px_rgba(0,229,255,0.7)]' : ''}`} />
            <span className="text-[10px] font-mono tracking-tight mt-0.5 font-medium">
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
