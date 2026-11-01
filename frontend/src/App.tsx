import React, { useState } from 'react';
import { RobotProvider, useRobot } from './context/RobotContext';
import { Navbar } from './components/Navbar';
import { TabNavigation } from './components/TabNavigation';
import { HUDView } from './components/HUDView';
import { SOSView } from './components/SOSView';
import { AIAutonomousView } from './components/AIAutonomousView';
import { LidarRadarView } from './components/LidarRadarView';
import { GoogleMapsPatrolView } from './components/GoogleMapsPatrolView';
import { SettingsView } from './components/SettingsView';
import { RobotFaceView } from './components/RobotFaceView';
import { OperatorAuthModal } from './components/OperatorAuthModal';

const MainContent: React.FC = () => {
  const { activeTab } = useRobot();

  return (
    <main className="flex-1 flex flex-col overflow-hidden relative">
      {activeTab === 'hud' && <HUDView />}
      {activeTab === 'maps' && <GoogleMapsPatrolView />}
      {activeTab === 'sos' && <SOSView />}
      {activeTab === 'ai' && <AIAutonomousView />}
      {activeTab === 'telemetry' && <LidarRadarView />}
      {activeTab === 'settings' && <SettingsView />}
    </main>
  );
};

const AppShell: React.FC = () => {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const { sos } = useRobot();

  // If public SOS is triggered, show SOS View directly
  if (sos.active && !isUnlocked) {
    return (
      <div className="flex flex-col h-screen w-screen bg-tactical-950 text-slate-100 overflow-hidden font-sans select-none">
        <Navbar onLockScreen={() => setIsUnlocked(false)} />
        <SOSView />
      </div>
    );
  }

  // DEFAULT VIEW: Robot Minora Yuzi (Oyna ortida 3D result.glb odam)
  if (!isUnlocked) {
    return (
      <div className="relative h-screen w-screen bg-[#05080e] overflow-hidden select-none">
        <RobotFaceView onUnlockRequest={() => setAuthModalOpen(true)} />
        <OperatorAuthModal
          isOpen={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          onSuccess={() => {
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
      <Navbar onLockScreen={() => setIsUnlocked(false)} />
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
