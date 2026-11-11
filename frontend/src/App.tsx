import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { autopilotService } from './services/autopilotService';
import { situationService } from './services/situationService';
import { RobotProvider, useRobot } from './context/RobotContext';
import { Navbar } from './components/Navbar';
import { TabNavigation } from './components/TabNavigation';
import { HUDView } from './components/HUDView';
import { RobotFaceView } from './components/RobotFaceView';
import { OperatorAuthModal } from './components/OperatorAuthModal';

// Kamdan-kam ochiladigan bo'limlar alohida fayllarda: faqat ochilganda yuklanadi (xarita kutubxonasi va h.k.)
const AIAutonomousView = lazy(() => import('./components/AIAutonomousView').then((m) => ({ default: m.AIAutonomousView })));
const LidarRadarView = lazy(() => import('./components/LidarRadarView').then((m) => ({ default: m.LidarRadarView })));
const GoogleMapsPatrolView = lazy(() =>
  import('./components/GoogleMapsPatrolView').then((m) => ({ default: m.GoogleMapsPatrolView }))
);
const SettingsView = lazy(() => import('./components/SettingsView').then((m) => ({ default: m.SettingsView })));
const AdminLoginModal = lazy(() => import('./components/AdminLoginModal').then((m) => ({ default: m.AdminLoginModal })));
const AdminPanelView = lazy(() => import('./components/AdminPanelView').then((m) => ({ default: m.AdminPanelView })));
const ESP32RemoteView = lazy(() => import('./components/ESP32RemoteView').then((m) => ({ default: m.ESP32RemoteView })));

const ViewLoading: React.FC = () => (
  <div className="flex-1 flex items-center justify-center text-slate-500 font-mono text-xs">Yuklanmoqda…</div>
);
import type { RemoteLink } from './services/remoteClient';
import { robotCamBroadcaster, fleetWatcher, AUTOPILOT_REMOTE_EVENT } from './services/robotCamLink';
import { navigationService } from './services/navigationService';
import { headingService } from './services/headingService';

// Faqat ishlab chiqish rejimida: sinov skriptlari ilova ishlatayotgan servis nusxalarini ko'ra olsin
if (import.meta.env.DEV) {
  (window as unknown as { __qalqon: unknown }).__qalqon = { robotCamBroadcaster, fleetWatcher, navigationService, headingService, autopilotService };
}

/** Robot holatidan (batareya, sonar, buyruq) telemetriyaga: navigatsiya esa navigationService dan to'g'ridan-to'g'ri */
const RobotTelemetryBridge: React.FC = () => {
  const { battery, sonars, lastCommand } = useRobot();
  useEffect(() => {
    robotCamBroadcaster.setTelemetryExtra({
      battery: battery ? { v: battery.voltage, pct: battery.percentage } : undefined,
      sonars: { front: sonars.front, rear: sonars.rear, left: sonars.left, right: sonars.right },
      cmd: lastCommand
    });
  }, [battery, sonars.front, sonars.rear, sonars.left, sonars.right, lastCommand]);
  return null;
};
import { camLinkSettings } from './services/camLinkSettings';

const MainContent: React.FC = () => {
  const { activeTab } = useRobot();
  // ROBOT qurilmasi: HUD (kamera, to'siq/yuz aniqlash, operatorlarga tasvir uzatish, yozuv) doim ishlab turadi,
  // boshqa bo'lim ochilganda faqat ekrandan yashiriladi. Shunda tasvir uzatish va GPS avtopilot istalgan bo'limda ishlaydi
  const [isRobot, setIsRobot] = useState(() => camLinkSettings.get().role === 'robot');
  useEffect(() => camLinkSettings.subscribe((s) => setIsRobot(s.role === 'robot')), []);

  return (
    <main className="flex-1 flex flex-col overflow-hidden relative">
      {isRobot ? (
        <div className={activeTab === 'hud' ? 'contents' : 'hidden'} aria-hidden={activeTab !== 'hud'}>
          <HUDView />
        </div>
      ) : (
        activeTab === 'hud' && <HUDView />
      )}
      <Suspense fallback={<ViewLoading />}>
        {activeTab === 'maps' && <GoogleMapsPatrolView />}
        {activeTab === 'ai' && <AIAutonomousView />}
        {activeTab === 'telemetry' && <LidarRadarView />}
        {activeTab === 'settings' && <SettingsView />}
      </Suspense>
    </main>
  );
};

const AppShell: React.FC = () => {
  // Vaqt, GPS manzil va ob-havoni ilova ochilgandan boshlab kuzatib, saqlab boradi (robot savollarga javob berishi uchun)
  useEffect(() => situationService.start(), []);
  // PARK ALOQASI (qaysi sahifa ochiq bo'lishidan qat'i nazar):
  //  - robot planshet: kamera tasviri va telemetriya operatorlarga uzatiladi;
  //  - operator: barcha robotlar ro'yxati va telemetriyasi kuzatiladi.
  useEffect(() => {
    const apply = (s: { role: string }) => {
      robotCamBroadcaster.stop();
      fleetWatcher.stop();
      if (s.role === 'robot') void robotCamBroadcaster.start();
      else void fleetWatcher.start();
    };
    apply(camLinkSettings.get());
    const unsub = camLinkSettings.subscribe(apply);
    return () => {
      unsub();
      robotCamBroadcaster.stop();
      fleetWatcher.stop();
    };
  }, []);
  const [isUnlocked, setIsUnlocked] = useState(() =>
    window.location.hash === '#hud' || localStorage.getItem('qalqon_auto_unlock') === 'true'
  );
  // Operator masofadan GPS avtopilotni yoqsa va robot yuz ekranida bo'lsa: boshqaruv paneli ochiladi (unda kamera
  // to'siq tahlili doim ishlaydi, qaysi bo'lim ochiqligidan qat'i nazar). Avtopilot tugagach yuz ekraniga qaytadi
  const relockAfterAutopilotRef = useRef(false);
  useEffect(() => {
    const onRemote = () => {
      setIsUnlocked((was) => {
        if (!was) relockAfterAutopilotRef.current = true;
        return true;
      });
    };
    window.addEventListener(AUTOPILOT_REMOTE_EVENT, onRemote);
    const unsub = autopilotService.subscribe((s) => {
      if (!s.active && relockAfterAutopilotRef.current) {
        relockAfterAutopilotRef.current = false;
        setIsUnlocked(false);
      }
    });
    return () => {
      window.removeEventListener(AUTOPILOT_REMOTE_EVENT, onRemote);
      unsub();
    };
  }, []);
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
      <Suspense fallback={<ViewLoading />}>
        <ESP32RemoteView
          onExit={() => {
            setControllerOpen(false);
            if (['#controller', '#esp32', '#remote'].includes(window.location.hash)) {
              history.replaceState(null, '', window.location.pathname);
            }
          }}
        />
      </Suspense>
    );
  }

  if (adminLink) {
    return (
      <Suspense fallback={<ViewLoading />}>
        <AdminPanelView link={adminLink} onExit={() => setAdminLink(null)} />
      </Suspense>
    );
  }

  // DEFAULT VIEW: Robot yuzi (2D ko'zlar, kamera yoqilgach odamni kuzatadi)
  if (!isUnlocked) {
    return (
      <div className="relative app-viewport bg-tactical-950 overflow-hidden select-none">
        <RobotFaceView
          onUnlockRequest={() => setAuthModalOpen(true)}
          onAdminRequest={() => setAdminLoginOpen(true)}
          onControllerRequest={() => setControllerOpen(true)}
        />
        {adminLoginOpen && (
          <Suspense fallback={null}>
            <AdminLoginModal
              onClose={() => setAdminLoginOpen(false)}
              onConnected={(link) => {
                setAdminLoginOpen(false);
                setAdminLink(link);
              }}
            />
          </Suspense>
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
    <div className="flex flex-col app-viewport bg-tactical-950 text-slate-100 overflow-hidden font-sans select-none">
      <Navbar onLockScreen={() => { localStorage.removeItem('qalqon_auto_unlock'); setIsUnlocked(false); }} onOpenController={() => setControllerOpen(true)} />
      <MainContent />
      <TabNavigation />
    </div>
  );
};

export function App() {
  return (
    <RobotProvider>
      <RobotTelemetryBridge />
      <AppShell />
    </RobotProvider>
  );
}

export default App;
