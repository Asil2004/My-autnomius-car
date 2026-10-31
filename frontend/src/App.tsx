import React from 'react';
import { RobotProvider, useRobot } from './context/RobotContext';
import { Navbar } from './components/Navbar';
import { TabNavigation } from './components/TabNavigation';
import { HUDView } from './components/HUDView';
import { SOSView } from './components/SOSView';
import { AIAutonomousView } from './components/AIAutonomousView';
import { LidarRadarView } from './components/LidarRadarView';
import { SettingsView } from './components/SettingsView';

const MainContent: React.FC = () => {
  const { activeTab } = useRobot();

  return (
    <main className="flex-1 flex flex-col overflow-hidden relative">
      {activeTab === 'hud' && <HUDView />}
      {activeTab === 'sos' && <SOSView />}
      {activeTab === 'ai' && <AIAutonomousView />}
      {activeTab === 'telemetry' && <LidarRadarView />}
      {activeTab === 'settings' && <SettingsView />}
    </main>
  );
};

export function App() {
  return (
    <RobotProvider>
      <div className="flex flex-col h-screen w-screen bg-tactical-950 text-slate-100 overflow-hidden font-sans select-none">
        <Navbar />
        <MainContent />
        <TabNavigation />
      </div>
    </RobotProvider>
  );
}

export default App;
