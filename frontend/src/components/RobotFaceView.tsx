import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Lock, Camera, Volume2, Sparkles } from 'lucide-react';
import { tacticalAudio } from '../services/audioService';

interface RobotFaceViewProps {
  onUnlockRequest: () => void;
}

export const RobotFaceView: React.FC<RobotFaceViewProps> = ({ onUnlockRequest }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [modelLoaded, setModelLoaded] = useState<boolean>(false);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [personTracked, setPersonTracked] = useState<boolean>(false);

  // Three.js 60FPS tsiklida holatni o'qish uchun ref'lar
  const lookTargetRef = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });
  const speechEnergyRef = useRef<number>(0);

  // 1. KAMERA ORQALI YUZNI KUZATISH (Face-Tracking)
  useEffect(() => {
    let stream: MediaStream | null = null;
    let scanInterval: number | null = null;
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 36;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
          audio: false
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraActive(true);
        }

        // Yengil va tezkor (15 Hz) odam yuzini / markazini aniqlash algoritmi
        scanInterval = window.setInterval(() => {
          if (!videoRef.current || !ctx || videoRef.current.readyState < 2) return;
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = frame.data;

          let sumX = 0;
          let sumY = 0;
          let count = 0;

          // Inson terisi va yorug'lik konturini aniqlash
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              const idx = (y * canvas.width + x) * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];

              // Inson terisi va yorug'lik rangi heuristikasi
              if (r > 60 && g > 40 && b > 20 && r > g && r > b && (r - g) > 10) {
                sumX += x;
                sumY += y;
                count++;
              }
            }
          }

          if (count > 25) {
            // Yuz topildi: normalizatsiya [-1, 1]
            // X o'qi invert qilinadi (selfie mirror effekti)
            const rawX = 1.0 - (sumX / count) / canvas.width;
            const normX = (rawX - 0.5) * 2.0;
            const normY = ((sumY / count) / canvas.height - 0.5) * 2.0;

            lookTargetRef.current = { x: normX, y: normY, active: true };
            setPersonTracked(true);
          } else {
            lookTargetRef.current.active = false;
            setPersonTracked(false);
          }
        }, 66); // ~15 FPS
      } catch (err) {
        console.warn('Kamera faollashtirilmadi yoki ruxsat berilmadi (Sensorli kuzatuv ishlatiladi):', err);
        setCameraActive(false);
      }
    }

    startCamera();

    return () => {
      if (scanInterval) clearInterval(scanInterval);
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // Sichqoncha yoki barmoq tekkanda unga qarash (Fallback Look-At)
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!lookTargetRef.current.active) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2.0;
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2.0;
      lookTargetRef.current = { x, y, active: true };
    }
  };

  const handlePointerLeave = () => {
    if (!cameraActive) {
      lookTargetRef.current.active = false;
    }
  };

  // 2. AI OVOZI VA NUTQGA MOS HARAKAT (Speaking Speech Mimicry)
  const triggerAiSpeechDemo = () => {
    if (isSpeaking) return;
    setIsSpeaking(true);
    tacticalAudio.playCommandBeep();

    const phrases = [
      "Assalomu alaykum! Men QALQON avtonom patrul robotiman. Xavfsizligingiz nazorat ostida.",
      "Navoiy ko'chasi va xiyobonlarida tinchlik va jamoat tartibi ta'minlanmoqda.",
      "Kamerangiz orqali sizni ko'rib turibman. Sizga qanday yordam bera olaman?",
      "360 gradusli LiDAR va AI kameralari to'liq ishchi holatda."
    ];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(phrase);
      utter.lang = 'uz-UZ';
      utter.rate = 1.0;
      utter.pitch = 1.05;

      utter.onstart = () => {
        speechEnergyRef.current = 0.85;
      };

      utter.onboundary = () => {
        speechEnergyRef.current = 1.0;
      };

      utter.onend = () => {
        setIsSpeaking(false);
        speechEnergyRef.current = 0;
      };

      utter.onerror = () => {
        setIsSpeaking(false);
        speechEnergyRef.current = 0;
      };

      window.speechSynthesis.speak(utter);
    } else {
      speechEnergyRef.current = 0.9;
      setTimeout(() => {
        setIsSpeaking(false);
        speechEnergyRef.current = 0;
      }, 3500);
    }
  };

  // 3. THREE.JS 3D RENDER VA DINAMIK KINEMATIKA SIKLI
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Mobil qurilmalarni aniqlash
    const isMobile =
      /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      window.innerWidth < 768;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    const bgColor = new THREE.Color(0xd7f5dc);
    scene.background = bgColor;
    if (!isMobile) {
      scene.fog = new THREE.FogExp2(0xd7f5dc, 0.04);
    }

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 50);
    camera.position.set(0, 1.42, 2.7);

    // Optimized WebGLRenderer for mobile: disable antialias on high-DPI mobile, clamp DPR to 1.2
    const renderer = new THREE.WebGLRenderer({
      antialias: !isMobile,
      alpha: false,
      powerPreference: isMobile ? 'default' : 'high-performance',
      precision: isMobile ? 'mediump' : 'highp',
      stencil: false,
      depth: true
    });
    renderer.setSize(width, height);
    const maxDpr = isMobile ? 1.2 : 1.75;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.38;
    container.appendChild(renderer.domElement);

    // Optimized Lighting
    const ambientLight = new THREE.AmbientLight(0xd7f5dc, isMobile ? 2.4 : 2.0);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(1.5, 3.5, 3.0);
    scene.add(keyLight);

    const rimLightLeft = new THREE.DirectionalLight(0x00ff88, 2.2);
    rimLightLeft.position.set(-2.5, 2.0, 1.0);
    scene.add(rimLightLeft);

    const rimLightRight = new THREE.DirectionalLight(0x66ffff, 2.2);
    rimLightRight.position.set(2.5, 1.8, 1.0);
    scene.add(rimLightRight);

    // Pivot Wrapper Group
    const characterWrapper = new THREE.Group();
    characterWrapper.position.set(0, 1.28, 0);
    scene.add(characterWrapper);

    const BASE_ROTATION_Y = -Math.PI / 2; // Modelni to'g'ri ekranga qaratish
    characterWrapper.rotation.y = BASE_ROTATION_Y;

    let loadedHeadModel: THREE.Object3D | null = null;

    function enhanceMaterial(mat: THREE.Material): THREE.Material {
      const m = mat as THREE.MeshStandardMaterial;
      if (m && m.isMeshStandardMaterial) {
        m.roughness = 0.22;
        m.metalness = 0.40;
        m.emissive = new THREE.Color(0x0f3318);
        m.emissiveIntensity = 0.22;
      }
      return m;
    }

    const loader = new GLTFLoader();
    loader.load(
      (import.meta.env.BASE_URL || './') + 'result.glb',
      (gltf) => {
        const model = gltf.scene;
        loadedHeadModel = model;

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 1.95 / (maxDim || 1);
        model.scale.set(scale, scale, scale);
        model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.frustumCulled = true;
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();

            const mat = mesh.material;
            if (Array.isArray(mat)) {
              mesh.material = mat.map((m) => enhanceMaterial(m));
            } else if (mat) {
              mesh.material = enhanceMaterial(mat);
            }
          }
        });

        characterWrapper.add(model);
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

    // Kinematika o'zgaruvchilari
    let reqId: number;
    const clock = new THREE.Clock();
    let currentYaw = 0;
    let currentPitch = 0;
    let currentRoll = 0;

    let targetLookAngle = 0;
    let nextLookChange = 0;

    let lastFrameTime = performance.now();
    const targetFps = isMobile ? 55 : 60;
    const frameInterval = 1000 / targetFps;

    const animate = (currentTime: number) => {
      reqId = requestAnimationFrame(animate);

      if (document.hidden) return;

      const elapsed = currentTime - lastFrameTime;
      if (elapsed < frameInterval - 1) return;
      lastFrameTime = currentTime - (elapsed % frameInterval);

      const delta = clock.getDelta();
      const time = clock.getElapsedTime();

      const target = lookTargetRef.current;
      const speechEnergy = speechEnergyRef.current;

      let desiredYaw = 0;
      let desiredPitch = 0;
      let desiredRoll = 0;

      if (target.active) {
        // INSON QAYERDAN QARASA, TO'G'RI UNGA QARASH (Look-At Face Tracking)
        desiredYaw = target.x * 0.42;    // O'ngga/chapga burilish (~25 daraja)
        desiredPitch = -target.y * 0.28; // Tepa/pastga qarash (~16 daraja)
        desiredRoll = -target.x * 0.08;  // Insoniy tabiiy bosh qiyaligi (Head tilt)
      } else {
        // Odam ko'rinmaganda: tabiiy atrofni kuzatish (Idle patrol scan)
        if (time > nextLookChange) {
          const angles = [-0.28, 0.28, 0.0, -0.18, 0.18, 0.0];
          targetLookAngle = angles[Math.floor(Math.random() * angles.length)];
          nextLookChange = time + 2.5 + Math.random() * 2.0;
        }
        desiredYaw = targetLookAngle;
        desiredPitch = Math.sin(time * 0.8) * 0.04;
        desiredRoll = Math.sin(time * 0.5) * 0.02;
      }

      // Silliq burilish interpolatsiyasi (Slerp smoothing)
      currentYaw += (desiredYaw - currentYaw) * (delta * 3.5);
      currentPitch += (desiredPitch - currentPitch) * (delta * 3.5);
      currentRoll += (desiredRoll - currentRoll) * (delta * 3.5);

      // AI OVOZIGA MOS HARAKAT (Speaking Lip/Head Sync)
      let speechNod = 0;
      let speechJawScale = 1.0;
      if (speechEnergy > 0.05) {
        // Gapirayotganda boshning so'z urg'usi bilan vertikal egilishi
        speechNod = Math.sin(time * 14.0) * speechEnergy * 0.05;
        // Jag' va og'iz qismining elastik cho'zilishi
        speechJawScale = 1.0 + Math.abs(Math.sin(time * 16.0)) * speechEnergy * 0.05;

        // Ovoz chiqayotganda yorug'lik pulsatsiyasi
        rimLightLeft.intensity = 2.2 + Math.sin(time * 20.0) * 1.0;
        rimLightRight.intensity = 2.2 + Math.cos(time * 20.0) * 1.0;

        // Nutq energiyasini sekin so'ndirish
        speechEnergyRef.current = Math.max(0, speechEnergyRef.current - delta * 0.4);
      } else {
        rimLightLeft.intensity = 2.2;
        rimLightRight.intensity = 2.2;
      }

      // Yakuniy rotatsiyani qo'llash
      characterWrapper.rotation.y = BASE_ROTATION_Y + currentYaw;
      characterWrapper.rotation.x = currentPitch + speechNod;
      characterWrapper.rotation.z = currentRoll;

      // Mayin nafas olish tebranishi
      characterWrapper.position.y = 1.28 + Math.sin(time * 1.8) * 0.015;

      // Model og'iz/bosh masshtabi (jag' qimirlashi)
      if (loadedHeadModel) {
        loadedHeadModel.scale.y = loadedHeadModel.scale.x * speechJawScale;
      }

      // Kamera mayin harakati
      camera.position.x = Math.sin(time * 0.6) * 0.02;
      camera.position.y = 1.42 + Math.cos(time * 0.8) * 0.012;

      renderer.render(scene, camera);
    };

    reqId = requestAnimationFrame(animate);

    let resizeTimeout: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (!container) return;
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }, 100);
    };

    window.addEventListener('resize', handleResize, { passive: true });

    return () => {
      cancelAnimationFrame(reqId);
      window.removeEventListener('resize', handleResize);
      clearTimeout(resizeTimeout);
      if (container && renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return (
    <div
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className="relative w-full h-full bg-[#d7f5dc] overflow-hidden select-none cursor-pointer"
    >
      {/* 3D WebGL Canvas */}
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Yashirin Selfie Kamera (Yuzni kuzatish uchun) */}
      <video ref={videoRef} className="hidden" playsInline muted />

      {/* Loading Indicator */}
      {!modelLoaded && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#d7f5dc]">
          <div className="w-12 h-12 rounded-full border-3 border-emerald-600 border-t-transparent animate-spin mb-3" />
          <div className="font-mono text-xs font-bold text-emerald-800 tracking-wider">
            YUKLANMOQDA ({loadingProgress}%)
          </div>
        </div>
      )}

      {/* Yuqori chap HUD: Kamera va Nigoh holati indikatori */}
      <div className="absolute top-4 left-4 z-30 flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-950/20 backdrop-blur-md border border-emerald-900/30 text-emerald-900 text-xs font-semibold">
          <Camera className={`w-3.5 h-3.5 ${personTracked ? 'text-emerald-500 animate-pulse' : 'text-emerald-700'}`} />
          <span>{personTracked ? '👁️ Sizga qaramoqda' : cameraActive ? '📷 Kamera faol' : '👆 Sensorli nigoh'}</span>
        </div>

        {isSpeaking && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cyan-950/20 backdrop-blur-md border border-cyan-800/30 text-cyan-900 text-xs font-semibold animate-pulse">
            <Sparkles className="w-3.5 h-3.5 text-cyan-500" />
            <span>AI Nutq faol</span>
          </div>
        )}
      </div>

      {/* Pastki markaz: AI Ovozli Muloqotni Sinash Tugmasi */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30">
        <button
          onClick={(e) => {
            e.stopPropagation();
            triggerAiSpeechDemo();
          }}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-full font-bold text-xs tracking-wider uppercase transition-all shadow-lg active:scale-95 ${
            isSpeaking
              ? 'bg-emerald-600 text-white shadow-emerald-500/30 animate-pulse'
              : 'bg-emerald-900/80 hover:bg-emerald-900 text-white shadow-emerald-950/30 hover:scale-105'
          }`}
        >
          <Volume2 className="w-4 h-4" />
          <span>{isSpeaking ? 'AI Gapirmoqda...' : '🎙️ AI Ovozini Eshitish'}</span>
        </button>
      </div>

      {/* Minimalist Ekran chetidagi Operator Kirish Tugmasi */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          tacticalAudio.playClick();
          onUnlockRequest();
        }}
        title="Operator Paneli"
        aria-label="Operator Paneli"
        className="absolute top-4 right-4 z-30 p-2.5 rounded-full bg-emerald-900/15 hover:bg-emerald-900/30 text-emerald-900/70 hover:text-emerald-900 border border-emerald-900/20 backdrop-blur-sm transition-all active:scale-90"
      >
        <Lock className="w-4 h-4" />
      </button>
    </div>
  );
};
