import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Lock, Volume2, Sparkles, Eye } from 'lucide-react';
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

  // Nigoh koordinatalari (X: [-1, 1], Y: [-1, 1]) va ovoz energiyasi
  const lookTargetRef = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });
  const speechEnergyRef = useRef<number>(0);

  // 1. KAMERA ORQALI INSON YUZINI KUZATISH (Face-Tracking)
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

        scanInterval = window.setInterval(() => {
          if (!videoRef.current || !ctx || videoRef.current.readyState < 2) return;
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = frame.data;

          let sumX = 0;
          let sumY = 0;
          let count = 0;

          // Inson terisi va yorug'lik ranglarini aniqlash
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              const idx = (y * canvas.width + x) * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];

              if (r > 60 && g > 40 && b > 20 && r > g && r > b && (r - g) > 10) {
                sumX += x;
                sumY += y;
                count++;
              }
            }
          }

          if (count > 25) {
            const rawX = 1.0 - (sumX / count) / canvas.width;
            const normX = (rawX - 0.5) * 2.0;
            const normY = ((sumY / count) / canvas.height - 0.5) * 2.0;

            lookTargetRef.current = { x: normX, y: normY, active: true };
            setPersonTracked(true);
          } else {
            lookTargetRef.current.active = false;
            setPersonTracked(false);
          }
        }, 66); // ~15 Hz
      } catch (err) {
        console.warn('Kameraga ruxsat berilmadi yoki mavjud emas (Sensorli nigoh ishlaydi):', err);
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

  // Sichqoncha yoki barmoq bilan ko'zlarni boshqarish (Fallback Look-At)
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

  // 2. AI OVOZI VA NUTQQA MOS LAB MIMIKASI
  const triggerAiSpeechDemo = () => {
    if (isSpeaking) return;
    setIsSpeaking(true);
    tacticalAudio.playCommandBeep();

    const phrases = [
      "Assalomu alaykum! Men QALQON avtonom patrul robotiman. Xavfsizligingiz nazorat ostida.",
      "Navoiy ko'chasi va xiyobonlarida tinchlik va jamoat tartibi to'liq ta'minlanmoqda.",
      "Kamerangiz orqali sizni ko'rib turibman. Sizga qanday yordam bera olaman?",
      "360 gradusli LiDAR va AI datchiklarim to'liq ishchi holatda."
    ];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(phrase);
      utter.lang = 'uz-UZ';
      utter.rate = 1.0;
      utter.pitch = 1.05;

      utter.onstart = () => {
        speechEnergyRef.current = 1.0;
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
      speechEnergyRef.current = 1.0;
      setTimeout(() => {
        setIsSpeaking(false);
        speechEnergyRef.current = 0;
      }, 3500);
    }
  };

  // 3. THREE.JS 3D RENDER VA MUSTAQIL A'ZOLAR KINEMATIKASI
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isMobile =
      /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      window.innerWidth < 768;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xd7f5dc);

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 50);
    camera.position.set(0, 1.42, 2.7);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isMobile,
      alpha: false,
      powerPreference: isMobile ? 'default' : 'high-performance',
      precision: isMobile ? 'mediump' : 'highp',
      stencil: false,
      depth: true
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.2 : 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.38;
    container.appendChild(renderer.domElement);

    // Yorug'liklar
    const ambientLight = new THREE.AmbientLight(0xd7f5dc, isMobile ? 2.4 : 2.0);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(1.5, 3.5, 3.0);
    scene.add(keyLight);

    const rimLightLeft = new THREE.DirectionalLight(0x00ff88, 2.0);
    rimLightLeft.position.set(-2.5, 2.0, 1.0);
    scene.add(rimLightLeft);

    const rimLightRight = new THREE.DirectionalLight(0x66ffff, 2.0);
    rimLightRight.position.set(2.5, 1.8, 1.0);
    scene.add(rimLightRight);

    // TANA VA BOSH ASOSI (Barqaror qotib turuvchi guruh)
    const characterWrapper = new THREE.Group();
    characterWrapper.position.set(0, 1.28, 0);
    scene.add(characterWrapper);

    const BASE_ROTATION_Y = -Math.PI / 2;
    characterWrapper.rotation.y = BASE_ROTATION_Y;

    // A'ZOLAR: KO'ZLAR MODULI
    // Yuz koordinatalari: Left (x: 0.285, y: 0.145, z: 0.116), Right (x: 0.285, y: 0.143, z: -0.106)
    // Model yuzining old tomoni +X bo'lgani sababli, ko'zlar rotation.y = Math.PI / 2 bilan qaratiladi
    interface CyberEyeModule {
      group: THREE.Group;
      pupilGroup: THREE.Group;
      upperLid: THREE.Mesh;
      lowerLid: THREE.Mesh;
    }

    function createCyberEye(posX: number, posY: number, posZ: number): CyberEyeModule {
      const group = new THREE.Group();
      group.position.set(posX, posY, posZ);
      group.rotation.y = Math.PI / 2; // Old tomonga qaratish (+X yo'nalishiga)

      // 1. Oq sklera / ko'z asosi
      const scleraGeo = new THREE.CircleGeometry(0.046, 32);
      const scleraMat = new THREE.MeshBasicMaterial({
        color: 0xf0f7fa,
        side: THREE.DoubleSide
      });
      const sclera = new THREE.Mesh(scleraGeo, scleraMat);
      sclera.position.z = 0.001;
      group.add(sclera);

      // 2. Qorachiq va kamalak parda guruhi (Look-At da erkin harakatlanadi)
      const pupilGroup = new THREE.Group();
      pupilGroup.position.z = 0.002;

      // Kamalak parda (Iris - Neon Cyan halqa)
      const irisGeo = new THREE.RingGeometry(0.014, 0.033, 32);
      const irisMat = new THREE.MeshBasicMaterial({
        color: 0x00d8ff,
        side: THREE.DoubleSide
      });
      const iris = new THREE.Mesh(irisGeo, irisMat);
      pupilGroup.add(iris);

      // Qorachiq markazi (Pupil - qora)
      const pupilGeo = new THREE.CircleGeometry(0.016, 32);
      const pupilMat = new THREE.MeshBasicMaterial({
        color: 0x081018,
        side: THREE.DoubleSide
      });
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.z = 0.001;
      pupilGroup.add(pupil);

      // Yorug'lik jilosi (Ko'z jonliligi uchun oq aks)
      const shineGeo = new THREE.CircleGeometry(0.006, 16);
      const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const shine = new THREE.Mesh(shineGeo, shineMat);
      shine.position.set(0.009, 0.009, 0.002);
      pupilGroup.add(shine);

      group.add(pupilGroup);

      // 3. Qovoqlar (Pirpirash / Blinking)
      const lidGeo = new THREE.PlaneGeometry(0.098, 0.052);
      const lidMat = new THREE.MeshStandardMaterial({
        color: 0x1f382b,
        roughness: 0.35,
        metalness: 0.45
      });

      const upperLid = new THREE.Mesh(lidGeo, lidMat);
      upperLid.position.set(0, 0.052, 0.004);
      group.add(upperLid);

      const lowerLid = new THREE.Mesh(lidGeo, lidMat);
      lowerLid.position.set(0, -0.052, 0.004);
      group.add(lowerLid);

      return { group, pupilGroup, upperLid, lowerLid };
    }

    let leftEye: CyberEyeModule | null = null;
    let rightEye: CyberEyeModule | null = null;

    // LAB VA OG'IZ UCHUN 3D BO'SHLIQ
    // Model og'zi: x: 0.285, y: -0.210, z: 0.000
    const mouthApertureGroup = new THREE.Group();
    mouthApertureGroup.position.set(0.285, -0.210, 0.0);
    mouthApertureGroup.rotation.y = Math.PI / 2;

    const oralInnerGeo = new THREE.PlaneGeometry(0.075, 0.012);
    const oralInnerMat = new THREE.MeshBasicMaterial({
      color: 0x061109,
      side: THREE.DoubleSide
    });
    const oralInnerMesh = new THREE.Mesh(oralInnerGeo, oralInnerMat);
    oralInnerMesh.position.z = 0.001;
    mouthApertureGroup.add(oralInnerMesh);

    // GLTF 3D MESH YUKLASH VA LAB VERTEKSLARINI AJRATIB OLISH
    interface MouthVertInfo {
      index: number;
      origY: number;
      origX: number;
      weight: number;
      isLower: boolean;
    }

    let headMesh: THREE.Mesh | null = null;
    let originalPositions: Float32Array | null = null;
    let mouthVerts: MouthVertInfo[] = [];

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

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 1.95 / (maxDim || 1);
        model.scale.set(scale, scale, scale);
        model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

        // Ko'z modullari va og'iz bo'shlig'ini to'g'ridan-to'g'ri modelga joylashtiramiz
        leftEye = createCyberEye(0.282, 0.145, 0.116);
        rightEye = createCyberEye(0.282, 0.143, -0.106);
        model.add(leftEye.group);
        model.add(rightEye.group);
        model.add(mouthApertureGroup);

        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            headMesh = mesh;
            mesh.frustumCulled = true;

            const posAttr = mesh.geometry.attributes.position;
            if (posAttr) {
              originalPositions = new Float32Array(posAttr.array);
              mouthVerts = [];

              // Haqiqiy lablar sohasi (Burun tegilmaydi! Faqat y: [-0.27, -0.15])
              for (let i = 0; i < posAttr.count; i++) {
                const x = originalPositions[i * 3];
                const y = originalPositions[i * 3 + 1];
                const z = originalPositions[i * 3 + 2];

                // Burun y > -0.12 da joylashgan. Lablar esa y: [-0.27, -0.15] oralig'ida
                if (y >= -0.27 && y <= -0.15 && x > 0.15 && Math.abs(z) < 0.14) {
                  const dist = Math.sqrt(Math.pow(z / 0.12, 2) + Math.pow((y - (-0.210)) / 0.055, 2));
                  if (dist < 1.0) {
                    const weight = Math.cos(dist * Math.PI * 0.5);
                    mouthVerts.push({
                      index: i,
                      origY: y,
                      origX: x,
                      weight,
                      isLower: y < -0.205
                    });
                  }
                }
              }
            }

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
        console.warn('result.glb yuklanmadi:', err);
        setModelLoaded(true);
      }
    );

    // KINEMATIKA VA PIRPIRASH (Blinking) TIZIMI
    let reqId: number;
    const clock = new THREE.Clock();

    let currentGazeX = 0;
    let currentGazeY = 0;

    let nextBlinkTime = 2.0;
    let isBlinking = false;
    let blinkStartTime = 0;

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

      // -------------------------------------------------------------
      // 1. TANA VA BOSH: BUTUNLAY BARQAROR (Qimirlamaydi)
      // -------------------------------------------------------------
      characterWrapper.rotation.y = BASE_ROTATION_Y;
      characterWrapper.rotation.x = 0;
      characterWrapper.rotation.z = 0;
      characterWrapper.position.set(0, 1.28, 0);

      // -------------------------------------------------------------
      // 2. KO'ZLAR: FAQAT QORACHIQ VA NIGOH BURILADI (Look-At Gaze)
      // Inson qayerdan qarasa, faqat qorachiqlar o'sha tomonga qaraydi!
      // -------------------------------------------------------------
      let desiredGazeX = 0;
      let desiredGazeY = 0;

      if (target.active) {
        // Inson yuzining ekrandagi koordinatalari bo'yicha qorachiq siljishi
        desiredGazeX = -target.x * 0.016; // Gorizontal (chap-o'ng)
        desiredGazeY = -target.y * 0.012; // Vertikal (tepa-past)
      } else {
        // Tabiiy insoniy mikro-sakkadlar (jonli nigoh o'ynashi)
        desiredGazeX = Math.sin(time * 0.9) * 0.007;
        desiredGazeY = Math.cos(time * 1.3) * 0.005;
      }

      currentGazeX += (desiredGazeX - currentGazeX) * (delta * 8.0);
      currentGazeY += (desiredGazeY - currentGazeY) * (delta * 8.0);

      if (leftEye && rightEye) {
        leftEye.pupilGroup.position.set(currentGazeX, currentGazeY, 0.002);
        rightEye.pupilGroup.position.set(currentGazeX, currentGazeY, 0.002);

        // KO'Z QOVOQLARINING PIRPIRASHI (Blinking)
        if (!isBlinking && time > nextBlinkTime) {
          isBlinking = true;
          blinkStartTime = time;
          nextBlinkTime = time + 3.0 + Math.random() * 2.5; // Har 3-5 soniyada pirpirash
        }

        let blinkLidOffset = 0.052;
        if (isBlinking) {
          const blinkElapsed = time - blinkStartTime;
          const blinkDuration = 0.16; // 160 ms lik silliq pirpirash
          if (blinkElapsed < blinkDuration) {
            const blinkProgress = Math.sin((blinkElapsed / blinkDuration) * Math.PI);
            blinkLidOffset = 0.052 - blinkProgress * 0.046; // Qovoqlar yopilib ochiladi
          } else {
            isBlinking = false;
          }
        }

        leftEye.upperLid.position.y = blinkLidOffset;
        leftEye.lowerLid.position.y = -blinkLidOffset;
        rightEye.upperLid.position.y = blinkLidOffset;
        rightEye.lowerLid.position.y = -blinkLidOffset;
      }

      // -------------------------------------------------------------
      // 3. OG'IZ VA LABLAR: BURUN EMAS, AYNAN LABLAR OCHILIB-YOPILADI!
      // Faqat y: [-0.27, -0.15] oralig'idagi lab vertekslari deformatsiyalanadi
      // -------------------------------------------------------------
      let mouthAperture = 0;

      if (speechEnergy > 0.02) {
        // So'z urg'usi va bo'g'inlarga mos dinamika
        const speechPhoneme = Math.abs(Math.sin(time * 16.0)) * 0.022 + Math.abs(Math.cos(time * 9.0)) * 0.010;
        mouthAperture = speechEnergy * speechPhoneme;

        // Nutq energiyasini so'ndirish
        speechEnergyRef.current = Math.max(0, speechEnergyRef.current - delta * 0.45);

        // Ovoz paytida og'iz ichi nuri
        oralInnerMat.color.setHex(0x00ff88);
      } else {
        mouthAperture = 0;
        oralInnerMat.color.setHex(0x061109);
      }

      // Og'iz bo'shlig'i ko'rinishi
      oralInnerMesh.scale.set(1.0 + mouthAperture * 6.0, 1.0 + mouthAperture * 25.0, 1.0);

      // 3D Modelning o'zidagi LAB vertekslarini deformatsiyalash (Geometric Lip-Sync)
      if (headMesh && originalPositions && mouthVerts.length > 0) {
        const posArray = headMesh.geometry.attributes.position.array as Float32Array;

        for (let j = 0; j < mouthVerts.length; j++) {
          const v = mouthVerts[j];
          const idxY = v.index * 3 + 1;
          const idxX = v.index * 3;

          if (v.isLower) {
            // Pastki lab pastga ochiladi va jag' biroz oldinga ochiladi
            posArray[idxY] = v.origY - mouthAperture * v.weight * 1.8;
            posArray[idxX] = v.origX + mouthAperture * v.weight * 0.3;
          } else {
            // Yuqori lab biroz yuqoriga ko'tariladi (burun tegilmaydi)
            posArray[idxY] = v.origY + mouthAperture * v.weight * 0.4;
          }
        }
        headMesh.geometry.attributes.position.needsUpdate = true;
      }

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

      {/* Yuqori chap HUD: Ko'zlar va Nigoh holati */}
      <div className="absolute top-4 left-4 z-30 flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-950/20 backdrop-blur-md border border-emerald-900/30 text-emerald-900 text-xs font-semibold">
          <Eye className={`w-3.5 h-3.5 ${personTracked ? 'text-emerald-500 animate-pulse' : 'text-emerald-700'}`} />
          <span>{personTracked ? '👁️ Ko\'zlar sizga qaramoqda' : cameraActive ? '📷 Kamera faol' : '👆 Sensorli ko\'z nigohi'}</span>
        </div>

        {isSpeaking && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cyan-950/20 backdrop-blur-md border border-cyan-800/30 text-cyan-900 text-xs font-semibold animate-pulse">
            <Sparkles className="w-3.5 h-3.5 text-cyan-500" />
            <span>Lablar gapirmoqda</span>
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
          <span>{isSpeaking ? 'AI Gapirmoqda (Lab mimikasi)...' : '🎙️ AI Ovozini Eshitish (Lab mimikasi)'}</span>
        </button>
      </div>

      {/* Operator Kirish Tugmasi */}
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
