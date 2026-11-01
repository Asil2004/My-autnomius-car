import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Lock, Camera, CameraOff, Volume2 } from 'lucide-react';
import { tacticalAudio } from '../services/audioService';

interface RobotFaceViewProps {
  onUnlockRequest: () => void;
}

export const RobotFaceView: React.FC<RobotFaceViewProps> = ({ onUnlockRequest }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [modelLoaded, setModelLoaded] = useState<boolean>(false);
  const [cameraActive, setCameraActive] = useState<boolean>(true);
  const [isFaceDetected, setIsFaceDetected] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [speechSubtitle, setSpeechSubtitle] = useState<string>('');

  // Dinamik nigoh va nutq holatlari (Ref orqali 60 FPS siklga uzatish)
  const gazeRef = useRef<{
    targetYaw: number;
    targetPitch: number;
    targetRoll: number;
    currentYaw: number;
    currentPitch: number;
    currentRoll: number;
    speechVolume: number;
    hasFace: boolean;
  }>({
    targetYaw: 0,
    targetPitch: 0,
    targetRoll: 0,
    currentYaw: 0,
    currentPitch: 0,
    currentRoll: 0,
    speechVolume: 0,
    hasFace: false
  });

  // ==========================================================================
  // 1. OLD KAMERA ORQALI INSON YUZINI KUZATISH (FACE TRACKING)
  // ==========================================================================
  useEffect(() => {
    if (!cameraActive) {
      gazeRef.current.hasFace = false;
      setIsFaceDetected(false);
      return;
    }

    let stream: MediaStream | null = null;
    let trackInterval: number | null = null;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 320 },
            height: { ideal: 240 }
          },
          audio: false
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Yuzni aniqlash sikli (20 FPS - planshet batareyasini tejash uchun yengil)
        const sampleCanvas = canvasRef.current || document.createElement('canvas');
        sampleCanvas.width = 80;
        sampleCanvas.height = 60;
        const sCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

        // Native Shape Detection API (Agar Chrome/WebView qo'llab-quvvatlasa)
        const hasNativeFaceDetector = 'FaceDetector' in window;
        // @ts-expect-error FaceDetector is experimental in standard lib
        const faceDetector = hasNativeFaceDetector ? new window.FaceDetector({ fastMode: true }) : null;

        trackInterval = window.setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;

          // 1-usul: Native FaceDetector
          if (faceDetector) {
            try {
              const faces = await faceDetector.detect(videoRef.current);
              if (faces && faces.length > 0) {
                const box = faces[0].boundingBox;
                const vW = videoRef.current.videoWidth || 320;
                const vH = videoRef.current.videoHeight || 240;
                
                // Normalizatsiyalangan markaz (0.0 dan 1.0 gacha)
                const normX = (box.x + box.width / 2) / vW;
                const normY = (box.y + box.height / 2) / vH;

                // Oyna effekti (Mirror): foydalanuvchi chapga yursa, kamera tasvirida o'ngda bo'ladi
                const faceX = 1.0 - normX;
                const faceY = normY;

                gazeRef.current.targetYaw = (faceX - 0.5) * 0.95; // o'ng-chap burilish
                gazeRef.current.targetPitch = (faceY - 0.5) * 0.55; // yuqori-pastga qiyalik
                gazeRef.current.targetRoll = (faceX - 0.5) * 0.15; // mayin quloqqa yonboshlash
                gazeRef.current.hasFace = true;
                setIsFaceDetected(true);
                return;
              }
            } catch {
              // Fallbackga o'tish
            }
          }

          // 2-usul (Zaxira): Teri rangi / Bosh silueti markazi (Centroid) tahlili
          if (sCtx && videoRef.current) {
            sCtx.drawImage(videoRef.current, 0, 0, 80, 60);
            const imgData = sCtx.getImageData(0, 0, 80, 60);
            const data = imgData.data;

            let sumX = 0;
            let sumY = 0;
            let count = 0;

            for (let y = 5; y < 55; y += 2) {
              for (let x = 5; x < 75; x += 2) {
                const idx = (y * 80 + x) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];

                // Inson yuzi rang diapazoni (YUV/RGB teri piksellari filtri)
                if (r > 65 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 12) {
                  sumX += x;
                  sumY += y;
                  count++;
                }
              }
            }

            if (count > 45) {
              const avgX = sumX / count / 80;
              const avgY = sumY / count / 60;
              const faceX = 1.0 - avgX; // oyna effekti
              const faceY = avgY;

              gazeRef.current.targetYaw = (faceX - 0.5) * 0.90;
              gazeRef.current.targetPitch = (faceY - 0.5) * 0.50;
              gazeRef.current.targetRoll = (faceX - 0.5) * 0.12;
              gazeRef.current.hasFace = true;
              setIsFaceDetected(true);
            } else {
              gazeRef.current.hasFace = false;
              setIsFaceDetected(false);
            }
          }
        }, 50);

      } catch (err) {
        console.warn("Front kamera ochilmadi (foydalanuvchi rad etgan yoki qurilmada yo'q):", err);
        setCameraActive(false);
        setIsFaceDetected(false);
      }
    };

    startCamera();

    return () => {
      if (trackInterval) clearInterval(trackInterval);
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [cameraActive]);

  // ==========================================================================
  // 2. AI OVOZIGA MOS NUTQ KINEMATIKASI (AUDIO-REACTIVE SPEAKING)
  // ==========================================================================
  const speakDemoPhrase = useCallback((phraseText: string) => {
    if (isSpeaking) return;
    setIsSpeaking(true);
    setSpeechSubtitle(phraseText);
    tacticalAudio.playCommandBeep();

    // Web Speech API orqali ovoz chiqarish
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(phraseText);
      utterance.rate = 1.0;
      utterance.pitch = 1.05;

      // Ovoz davomida boshning ritmik gapirish tebranishi (Lip & Head sync)
      let speechTimer: number | null = null;
      let speakTick = 0;

      speechTimer = window.setInterval(() => {
        speakTick++;
        // So'z bo'g'inlari amplitudasini modellashtirish
        const volume = 0.5 + Math.sin(speakTick * 0.8) * 0.4 + Math.random() * 0.2;
        gazeRef.current.speechVolume = volume;
      }, 50);

      utterance.onend = () => {
        if (speechTimer) clearInterval(speechTimer);
        gazeRef.current.speechVolume = 0;
        setIsSpeaking(false);
        setSpeechSubtitle('');
      };

      utterance.onerror = () => {
        if (speechTimer) clearInterval(speechTimer);
        gazeRef.current.speechVolume = 0;
        setIsSpeaking(false);
        setSpeechSubtitle('');
      };

      window.speechSynthesis.speak(utterance);
    } else {
      // Zaxira animatsiya agar TTS o'rnatilmagan bo'lsa
      setTimeout(() => {
        setIsSpeaking(false);
        setSpeechSubtitle('');
        gazeRef.current.speechVolume = 0;
      }, 3000);
    }
  }, [isSpeaking]);

  // ==========================================================================
  // 3. THREE.JS 3D AVATAR SAHNASI VA DINAMIK ANIMATSIYA SIKLI
  // ==========================================================================
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    const bgColor = new THREE.Color(0xd7f5dc);
    scene.background = bgColor;
    scene.fog = new THREE.FogExp2(0xd7f5dc, 0.04);

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 1.42, 2.7);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.45;
    container.appendChild(renderer.domElement);

    // Yoritish tizimi
    const ambientLight = new THREE.AmbientLight(0xffffff, 2.0);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 3.4);
    keyLight.position.set(1.5, 3.8, 3.5);
    scene.add(keyLight);

    // Nutqda pulsatsiya qiluvchi zumrad jilo chiroqlari
    const rimLightLeft = new THREE.PointLight(0x00ff88, 4.5, 10);
    rimLightLeft.position.set(-2.5, 2.5, 1.0);
    scene.add(rimLightLeft);

    const rimLightRight = new THREE.PointLight(0x66ffff, 4.5, 10);
    rimLightRight.position.set(2.5, 2.2, 0.8);
    scene.add(rimLightRight);

    const topBackLight = new THREE.DirectionalLight(0xffffff, 3.0);
    topBackLight.position.set(0, 4.5, -2.0);
    scene.add(topBackLight);

    // Pivot Wrapper Group (markaziy aylanish uchun)
    const characterWrapper = new THREE.Group();
    characterWrapper.position.set(0, 1.28, 0);
    scene.add(characterWrapper);

    const BASE_ROTATION_Y = -Math.PI / 2;
    characterWrapper.rotation.y = BASE_ROTATION_Y;

    // 3D Modelni yuklash
    const loader = new GLTFLoader();
    const modelUrl = (import.meta.env.BASE_URL || './') + 'result.glb';

    loader.load(
      modelUrl,
      (gltf) => {
        const model = gltf.scene;

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
            mesh.castShadow = true;
            mesh.receiveShadow = true;

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

    function enhanceMaterial(originalMat: THREE.Material): THREE.Material {
      const m = originalMat.clone() as THREE.MeshStandardMaterial;
      if (m.isMeshStandardMaterial) {
        m.roughness = 0.12;
        m.metalness = 0.55;
        m.emissive = new THREE.Color(0x0f3318);
        m.emissiveIntensity = 0.28;
      }
      return m;
    }

    // Kursorni kuzatish (Sichqoncha yoki barmoq tekkan tomonga qarash)
    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      // Agar kamera orqali yuz ko'rinmayotgan bo'lsa, kursor/teginish yo'nalishiga qaraydi
      if (gazeRef.current.hasFace) return;

      let clientX = 0;
      let clientY = 0;
      if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ('clientX' in e) {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      const normX = clientX / window.innerWidth;
      const normY = clientY / window.innerHeight;

      gazeRef.current.targetYaw = (normX - 0.5) * 0.85;
      gazeRef.current.targetPitch = (normY - 0.5) * 0.45;
      gazeRef.current.targetRoll = (normX - 0.5) * 0.10;
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('touchmove', handlePointerMove);

    // ========================================================================
    // 60 FPS ASOSIY ANIMATSIYA SIKLI
    // ========================================================================
    let reqId: number;
    const clock = new THREE.Clock();
    let nextLookChange = 0;
    let idleAngle = 0;

    const animate = () => {
      reqId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const time = clock.getElapsedTime();

      const g = gazeRef.current;

      // Agar kamera yuzni ko'rmasa va sichqoncha qimirlamasa: mayin atrofga qaraydi (Idle patrol)
      if (!g.hasFace) {
        if (time > nextLookChange) {
          const angles = [-0.25, 0.25, 0.0, -0.18, 0.18, 0.0];
          idleAngle = angles[Math.floor(Math.random() * angles.length)];
          nextLookChange = time + 2.5 + Math.random() * 2.0;
        }
        g.targetYaw += (idleAngle - g.targetYaw) * (delta * 0.6);
        g.targetPitch += (0 - g.targetPitch) * (delta * 0.6);
        g.targetRoll += (0 - g.targetRoll) * (delta * 0.6);
      }

      // Silliq aylanish (Smooth Damping / Slerp-like smoothing)
      g.currentYaw += (g.targetYaw - g.currentYaw) * (delta * 4.2);
      g.currentPitch += (g.targetPitch - g.currentPitch) * (delta * 4.2);
      g.currentRoll += (g.targetRoll - g.currentRoll) * (delta * 4.2);

      // AI Nutq dinamikasi (Speaking Kinetics)
      let speechNod = 0;
      let speechChinScale = 1.0;
      if (g.speechVolume > 0.05) {
        // So'z urg'usi bilan boshning ritmik egilishi (Speaking Nod)
        speechNod = Math.sin(time * 14) * (g.speechVolume * 0.08);
        // Jag' va og'izning ovozga mos elastik qimirlashi
        speechChinScale = 1.0 + Math.sin(time * 18) * (g.speechVolume * 0.035);
        // Nutq paytida chiroqlar porlashi
        rimLightLeft.intensity = 4.5 + g.speechVolume * 3.5;
        rimLightRight.intensity = 4.5 + g.speechVolume * 3.5;
      } else {
        rimLightLeft.intensity = 4.5;
        rimLightRight.intensity = 4.5;
      }

      // Boshning 3D aylanishi (Yaw, Pitch, Roll)
      characterWrapper.rotation.y = BASE_ROTATION_Y + g.currentYaw;
      characterWrapper.rotation.x = g.currentPitch + speechNod;
      characterWrapper.rotation.z = g.currentRoll;

      // Mayin nafas olish tebranishi va nutq pozitsiyasi
      const breathY = Math.sin(time * 1.8) * 0.012;
      const speechJumpY = g.speechVolume > 0.05 ? Math.abs(Math.sin(time * 16)) * 0.02 * g.speechVolume : 0;
      characterWrapper.position.y = 1.28 + breathY + speechJumpY;

      // Jag' deformatsiyasi (Og'iz so'zma-so'z ochilayotgandek vizual illyuziya)
      characterWrapper.scale.set(1.0, speechChinScale, 1.0);

      // Kamera mayin tebranishi
      camera.position.x = Math.sin(time * 0.6) * 0.02;
      camera.position.y = 1.42 + Math.cos(time * 0.8) * 0.012;

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
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('touchmove', handlePointerMove);
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return (
    <div className="relative w-full h-full bg-[#d7f5dc] overflow-hidden select-none">
      {/* 3D WebGL Canvas */}
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Orqa fondagi ko'rinmas video kamera oqimi (Yuzni aniqlash uchun) */}
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />

      {/* Loading Indicator */}
      {!modelLoaded && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#d7f5dc]">
          <div className="w-12 h-12 rounded-full border-3 border-emerald-600 border-t-transparent animate-spin mb-3" />
          <div className="font-mono text-xs font-bold text-emerald-800 tracking-wider">
            YUKLANMOQDA ({loadingProgress}%)
          </div>
        </div>
      )}

      {/* Yuqori chap burchak: Yuz kuzatuvi va AI Holat Indikatorlari */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-950/70 border border-emerald-500/30 backdrop-blur-md shadow-lg">
          <span className={`w-2 h-2 rounded-full ${isFaceDetected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
          <span className="font-mono text-[11px] font-bold text-emerald-100">
            {isFaceDetected ? '👁️ JONLI NIGOH (YUZ KUZATILMOQDA)' : cameraActive ? '🔍 ATROF KUZATILMOQDA' : '✋ KURSOR / TOUCH NIGOHI'}
          </span>
        </div>

        {isSpeaking && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-950/80 border border-cyan-400/40 backdrop-blur-md shadow-lg animate-pulse">
            <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-mono text-[11px] font-bold text-cyan-200">
              🎙️ AI OVOZI VA NUTQ KINEMATIKASI FAOL
            </span>
          </div>
        )}
      </div>

      {/* Nutq subtitri (AI gapirganda ekranda chiqadi) */}
      {speechSubtitle && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 max-w-lg px-5 py-2.5 rounded-xl bg-black/75 border border-emerald-500/40 text-center backdrop-blur-md shadow-2xl">
          <p className="font-sans text-sm font-semibold text-emerald-300 tracking-wide">
            "{speechSubtitle}"
          </p>
        </div>
      )}

      {/* Pastki boshqaruv tugmalari: Kamera va AI nutqini sinash */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3">
        <button
          onClick={() => {
            tacticalAudio.playClick();
            setCameraActive(!cameraActive);
          }}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg font-mono text-xs font-bold transition-all shadow-md active:scale-95 border ${
            cameraActive
              ? 'bg-emerald-700/80 hover:bg-emerald-600 text-white border-emerald-400/50'
              : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-600'
          }`}
        >
          {cameraActive ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
          {cameraActive ? 'Kamera Nigohi (Faol)' : 'Kamera (O\'chirilgan)'}
        </button>

        <button
          onClick={() => {
            speakDemoPhrase("Assalomu alaykum! Men QALQON avtonom patrul robotiman. Jamoat xavfsizligini ta'minlashga tayyorman!");
          }}
          disabled={isSpeaking}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg font-mono text-xs font-bold bg-blue-600/80 hover:bg-blue-500 text-white border border-blue-400/50 transition-all shadow-md active:scale-95 disabled:opacity-50"
        >
          <Volume2 className="w-4 h-4" />
          🗣️ AI Nutqini Sinash
        </button>
      </div>

      {/* Minimalist Ekran chetidagi Operator Kirish Tugmasi */}
      <button
        onClick={() => {
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
