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

  // 2. AI OVOZI VA NUTQQA MOS LAB/OG'IZ MIMIKASI
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
        // Har bir bo'g'inda og'iz ochilishi va lab harakati
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

    // A'ZOLAR: KO'ZLAR VA QORACHIQLAR UCHUN GURUHLAR
    // Yuzdagi ko'zlar koordinatalari: Left (-0.165, 0.200, 0.575), Right (0.155, 0.200, 0.575)
    function createCyberEye(xOffset: number) {
      const eyeGroup = new THREE.Group();
      eyeGroup.position.set(xOffset, 0.200, 0.575);

      // Ko'z qorachiq va kamalak parda guruhi (Look-At da harakatlanuvchi qism)
      const pupilGroup = new THREE.Group();

      // Kamalak parda (Iris — Neon Cyan ring)
      const irisGeo = new THREE.RingGeometry(0.007, 0.024, 24);
      const irisMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        side: THREE.DoubleSide
      });
      const iris = new THREE.Mesh(irisGeo, irisMat);
      pupilGroup.add(iris);

      // Qorachiq markazi (Pupil center - qora)
      const pupilGeo = new THREE.CircleGeometry(0.008, 24);
      const pupilMat = new THREE.MeshBasicMaterial({
        color: 0x050d12,
        side: THREE.DoubleSide
      });
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.z = 0.001;
      pupilGroup.add(pupil);

      // Yorug'lik nuri (Specular reflection nuqtasi)
      const shineGeo = new THREE.CircleGeometry(0.003, 12);
      const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const shine = new THREE.Mesh(shineGeo, shineMat);
      shine.position.set(0.006, 0.006, 0.002);
      pupilGroup.add(shine);

      eyeGroup.add(pupilGroup);

      // Yuqori qovoq (Pirpirash / Blinking qopqog'i)
      const upperLidGeo = new THREE.PlaneGeometry(0.065, 0.045);
      const lidMat = new THREE.MeshStandardMaterial({
        color: 0x223528,
        roughness: 0.35,
        metalness: 0.5
      });
      const upperLid = new THREE.Mesh(upperLidGeo, lidMat);
      upperLid.position.set(0, 0.038, 0.004);
      eyeGroup.add(upperLid);

      // Pastki qovoq
      const lowerLid = new THREE.Mesh(upperLidGeo, lidMat);
      lowerLid.position.set(0, -0.038, 0.004);
      eyeGroup.add(lowerLid);

      return { eyeGroup, pupilGroup, upperLid, lowerLid };
    }

    const leftEye = createCyberEye(-0.165);
    const rightEye = createCyberEye(0.155);

    characterWrapper.add(leftEye.eyeGroup);
    characterWrapper.add(rightEye.eyeGroup);

    // LABLAR VA OG'IZ UCHUN MAXSUS DINAMIK ORAQ (Acoustic Oral Aperture)
    // Og'iz markazi: (0, -0.160, 0.635)
    const mouthGroup = new THREE.Group();
    mouthGroup.position.set(0, -0.160, 0.635);

    // Ichki og'iz bo'shlig'i (qorong'u va ovoz paytida neon pulsatsiyalanuvchi)
    const oralCavityGeo = new THREE.PlaneGeometry(0.08, 0.03);
    const oralCavityMat = new THREE.MeshBasicMaterial({
      color: 0x07150c,
      side: THREE.DoubleSide
    });
    const oralCavity = new THREE.Mesh(oralCavityGeo, oralCavityMat);
    mouthGroup.add(oralCavity);

    // Yuqori lab (Upper Lip)
    const upperLipGeo = new THREE.BoxGeometry(0.09, 0.012, 0.01);
    const lipMat = new THREE.MeshStandardMaterial({
      color: 0x1a452a,
      roughness: 0.25,
      metalness: 0.6,
      emissive: new THREE.Color(0x0a2012),
      emissiveIntensity: 0.3
    });
    const upperLip = new THREE.Mesh(upperLipGeo, lipMat);
    upperLip.position.set(0, 0.006, 0.003);
    mouthGroup.add(upperLip);

    // Pastki lab (Lower Lip — gapirganda pastga tushuvchi)
    const lowerLip = new THREE.Mesh(upperLipGeo, lipMat);
    lowerLip.position.set(0, -0.006, 0.003);
    mouthGroup.add(lowerLip);

    characterWrapper.add(mouthGroup);

    // GLTF 3D MESH YUKLASH VA LAB VERTEKSLARINI AJRATIB OLISH
    interface MouthVertInfo {
      index: number;
      origY: number;
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

        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            headMesh = mesh;
            mesh.frustumCulled = true;

            const posAttr = mesh.geometry.attributes.position;
            if (posAttr) {
              originalPositions = new Float32Array(posAttr.array);
              mouthVerts = [];

              // Og'iz va jag' vertekslarini topib, harakat vaznlarini (weights) hisoblash
              for (let i = 0; i < posAttr.count; i++) {
                const x = originalPositions[i * 3];
                const y = originalPositions[i * 3 + 1];
                const z = originalPositions[i * 3 + 2];

                // world koordinatalariga o'tkazish
                const wx = -(z - center.z) * scale;
                const wy = (y - center.y) * scale;
                const wz = (x - center.x) * scale;

                // Og'iz va lablar sohasi: wy [-0.30, -0.06], wz > 0.45, |wx| < 0.22
                if (wy >= -0.30 && wy <= -0.06 && wz > 0.45 && Math.abs(wx) < 0.20) {
                  const dist = Math.sqrt(Math.pow(wx / 0.18, 2) + Math.pow((wy - (-0.16)) / 0.13, 2));
                  if (dist < 1.0) {
                    const weight = Math.cos(dist * Math.PI * 0.5);
                    mouthVerts.push({
                      index: i,
                      origY: y,
                      weight,
                      isLower: wy < -0.155
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
      // 1. TANA VA BOSH: BUTUNLAY BARQAROR (Qimirlamaydi!)
      // Faqatgina inson yo'nalishiga minimal mikro-diqqat (~1.5 daraja)
      // -------------------------------------------------------------
      const subtleHeadYaw = target.active ? target.x * 0.03 : 0;
      const subtleHeadPitch = target.active ? -target.y * 0.02 : 0;
      characterWrapper.rotation.y = BASE_ROTATION_Y + subtleHeadYaw;
      characterWrapper.rotation.x = subtleHeadPitch;
      characterWrapper.rotation.z = 0;
      characterWrapper.position.set(0, 1.28, 0); // Butun bosh/tana sakramaydi

      // -------------------------------------------------------------
      // 2. KO'ZLAR: FAQAT QORACHIQ VA NIGOH BURILADI (Look-At Gaze)
      // Inson qayerdan qarasa, faqat qorachiqlar o'sha tomonga qaraydi!
      // -------------------------------------------------------------
      let desiredGazeX = 0;
      let desiredGazeY = 0;

      if (target.active) {
        desiredGazeX = target.x * 0.015;  // Qorachiq gorizontal siljishi
        desiredGazeY = -target.y * 0.012; // Qorachiq vertikal siljishi
      } else {
        // Tabiiy mikro-sakkadlar (insoniy tirik ko'z nigohi)
        desiredGazeX = Math.sin(time * 0.8) * 0.006;
        desiredGazeY = Math.cos(time * 1.2) * 0.004;
      }

      currentGazeX += (desiredGazeX - currentGazeX) * (delta * 7.0);
      currentGazeY += (desiredGazeY - currentGazeY) * (delta * 7.0);

      leftEye.pupilGroup.position.set(currentGazeX, currentGazeY, 0.001);
      rightEye.pupilGroup.position.set(currentGazeX, currentGazeY, 0.001);

      // KO'Z QOVOQLARINING PIRPIRASHI (Blinking)
      if (!isBlinking && time > nextBlinkTime) {
        isBlinking = true;
        blinkStartTime = time;
        nextBlinkTime = time + 3.0 + Math.random() * 2.5; // Har 3-5 soniyada pirpirash
      }

      let blinkLidOffset = 0.038;
      if (isBlinking) {
        const blinkElapsed = time - blinkStartTime;
        const blinkDuration = 0.16; // 160 ms lik silliq pirpirash
        if (blinkElapsed < blinkDuration) {
          const blinkProgress = Math.sin((blinkElapsed / blinkDuration) * Math.PI);
          blinkLidOffset = 0.038 - blinkProgress * 0.028; // Qovoqlar yopilib ochiladi
        } else {
          isBlinking = false;
        }
      }

      leftEye.upperLid.position.y = blinkLidOffset;
      leftEye.lowerLid.position.y = -blinkLidOffset;
      rightEye.upperLid.position.y = blinkLidOffset;
      rightEye.lowerLid.position.y = -blinkLidOffset;

      // -------------------------------------------------------------
      // 3. OG'IZ VA LABLAR: FAQAT LABLAR OCHILADI VA GAPIRADI!
      // Butun bosh cho'zilmaydi, faqat og'iz/lab qismlari o'z vazifasini bajaradi
      // -------------------------------------------------------------
      let mouthAperture = 0;

      if (speechEnergy > 0.02) {
        // Gapirayotganda fonemalarga mos ochilib-yopilish
        const speechPhoneme = Math.abs(Math.sin(time * 16.0)) * 0.016 + Math.abs(Math.cos(time * 9.0)) * 0.008;
        mouthAperture = speechEnergy * speechPhoneme;

        // Nutq energiyasini so'ndirish
        speechEnergyRef.current = Math.max(0, speechEnergyRef.current - delta * 0.45);

        // Ovoz chiqayotganda akustik bo'shliqning nurlanishi
        oralCavityMat.color.setHex(0x00ff88);
      } else {
        mouthAperture = 0;
        oralCavityMat.color.setHex(0x07150c);
      }

      // 3D Lab modullari ochilishi
      upperLip.position.y = 0.006 + mouthAperture * 0.3;
      lowerLip.position.y = -0.006 - mouthAperture * 1.2; // Pastki lab ko'proq ochiladi
      oralCavity.scale.set(1.0 + mouthAperture * 8.0, 1.0 + mouthAperture * 25.0, 1.0);

      // 3D Modelning o'zidagi lab vertekslarini deformatsiyalash (Geometric Lip-Sync)
      if (headMesh && originalPositions && mouthVerts.length > 0) {
        const posArray = headMesh.geometry.attributes.position.array as Float32Array;
        const deformFactor = mouthAperture * 2.5;

        for (let j = 0; j < mouthVerts.length; j++) {
          const v = mouthVerts[j];
          const idxY = v.index * 3 + 1;

          if (v.isLower) {
            // Pastki lab va jag' pastga tushadi
            posArray[idxY] = v.origY - deformFactor * v.weight;
          } else {
            // Yuqori lab sal ko'tariladi
            posArray[idxY] = v.origY + deformFactor * v.weight * 0.25;
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
