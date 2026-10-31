import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useRobot } from '../context/RobotContext';
import {
  Shield,
  Lock,
  Radio,
  BatteryMedium,
  BatteryCharging,
  Clock,
  Eye,
  AlertOctagon
} from 'lucide-react';
import { tacticalAudio } from '../services/audioService';

interface RobotFaceViewProps {
  onUnlockRequest: () => void;
}

export const RobotFaceView: React.FC<RobotFaceViewProps> = ({ onUnlockRequest }) => {
  const { battery, system, triggerSOS } = useRobot();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [modelLoaded, setModelLoaded] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');

  // Clock updates
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setCurrentDate(now.toLocaleDateString('uz-UZ', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Three.js 3D Scene for result.glb inside the robot glass viewport
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05080e);
    scene.fog = new THREE.FogExp2(0x05080e, 0.08);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 1.45, 2.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    container.appendChild(renderer.domElement);

    // Tactical Lights inside the tower
    const ambientLight = new THREE.AmbientLight(0x223355, 1.6);
    scene.add(ambientLight);

    // Key front light
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(1.5, 3.0, 3.5);
    scene.add(keyLight);

    // Police Cyan rim light
    const cyanRim = new THREE.PointLight(0x00e5ff, 3.5, 8);
    cyanRim.position.set(-2.0, 2.2, -1.0);
    scene.add(cyanRim);

    // Police Red/Blue patrol atmosphere light
    const bluePatrolLight = new THREE.PointLight(0x1d63ff, 3.0, 7);
    bluePatrolLight.position.set(2.0, 2.0, -0.8);
    scene.add(bluePatrolLight);

    let mixer: THREE.AnimationMixer | null = null;
    let characterModel: THREE.Object3D | null = null;
    let headBone: THREE.Object3D | null = null;

    const loader = new GLTFLoader();
    loader.load(
      '/result.glb',
      (gltf) => {
        characterModel = gltf.scene;

        // Auto center and scale model
        const box = new THREE.Box3().setFromObject(characterModel);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        // Normalize height so model fits nicely in upper torso / face view
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 1.85 / (maxDim || 1);
        characterModel.scale.set(scale, scale, scale);

        // Adjust position so face/chest is centered
        characterModel.position.x = -center.x * scale;
        characterModel.position.y = -center.y * scale + 1.25;
        characterModel.position.z = -center.z * scale;

        // Traverse to find head or neck bones for subtle looking animation
        characterModel.traverse((child) => {
          const name = child.name.toLowerCase();
          if (!headBone && (name.includes('head') || name.includes('neck') || name.includes('bip_head'))) {
            headBone = child;
          }
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        if (gltf.animations && gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(characterModel);
          const action = mixer.clipAction(gltf.animations[0]);
          action.play();
        }

        scene.add(characterModel);
        setModelLoaded(true);
      },
      (xhr) => {
        if (xhr.total > 0) {
          setLoadingProgress(Math.round((xhr.loaded / xhr.total) * 100));
        }
      },
      (err) => {
        console.warn('Failed to load result.glb:', err);
        setModelLoaded(true);
      }
    );

    // Animation Loop: Person looks left and right actively scanning the scene
    let reqId: number;
    const clock = new THREE.Clock();
    let currentLookAngle = 0;
    let targetLookAngle = 0;
    let nextLookChange = 0;

    const animate = () => {
      reqId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const time = clock.getElapsedTime();

      if (mixer) {
        mixer.update(delta);
      }

      // Smooth surveillance looking left, right, forward rhythm
      if (time > nextLookChange) {
        // Choose scanning target angle: -0.42 (left), 0 (center), +0.42 (right)
        const angles = [-0.42, 0.42, 0.0, -0.35, 0.35];
        targetLookAngle = angles[Math.floor(Math.random() * angles.length)];
        nextLookChange = time + 2.5 + Math.random() * 2.0;
      }

      currentLookAngle += (targetLookAngle - currentLookAngle) * (delta * 2.4);

      if (headBone) {
        headBone.rotation.y = currentLookAngle * 0.75;
        headBone.rotation.x = Math.sin(time * 1.5) * 0.04;
      } else if (characterModel) {
        characterModel.rotation.y = currentLookAngle;
        characterModel.position.y = 1.25 + Math.sin(time * 1.8) * 0.015;
      }

      // Camera slight breathing float
      camera.position.x = Math.sin(time * 0.6) * 0.04;
      camera.position.y = 1.45 + Math.cos(time * 0.8) * 0.02;

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(reqId);
      window.removeEventListener('resize', handleResize);
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return (
    <div className="relative w-full h-full bg-[#05080e] overflow-hidden select-none flex flex-col justify-between">
      {/* 3D Model WebGL Canvas Container */}
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Cyber Glass / Lexan Armor Overlay */}
      <div className="absolute inset-0 pointer-events-none z-10">
        <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500/5 via-transparent to-blue-500/10" />
        <div className="absolute inset-0 scanlines opacity-40" />

        {/* Armor Frame Brackets */}
        <div className="absolute top-4 left-4 w-12 h-12 border-t-2 border-l-2 border-police-cyan/60" />
        <div className="absolute top-4 right-4 w-12 h-12 border-t-2 border-r-2 border-police-cyan/60" />
        <div className="absolute bottom-4 left-4 w-12 h-12 border-b-2 border-l-2 border-police-cyan/60" />
        <div className="absolute bottom-4 right-4 w-12 h-12 border-b-2 border-r-2 border-police-cyan/60" />

        {/* Hexagon Grid Pattern Overlays */}
        <div className="absolute top-1/2 left-8 transform -translate-y-1/2 opacity-20 hidden md:block">
          <div className="space-y-2 font-mono text-[9px] text-police-cyan">
            <div>SYS: STABLE</div>
            <div>CORE: ACTIVE</div>
            <div>RADAR: 360°</div>
            <div>AI_VISION: ON</div>
          </div>
        </div>

        <div className="absolute top-1/2 right-8 transform -translate-y-1/2 opacity-20 hidden md:block text-right">
          <div className="space-y-2 font-mono text-[9px] text-police-cyan">
            <div>IIV TACTICAL</div>
            <div>LEXAN: 4.0MM</div>
            <div>STATUS: PATROL</div>
            <div>ZONE: SEKTOR 4</div>
          </div>
        </div>
      </div>

      {/* Loading Indicator */}
      {!modelLoaded && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-tactical-950/90 backdrop-blur-md">
          <div className="w-14 h-14 rounded-full border-2 border-police-cyan border-t-transparent animate-spin mb-4" />
          <div className="font-mono text-xs font-bold text-police-cyan tracking-widest uppercase">
            3D PATRUL MODELI YUKLANMOQDA ({loadingProgress}%)
          </div>
          <div className="w-56 h-1.5 bg-tactical-800 rounded-full mt-3 overflow-hidden border border-tactical-700">
            <div
              className="h-full bg-police-cyan transition-all duration-300"
              style={{ width: `${loadingProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* TOP HEADER: IIV Brand, Clock, Battery & Operator Login Button */}
      <header className="relative z-20 px-6 py-4 flex items-center justify-between">
        {/* Left: IIV Badge */}
        <div className="flex items-center space-x-3 bg-tactical-950/80 backdrop-blur-md px-3.5 py-2 rounded-xl border border-tactical-700/60 shadow-lg">
          <div className="w-9 h-9 rounded-lg bg-police-blue/20 border border-police-cyan/50 flex items-center justify-center">
            <Shield className="w-5 h-5 text-police-cyan animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-mono font-black text-sm text-white tracking-wider">
                QALQON
              </span>
              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-police-blue/30 text-police-cyan border border-police-blue/50">
                IIV-01
              </span>
            </div>
            <div className="text-[10px] font-mono text-emerald-400 flex items-center space-x-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              <span>JAMOAT XAVFSIZLIGI PATRULI</span>
            </div>
          </div>
        </div>

        {/* Center: Live Time & Sector Display */}
        <div className="flex flex-col items-center bg-tactical-950/80 backdrop-blur-md px-5 py-1.5 rounded-xl border border-tactical-700/60 shadow-lg">
          <div className="font-mono text-lg font-black text-white tracking-widest flex items-center space-x-1.5">
            <Clock className="w-4 h-4 text-police-cyan" />
            <span>{currentTime || '12:00:00'}</span>
          </div>
          <div className="font-mono text-[10px] text-slate-400">
            {currentDate} • SEKTOR 4 (AMIR TEMUR)
          </div>
        </div>

        {/* Right: LiFePO4 Battery & OPERATOR LOGIN BUTTON */}
        <div className="flex items-center space-x-3">
          {/* Battery */}
          <div className="flex items-center space-x-1.5 bg-tactical-950/80 backdrop-blur-md px-3 py-2 rounded-xl border border-tactical-700/60 font-mono text-xs">
            {battery.isCharging ? (
              <BatteryCharging className="w-4 h-4 text-emerald-400 animate-pulse" />
            ) : (
              <BatteryMedium className={`w-4 h-4 ${battery.percentage < 25 ? 'text-rose-500' : 'text-emerald-400'}`} />
            )}
            <span className="text-white font-bold">{battery.voltage.toFixed(1)}V</span>
            <span className="text-slate-400 text-[10px]">({battery.percentage}%)</span>
          </div>

          {/* Locked Operator Access Button */}
          <button
            onClick={() => {
              tacticalAudio.playClick();
              onUnlockRequest();
            }}
            title="Operator Boshqaruv Paneliga Kirish"
            className="flex items-center space-x-2 bg-gradient-to-r from-tactical-900 to-police-blue/30 hover:from-police-blue/40 hover:to-police-blue text-police-cyan hover:text-white px-4 py-2.5 rounded-xl border border-police-cyan/50 shadow-[0_0_15px_rgba(0,229,255,0.25)] transition-all active:scale-95 font-mono text-xs font-bold"
          >
            <Lock className="w-4 h-4 text-police-cyan" />
            <span className="hidden sm:inline">OPERATOR KIRISH</span>
          </button>
        </div>
      </header>

      {/* BOTTOM FOOTER: Public SOS 102 Hotline & Public Status */}
      <footer className="relative z-20 px-6 py-4 flex items-end justify-between">
        {/* Left Status: Looking & Surveillance Mode */}
        <div className="bg-tactical-950/80 backdrop-blur-md p-3 rounded-xl border border-tactical-700/60 font-mono text-xs max-w-xs hidden sm:block">
          <div className="flex items-center space-x-2 text-police-cyan font-bold mb-1">
            <Eye className="w-4 h-4 animate-pulse" />
            <span>AKTIV KUZATUV VA NAZORAT</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-snug">
            3D Operator kiber-minora ichida atrofni sergak kuzatmoqda. Favqulodda holatlarda SOS tugmasidan foydalaning.
          </p>
        </div>

        {/* Center: Big Public SOS 102 Quick Button */}
        <div className="flex flex-col items-center">
          <button
            onClick={() => {
              tacticalAudio.playClick();
              triggerSOS();
            }}
            className="group relative flex items-center space-x-3 bg-gradient-to-r from-rose-700 via-rose-600 to-red-600 text-white px-8 py-3.5 rounded-full border-2 border-rose-300 shadow-[0_0_35px_rgba(255,34,56,0.8)] active:scale-95 transition-all"
          >
            <span className="absolute -inset-1 rounded-full bg-rose-600/40 animate-ping" />
            <AlertOctagon className="w-7 h-7 text-white drop-shadow animate-bounce" />
            <div className="flex flex-col items-start text-left font-mono">
              <span className="text-sm font-black tracking-wider leading-none">FAVQULODDA YORDAM</span>
              <span className="text-xl font-extrabold tracking-widest text-rose-100">SOS 102</span>
            </div>
          </button>
          <span className="text-[10px] font-mono text-slate-400 mt-1.5">
            IIV Tezkor Navbatchilik Qismiga to'g'ridan-to'g'ri aloqa
          </span>
        </div>

        {/* Right Status: Hardware Health */}
        <div className="bg-tactical-950/80 backdrop-blur-md p-3 rounded-xl border border-tactical-700/60 font-mono text-xs text-right hidden sm:block">
          <div className="text-emerald-400 font-bold flex items-center justify-end space-x-1 mb-1">
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span>TIZIM ONLAYN</span>
          </div>
          <div className="text-[11px] text-slate-400">
            PING: {system.pingMs}ms • RPi 5 • ARDUINO UNO
          </div>
          <div className="text-[10px] text-police-cyan mt-0.5">
            4mm LEXAN ZIRHLI HIMOYADA
          </div>
        </div>
      </footer>
    </div>
  );
};
