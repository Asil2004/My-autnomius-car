import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Lock } from 'lucide-react';
import { tacticalAudio } from '../services/audioService';

interface RobotFaceViewProps {
  onUnlockRequest: () => void;
}

export const RobotFaceView: React.FC<RobotFaceViewProps> = ({ onUnlockRequest }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [modelLoaded, setModelLoaded] = useState<boolean>(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Mobile / Low-power device detection for adaptive high-performance rendering
    const isMobile =
      /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      window.innerWidth < 768;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    // Och yashil fon (Soft pastel light green)
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

    // Optimized Lighting: High performance Directional Lights instead of heavy point lights
    const ambientLight = new THREE.AmbientLight(0xd7f5dc, isMobile ? 2.4 : 2.0);
    scene.add(ambientLight);

    // Asosiy old-yuqori yorug'lik (Key Light)
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(1.5, 3.5, 3.0);
    scene.add(keyLight);

    // Chap tomondan zumrad jilo (Emerald Rim Light — Directional for zero mobile fragment shader cost)
    const rimLightLeft = new THREE.DirectionalLight(0x00ff88, 2.2);
    rimLightLeft.position.set(-2.5, 2.0, 1.0);
    scene.add(rimLightLeft);

    // O'ng tomondan sian jilo (Cyan Specular Rim Light)
    const rimLightRight = new THREE.DirectionalLight(0x66ffff, 2.2);
    rimLightRight.position.set(2.5, 1.8, 1.0);
    scene.add(rimLightRight);

    // Pivot Wrapper Group (model o'z markazi atrofida siljimasdan aylanishi uchun)
    const characterWrapper = new THREE.Group();
    characterWrapper.position.set(0, 1.28, 0);
    scene.add(characterWrapper);

    // Modelning boshlang'ich burilishi (ekranga qaratish)
    const BASE_ROTATION_Y = -Math.PI / 2;
    characterWrapper.rotation.y = BASE_ROTATION_Y;

    // Materialni yaltiroq va engil qilish funksiyasi
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

        // Modelni markazlashtirish va mos o'lchamga keltirish
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 1.95 / (maxDim || 1);
        model.scale.set(scale, scale, scale);

        // Modelni wrapper ichida markaziga joylashtiramiz
        model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

        // Mobile optimization: disable auto matrix update on submeshes, enable frustum culling
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

    // Animatsiya sikli: 60 FPS da chegaralash (120Hz ekranlarda batareya va GPU ni qizitmaslik uchun)
    let reqId: number;
    const clock = new THREE.Clock();
    let currentLookAngle = 0;
    let targetLookAngle = 0;
    let nextLookChange = 0;

    let lastFrameTime = performance.now();
    const targetFps = isMobile ? 55 : 60;
    const frameInterval = 1000 / targetFps;

    const animate = (currentTime: number) => {
      reqId = requestAnimationFrame(animate);

      // Tab ko'rinmayotgan bo'lsa render qilmaslik
      if (document.hidden) return;

      const elapsed = currentTime - lastFrameTime;
      if (elapsed < frameInterval - 1) return;
      lastFrameTime = currentTime - (elapsed % frameInterval);

      const delta = clock.getDelta();
      const time = clock.getElapsedTime();

      // To'g'ri ekranga qarab turgan holatdan mayin chapga (-0.28 rad) va o'ngga (+0.28 rad) qarash
      if (time > nextLookChange) {
        const angles = [-0.28, 0.28, 0.0, -0.20, 0.20, 0.0];
        targetLookAngle = angles[Math.floor(Math.random() * angles.length)];
        nextLookChange = time + 2.5 + Math.random() * 2.0;
      }

      currentLookAngle += (targetLookAngle - currentLookAngle) * Math.min(1.0, delta * 2.5);

      // Model to'ppa-to'g'ri ekranga qaraydi (BASE_ROTATION_Y) va mayin atrofni kuzatadi
      characterWrapper.rotation.y = BASE_ROTATION_Y + currentLookAngle;
      characterWrapper.position.y = 1.28 + Math.sin(time * 1.8) * 0.012; // mayin nafas olish tebranishi

      // Kamera mayin nafas tebranishi
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
    <div className="relative w-full h-full bg-[#d7f5dc] overflow-hidden select-none">
      {/* 3D WebGL Canvas */}
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Loading Indicator */}
      {!modelLoaded && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#d7f5dc]">
          <div className="w-12 h-12 rounded-full border-3 border-emerald-600 border-t-transparent animate-spin mb-3" />
          <div className="font-mono text-xs font-bold text-emerald-800 tracking-wider">
            YUKLANMOQDA ({loadingProgress}%)
          </div>
        </div>
      )}

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
