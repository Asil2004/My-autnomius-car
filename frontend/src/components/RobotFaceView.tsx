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

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    // Och yashil fon (Soft pastel light green)
    const bgColor = new THREE.Color(0xd7f5dc); // #D7F5DC
    scene.background = bgColor;
    scene.fog = new THREE.FogExp2(0xd7f5dc, 0.04);

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 1.42, 2.7);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.45; // Yorqin va tiniq
    container.appendChild(renderer.domElement);

    // Yarqiraydigan yorug'liklar tizimi (Studio Glow & Specular Highlights)
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
    scene.add(ambientLight);

    // Asosiy old-yuqori yorug'lik (Key Light)
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(2.0, 4.0, 3.5);
    scene.add(keyLight);

    // Chap tomondan yarqiroq zumrad/yashil jilo (Emerald Rim Light)
    const rimLightLeft = new THREE.PointLight(0x00ff88, 4.5, 10);
    rimLightLeft.position.set(-2.5, 2.5, 1.0);
    scene.add(rimLightLeft);

    // O'ng tomondan yarqiroq oq-sian jilo (Cyan Specular Rim Light)
    const rimLightRight = new THREE.PointLight(0x66ffff, 4.5, 10);
    rimLightRight.position.set(2.5, 2.2, 0.8);
    scene.add(rimLightRight);

    // Tepa orqa yarqiroq jilo (Top Hair/Shoulder Highlight)
    const topBackLight = new THREE.DirectionalLight(0xffffff, 3.0);
    topBackLight.position.set(0, 4.5, -2.0);
    scene.add(topBackLight);

    let mixer: THREE.AnimationMixer | null = null;
    let characterModel: THREE.Object3D | null = null;
    let headBone: THREE.Object3D | null = null;

    const loader = new GLTFLoader();
    loader.load(
      '/result.glb',
      (gltf) => {
        characterModel = gltf.scene;

        // Modelni markazlashtirish va mos o'lchamga keltirish
        const box = new THREE.Box3().setFromObject(characterModel);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 1.9 / (maxDim || 1);
        characterModel.scale.set(scale, scale, scale);

        characterModel.position.x = -center.x * scale;
        characterModel.position.y = -center.y * scale + 1.25;
        characterModel.position.z = -center.z * scale;

        // Modelni yarqiraydigan, porloq (shiny/glossy/metallic) qilish
        characterModel.traverse((child) => {
          const name = child.name.toLowerCase();
          if (!headBone && (name.includes('head') || name.includes('neck') || name.includes('bip_head'))) {
            headBone = child;
          }

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

    // Materialni yaltiroq va yarqiraydigan qilish funksiyasi
    function enhanceMaterial(originalMat: THREE.Material): THREE.Material {
      const m = originalMat.clone() as THREE.MeshStandardMaterial;
      if (m.isMeshStandardMaterial) {
        m.roughness = 0.12; // Juda silliq, ko'zgu kabi yarqiraydigan
        m.metalness = 0.55; // Porloq metallik/plastik yarqirash
        // Nozik yarqiroq jilo
        m.emissive = new THREE.Color(0x0f3318);
        m.emissiveIntensity = 0.28;
      }
      return m;
    }

    // Animatsiya sikli: bir o'ngga, bir chapga qarab vaziyatni kuzatish
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

      // O'ngga va chapga sergak qarab kuzatish ritmi
      if (time > nextLookChange) {
        const angles = [-0.44, 0.44, 0.0, -0.38, 0.38];
        targetLookAngle = angles[Math.floor(Math.random() * angles.length)];
        nextLookChange = time + 2.4 + Math.random() * 2.0;
      }

      currentLookAngle += (targetLookAngle - currentLookAngle) * (delta * 2.5);

      if (headBone) {
        headBone.rotation.y = currentLookAngle * 0.8;
        headBone.rotation.x = Math.sin(time * 1.5) * 0.04;
      } else if (characterModel) {
        characterModel.rotation.y = currentLookAngle;
        characterModel.position.y = 1.25 + Math.sin(time * 1.8) * 0.015;
      }

      // Kamera mayin nafas tebranishi
      camera.position.x = Math.sin(time * 0.6) * 0.03;
      camera.position.y = 1.42 + Math.cos(time * 0.8) * 0.015;

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

      {/* Minimalist Ekran chetidagi Operator Kirish Tugmasi (faqat burchakda, chalg'itmaydi) */}
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
