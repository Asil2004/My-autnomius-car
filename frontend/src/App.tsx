import React, { useEffect, useState } from 'react';
import { situationService } from './services/situationService';
import { RobotProvider, useRobot } from './context/RobotContext';
import { Navbar } from './components/Navbar';
import { TabNavigation } from './components/TabNavigation';
import { HUDView } from './components/HUDView';
import { AIAutonomousView } from './components/AIAutonomousView';
import { LidarRadarView } from './components/LidarRadarView';
import { GoogleMapsPatrolView } from './components/GoogleMapsPatrolView';
import { SettingsView } from './components/SettingsView';
import { RobotFaceView } from './components/RobotFaceView';
import { OperatorAuthModal } from './components/OperatorAuthModal';
import { AdminLoginModal } from './components/AdminLoginModal';
import { AdminPanelView } from './components/AdminPanelView';
import { ESP32RemoteView } from './components/ESP32RemoteView';
import type { RemoteLink } from './services/remoteClient';

const MainContent: React.FC = () => {
  const { activeTab } = useRobot();

  return (
    <main className="flex-1 flex flex-col overflow-hidden relative">
      {activeTab === 'hud' && <HUDView />}
      {activeTab === 'maps' && <GoogleMapsPatrolView />}
      {activeTab === 'ai' && <AIAutonomousView />}
      {activeTab === 'telemetry' && <LidarRadarView />}
      {activeTab === 'settings' && <SettingsView />}
    </main>
  );
};

const AppShell: React.FC = () => {
  // Vaqt, GPS manzil va ob-havoni ilova ochilgandan boshlab kuzatib, saqlab boradi (robot savollarga javob berishi uchun)
  useEffect(() => situationService.start(), []);
  const [isUnlocked, setIsUnlocked] = useState(() =>
    window.location.hash === '#hud' || localStorage.getItem('qalqon_auto_unlock') === 'true'
  );
  const [authModalOpen, setAuthModalOpen] = useState(false);
  // Masofaviy admin: ikkinchi planshet saytni #admin bilan ochsa, kirish oynasi darhol chiqadi
  const [adminLoginOpen, setAdminLoginOpen] = useState(() => window.location.hash === '#admin');
  const [adminLink, setAdminLink] = useState<RemoteLink | null>(null);
  const [controllerOpen, setControllerOpen] = useState(() =>
    ['#controller', '#esp32', '#remote'].includes(window.location.hash)
  );

  useEffect(() => {
    const handleHash = () => {
      if (['#controller', '#esp32', '#remote'].includes(window.location.hash)) {
        setControllerOpen(true);
      } else if (window.location.hash === '#admin') {
        setAdminLoginOpen(true);
      } else if (window.location.hash === '#hud') {
        setIsUnlocked(true);
      }
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  if (controllerOpen) {
    return (
      <ESP32RemoteView
        onExit={() => {
          setControllerOpen(false);
          if (['#controller', '#esp32', '#remote'].includes(window.location.hash)) {
            history.replaceState(null, '', window.location.pathname);
          }
        }}
      />
    );
  }

  if (adminLink) {
    return <AdminPanelView link={adminLink} onExit={() => setAdminLink(null)} />;
  }

  // DEFAULT VIEW: Robot yuzi (2D ko'zlar, kamera yoqilgach odamni kuzatadi)
  if (!isUnlocked) {
    return (
      <div className="relative h-screen w-screen bg-tactical-950 overflow-hidden select-none">
        <RobotFaceView
          onUnlockRequest={() => setAuthModalOpen(true)}
          onAdminRequest={() => setAdminLoginOpen(true)}
          onControllerRequest={() => setControllerOpen(true)}
        />
        {adminLoginOpen && (
          <AdminLoginModal
            onClose={() => setAdminLoginOpen(false)}
            onConnected={(link) => {
              setAdminLoginOpen(false);
              setAdminLink(link);
            }}
          />
        )}
        <OperatorAuthModal
          isOpen={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          onSuccess={() => {
            localStorage.setItem('qalqon_auto_unlock', 'true');
            setAuthModalOpen(false);
            setIsUnlocked(true);
          }}
        />
      </div>
    );
  }

  // UNLOCKED VIEW: Full Operator Command Center
  return (
    <div className="flex flex-col h-screen w-screen bg-tactical-950 text-slate-100 overflow-hidden font-sans select-none">
      <Navbar onLockScreen={() => { localStorage.removeItem('qalqon_auto_unlock'); setIsUnlocked(false); }} onOpenController={() => setControllerOpen(true)} />
      <MainContent />
      <TabNavigation />
    </div>
  );
};

export function App() {
  return (
    <RobotProvider>
      <AppShell />
    </RobotProvider>
  );
}

export default App;
