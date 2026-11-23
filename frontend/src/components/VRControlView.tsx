import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  Eye,
  Gamepad2,
  Glasses,
  Lightbulb,
  LogOut,
  OctagonAlert,
  Radar,
  RefreshCw,
  Shield,
  Volume2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useRobot } from '../context/RobotContext';
import { ptzCameraService, CAMERA_ROTATED_180, type PtzCameraStatus } from '../services/ptzCameraService';
import { lensHub } from '../services/lensHub';
import { faceCameraSettings, type PiWebcamStatus } from '../services/faceCameraSettings';
import { lidarSerialService, type LidarObstacleInfo } from '../services/lidarSerialService';
import { tacticalAudio } from '../services/audioService';

// ---------------------------------------------------------------------------
// Minimal WebXR tiplar (DOM lib da bo'lmasa ham TypeScript xatosiz build qiladi)
// ---------------------------------------------------------------------------
interface XRSystemLike {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(mode: string, options?: { optionalFeatures?: string[]; requiredFeatures?: string[] }): Promise<XRSessionLike>;
}
interface XRSessionLike {
  inputSources: Iterable<XRInputSourceLike>;
  addEventListener(type: string, listener: () => void): void;
  updateRenderState(state: { baseLayer: XRWebGLLayerLike }): void;
  requestReferenceSpace(type: string): Promise<unknown>;
  requestAnimationFrame(cb: (time: number, frame: XRFrameLike) => void): number;
  end(): Promise<void>;
}
interface XRInputSourceLike {
  handedness: 'none' | 'left' | 'right';
  gamepad?: Gamepad;
}
interface XRWebGLLayerLike {
  framebuffer: WebGLFramebuffer | null;
  getViewport(view: XRViewLike): { x: number; y: number; width: number; height: number } | null;
}
interface XRViewLike {
  projectionMatrix: Float32Array;
  transform: { inverse: { matrix: Float32Array } };
}
interface XRFrameLike {
  session: XRSessionLike;
  getViewerPose(refSpace: unknown): {
    views: XRViewLike[];
    transform: { orientation: { x: number; y: number; z: number; w: number } };
  } | null;
}

declare global {
  interface Window {
    XRWebGLLayer?: new (session: XRSessionLike, gl: WebGL2RenderingContext | WebGLRenderingContext) => XRWebGLLayerLike;
  }
}

export type VrCamMode = 'panorama' | 'ptz' | 'frontal' | 'right' | 'left';

const VR_CAM_MODES: { id: VrCamMode; label: string; short: string }[] = [
  { id: 'panorama', label: '3-Linza 180° Panorama', short: 'PANORAMA' },
  { id: 'ptz', label: 'PTZ Markaziy Kamera', short: 'PTZ' },
  { id: 'frontal', label: 'Frontal USB Kamera', short: 'FRONTAL' },
  { id: 'right', label: "O'ng Linza", short: "O'NG" },
  { id: 'left', label: 'Chap Linza', short: 'CHAP' },
];

const PANORAMA_ORDER = [2, 0, 1] as const; // Chap | PTZ | O'ng
const TEX_W = 1440;
const TEX_H = 640;

// ---------------------------------------------------------------------------
// 4x4 Matritsa ko'paytirish + Kvaterniondan Yaw/Pitch olish (nol kutubxona!)
// ---------------------------------------------------------------------------
function mulMat4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function quatToYawPitchDeg(q: { x: number; y: number; z: number; w: number }): { yaw: number; pitch: number } {
  const siny = 2 * (q.w * q.y - q.z * q.x);
  const cosy = 1 - 2 * (q.y * q.y + q.x * q.x);
  const yaw = (Math.atan2(siny, cosy) * 180) / Math.PI;

  const sinp = Math.max(-1, Math.min(1, 2 * (q.w * q.x + q.y * q.z)));
  const pitch = (Math.asin(sinp) * 180) / Math.PI;
  return { yaw, pitch };
}

function createCurvedScreenMesh(segments = 36, radius = 2.35, arcDeg = 108, height = 1.38) {
  const arcRad = (arcDeg * Math.PI) / 180;
  const halfH = height / 2;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const angle = (u - 0.5) * arcRad; // -arc/2 .. +arc/2
    const x = Math.sin(angle) * radius;
    const z = -Math.cos(angle) * radius;

    // Yuqori nuqta (v = 0)
    positions.push(x, halfH, z);
    uvs.push(u, 0);
    // Pastki nuqta (v = 1)
    positions.push(x, -halfH, z);
    uvs.push(u, 1);

    if (i < segments) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, c, b, d);
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  };
}

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('Shader yaratib bolmadi');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) || 'Shader xatosi');
  }
  return sh;
}

const VERT_SRC = `
attribute vec3 aPos;
attribute vec2 aUv;
uniform mat4 uMvp;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = uMvp * vec4(aPos, 1.0);
}
`;

const FRAG_SRC = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTex, vUv);
}
`;

export interface VRControlViewProps {
  onExit: () => void;
}

export const VRControlView: React.FC<VRControlViewProps> = ({ onExit }) => {
  const {
    sendJoystickCoordinates,
    sendMecanumCommand,
    speedLevel,
    setSpeedLevel,
    esp32Connected,
    esp32Status,
    hornActive,
    toggleHorn,
    lightActive,
    toggleLight,
  } = useRobot();

  const [camMode, setCamMode] = useState<VrCamMode>('panorama');
  const camModeRef = useRef<VrCamMode>('panorama');
  useEffect(() => {
    camModeRef.current = camMode;
  }, [camMode]);

  const [ptzStatus, setPtzStatus] = useState<PtzCameraStatus>(() => ptzCameraService.getStatus());
  const [webcamStatus, setWebcamStatus] = useState<PiWebcamStatus>({ reachable: false, connected: false });
  const [webcamNonce, setWebcamNonce] = useState(0);
  const [lidarObs, setLidarObs] = useState<LidarObstacleInfo>(() => lidarSerialService.getObstacleInfo());

  const [xrSupported, setXrSupported] = useState<boolean>(false);
  const [xrChecking, setXrChecking] = useState<boolean>(true);
  const [xrActive, setXrActive] = useState<boolean>(false);
  const [xrError, setXrError] = useState<string>('');
  const [headTrackPtz, setHeadTrackPtz] = useState<boolean>(false);
  const headTrackRef = useRef<boolean>(false);
  useEffect(() => {
    headTrackRef.current = headTrackPtz;
  }, [headTrackPtz]);

  const [driveVec, setDriveVec] = useState({ x: 0, y: 0 });
  const [ptzVec, setPtzVec] = useState({ x: 0, y: 0 });
  const [gamepadInfo, setGamepadInfo] = useState<{ count: number; name: string }>({ count: 0, name: '' });

  const driveVecRef = useRef({ x: 0, y: 0 });
  const ptzVecRef = useRef({ x: 0, y: 0 });
  const speedRef = useRef(speedLevel);
  const espStatusRef = useRef({ connected: esp32Connected, text: esp32Status });
  const lidarObsRef = useRef(lidarObs);
  useEffect(() => {
    speedRef.current = speedLevel;
  }, [speedLevel]);
  useEffect(() => {
    espStatusRef.current = { connected: esp32Connected, text: esp32Status };
  }, [esp32Connected, esp32Status]);
  useEffect(() => {
    lidarObsRef.current = lidarObs;
  }, [lidarObs]);

  // Video elementlari & kanvaslar
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frontalImgRef = useRef<HTMLImageElement | null>(null);
  const xrSessionRef = useRef<XRSessionLike | null>(null);

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const frontalUrl = faceCameraSettings.piWebcamStreamUrl(webcamNonce);

  // PTZ 3-linza va Frontal kamera statuslariga obuna
  useEffect(() => ptzCameraService.subscribe(setPtzStatus), []);
  useEffect(() => lensHub.acquire(), []);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const st = await faceCameraSettings.checkPiWebcam();
      if (active) setWebcamStatus(st);
    };
    void poll();
    const t = window.setInterval(() => void poll(), 4000);
    return () => {
      active = false;
      window.clearInterval(t);
    };
  }, []);

  // LiDAR to'siq masofalarini kuzatish
  useEffect(() => {
    const t = window.setInterval(() => {
      setLidarObs({ ...lidarSerialService.getObstacleInfo() });
    }, 200);
    return () => window.clearInterval(t);
  }, []);

  // Meta Quest 2 WebXR qo'llab-quvvatlashini tekshirish
  useEffect(() => {
    const xr = (navigator as unknown as { xr?: XRSystemLike }).xr;
    if (!xr || typeof xr.isSessionSupported !== 'function') {
      setXrSupported(false);
      setXrChecking(false);
      return;
    }
    xr.isSessionSupported('immersive-vr')
      .then((ok) => {
        setXrSupported(ok);
        setXrChecking(false);
      })
      .catch(() => {
        setXrSupported(false);
        setXrChecking(false);
      });
  }, []);

  // ---------------------------------------------------------------------------
  // Umumiy Kadr + Taktik HUD Kompozitori (2D preview va WebXR 3D ekran uchun!)
  // ---------------------------------------------------------------------------
  const renderCompositeFrame = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.fillStyle = '#050811';
    ctx.fillRect(0, 0, w, h);

    const mode = camModeRef.current;
    const videoTop = 44;
    const videoBottom = h - 46;
    const videoH = Math.max(100, videoBottom - videoTop);
    let hasVideo = false;

    if (mode === 'frontal') {
      const img = frontalImgRef.current;
      if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
        const scale = Math.min(w / img.naturalWidth, videoH / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        try {
          ctx.drawImage(img, (w - dw) / 2, videoTop + (videoH - dh) / 2, dw, dh);
          hasVideo = true;
        } catch {
          /* CORS yoki yuklanmagan */
        }
      }
    } else {
      const frame = lensHub.current();
      if (frame) {
        const lenses = Math.max(1, Math.round((frame.height * 16) / (frame.width * 9)));
        const sw = frame.width;
        const sh = frame.height / lenses;

        if (mode === 'panorama') {
          const order = PANORAMA_ORDER.filter((l) => l < lenses);
          const gap = 4;
          const slotW = (w - gap * (order.length - 1)) / Math.max(1, order.length);
          order.forEach((lens, idx) => {
            const sy = sh * lens;
            const x0 = idx * (slotW + gap);
            const scale = Math.max(slotW / sw, videoH / sh);
            const dw = sw * scale;
            const dh = sh * scale;
            ctx.save();
            ctx.beginPath();
            ctx.rect(x0, videoTop, slotW, videoH);
            ctx.clip();
            if (CAMERA_ROTATED_180) {
              ctx.translate(x0 + slotW / 2, videoTop + videoH / 2);
              ctx.rotate(Math.PI);
              ctx.drawImage(frame.src, 0, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
            } else {
              ctx.drawImage(frame.src, 0, sy, sw, sh, x0 + (slotW - dw) / 2, videoTop + (videoH - dh) / 2, dw, dh);
            }
            ctx.restore();
            // Linza yorlig'i
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(x0 + 8, videoTop + 8, 74, 22);
            ctx.fillStyle = lens === 0 ? '#22d3ee' : '#cbd5e1';
            ctx.font = 'bold 12px monospace';
            ctx.fillText(lens === 0 ? 'PTZ' : lens === 1 ? "O'NG" : 'CHAP', x0 + 16, videoTop + 23);
          });
          hasVideo = true;
        } else {
          const lensIdx = mode === 'ptz' ? 0 : mode === 'right' ? 1 : 2;
          if (lensIdx < lenses) {
            const sy = sh * lensIdx;
            const scale = Math.min(w / sw, videoH / sh);
            const dw = sw * scale;
            const dh = sh * scale;
            ctx.save();
            if (CAMERA_ROTATED_180) {
              ctx.translate(w / 2, videoTop + videoH / 2);
              ctx.rotate(Math.PI);
              ctx.drawImage(frame.src, 0, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
            } else {
              ctx.drawImage(frame.src, 0, sy, sw, sh, (w - dw) / 2, videoTop + (videoH - dh) / 2, dw, dh);
            }
            ctx.restore();
            hasVideo = true;
          }
        }
      }
    }

    if (!hasVideo) {
      // 3-linzali PTZ topilmasa, mavjud USB frontal veb-kameraga avtomatik o'tish (Black screen bo'lib qolmasligi uchun)
      const img = frontalImgRef.current;
      if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
        const scale = Math.min(w / img.naturalWidth, videoH / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        try {
          ctx.drawImage(img, (w - dw) / 2, videoTop + (videoH - dh) / 2, dw, dh);
          hasVideo = true;
        } catch {
          /* yuklanmagan */
        }
      }
    }

    if (!hasVideo) {
      ctx.fillStyle = '#0b1222';
      ctx.fillRect(0, videoTop, w, videoH);
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 22px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('KAMERA SIGNALI KUTILMOQDA...', w / 2, videoTop + videoH / 2 - 10);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px monospace';
      ctx.fillText('Raspberry Pi 5 VPS ga ulanganini va kameralar yoqilganini tekshiring', w / 2, videoTop + videoH / 2 + 20);
      ctx.textAlign = 'left';
    }

    // Markaziy taktik nishon (crosshair)
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.35)';
    ctx.lineWidth = 1.5;
    const cx = w / 2;
    const cy = videoTop + videoH / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy);
    ctx.lineTo(cx - 6, cy);
    ctx.moveTo(cx + 6, cy);
    ctx.lineTo(cx + 18, cy);
    ctx.moveTo(cx, cy - 18);
    ctx.lineTo(cx, cy - 6);
    ctx.moveTo(cx, cy + 6);
    ctx.lineTo(cx, cy + 18);
    ctx.stroke();

    // YUQORI HUD PANELI
    ctx.fillStyle = 'rgba(5, 10, 20, 0.92)';
    ctx.fillRect(0, 0, w, videoTop);
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.45)';
    ctx.beginPath();
    ctx.moveTo(0, videoTop);
    ctx.lineTo(w, videoTop);
    ctx.stroke();

    const esp = espStatusRef.current;
    const obs = lidarObsRef.current;
    const modeLabel = VR_CAM_MODES.find((m) => m.id === mode)?.label ?? mode.toUpperCase();

    ctx.fillStyle = '#22d3ee';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`QALQON VR COCKPIT  |  ${modeLabel}`, 18, 28);

    ctx.fillStyle = esp.connected ? '#34d399' : '#f87171';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`ROBOT: ${esp.connected ? esp.text : 'OFLAYN'}`, w * 0.48, 28);

    const frontTxt = obs.frontCm < 500 ? `${obs.frontCm} sm` : 'OCHIQ';
    ctx.fillStyle = obs.isBlocked ? '#fb7185' : '#38bdf8';
    ctx.fillText(`LIDAR OLD: ${frontTxt}  |  TEZLIK: ${speedRef.current} (${speedRef.current === 1 ? '50%' : speedRef.current === 2 ? '75%' : '100%'})`, w * 0.72, 28);

    // LiDAR To'siq ogohlantirish banneri (VR ichida aniq ko'rinadi!)
    if (obs.isBlocked) {
      ctx.fillStyle = 'rgba(225, 29, 72, 0.85)';
      ctx.fillRect(w / 2 - 210, videoTop + 16, 420, 38);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`⚠ TO'SIQ ANIQLANDI: ${obs.frontCm} SM ⚠`, w / 2, videoTop + 41);
      ctx.textAlign = 'left';
    }

    // PASTKI HUD PANELI (Quest 2 tugmalar yo'riqnomasi + Jonli vektorlar)
    ctx.fillStyle = 'rgba(5, 10, 20, 0.92)';
    ctx.fillRect(0, videoBottom, w, h - videoBottom);
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.35)';
    ctx.beginPath();
    ctx.moveTo(0, videoBottom);
    ctx.lineTo(w, videoBottom);
    ctx.stroke();

    const dv = driveVecRef.current;
    const pv = ptzVecRef.current;
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`CHAP STIK (YURISH): X=${dv.x} Y=${dv.y}`, 18, videoBottom + 29);

    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`O'NG STIK (PTZ): P=${pv.x.toFixed(1)} T=${pv.y.toFixed(1)}${headTrackRef.current ? ' [BOSH KUZATUVI YONIQ]' : ''}`, w * 0.29, videoBottom + 29);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px monospace';
    ctx.fillText('[A] Kamera  [B] Bosh-PTZ  [X] Tezlik  [O‘ng Trigger] E-STOP', w * 0.67, videoBottom + 29);
  }, []);

  // 2D Preview Kanvasini chizish sikli (15 FPS — yengil!)
  useEffect(() => {
    if (xrActive) return;
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 66) return;
      last = now;
      const canvas = previewCanvasRef.current;
      if (!canvas) return;
      if (canvas.width !== TEX_W || canvas.height !== TEX_H) {
        canvas.width = TEX_W;
        canvas.height = TEX_H;
      }
      const ctx = canvas.getContext('2d');
      if (ctx) renderCompositeFrame(ctx, TEX_W, TEX_H);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [xrActive, renderCompositeFrame]);

  // ---------------------------------------------------------------------------
  // 2D Brauzerda Gamepad API (Bluetooth Xbox/PS pult yoki 2D Quest kontroller)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (xrActive) return;
    let raf = 0;
    let lastDrive = 0;
    let lastPtz = 0;
    let hadDrive = false;
    let hadPtz = false;
    let lastUi = 0;

    const readStick = (gp: Gamepad, preferXr: boolean): [number, number] => {
      if (preferXr && gp.axes.length >= 4) {
        const a2 = gp.axes[2] ?? 0;
        const a3 = gp.axes[3] ?? 0;
        if (Math.abs(a2) > 0.05 || Math.abs(a3) > 0.05) return [a2, a3];
      }
      return [gp.axes[0] ?? 0, gp.axes[1] ?? 0];
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const gps =
        typeof navigator.getGamepads === 'function'
          ? Array.from(navigator.getGamepads()).filter((g): g is Gamepad => Boolean(g && g.connected))
          : [];
      const now = Date.now();
      if (now - lastUi > 500) {
        lastUi = now;
        setGamepadInfo((prev) =>
          prev.count === gps.length && prev.name === (gps[0]?.id || '') ? prev : { count: gps.length, name: gps[0]?.id || '' }
        );
      }
      if (gps.length === 0) return;

      let lx = 0;
      let ly = 0;
      let rx = 0;
      let ry = 0;

      const leftGp = gps.find((g) => /left/i.test(g.id));
      const rightGp = gps.find((g) => /right/i.test(g.id));
      if (leftGp || rightGp) {
        if (leftGp) [lx, ly] = readStick(leftGp, true);
        if (rightGp) [rx, ry] = readStick(rightGp, true);
      } else {
        lx = gps[0].axes[0] ?? 0;
        ly = gps[0].axes[1] ?? 0;
        rx = gps[0].axes[2] ?? 0;
        ry = gps[0].axes[3] ?? 0;
      }

      const dz = 0.16;
      if (Math.abs(lx) > dz || Math.abs(ly) > dz) {
        hadDrive = true;
        const dx = Math.round(lx * 100);
        const dy = Math.round(-ly * 100);
        driveVecRef.current = { x: dx, y: dy };
        if (now - lastDrive >= 55) {
          lastDrive = now;
          setDriveVec({ x: dx, y: dy });
          sendJoystickCoordinates(dx, dy);
        }
      } else if (hadDrive) {
        hadDrive = false;
        driveVecRef.current = { x: 0, y: 0 };
        setDriveVec({ x: 0, y: 0 });
        sendJoystickCoordinates(0, 0);
      }

      if (Math.abs(rx) > dz || Math.abs(ry) > dz) {
        hadPtz = true;
        ptzVecRef.current = { x: rx, y: -ry };
        if (now - lastPtz >= 85) {
          lastPtz = now;
          setPtzVec({ x: rx, y: -ry });
          ptzCameraService.move(CAMERA_ROTATED_180 ? -rx : rx, CAMERA_ROTATED_180 ? ry : -ry);
        }
      } else if (hadPtz) {
        hadPtz = false;
        ptzVecRef.current = { x: 0, y: 0 };
        setPtzVec({ x: 0, y: 0 });
        ptzCameraService.stop();
      }
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [xrActive, sendJoystickCoordinates]);

  // Klaviatura boshqaruvi (PC sinovi uchun: WASD = yurish, Strelkalar = PTZ, Space = STOP, C = Kamera)
  useEffect(() => {
    const keys = new Set<string>();
    let driveTimer: number | null = null;

    const syncKeys = () => {
      let x = 0;
      let y = 0;
      if (keys.has('KeyW')) y += 100;
      if (keys.has('KeyS')) y -= 100;
      if (keys.has('KeyD')) x += 100;
      if (keys.has('KeyA')) x -= 100;
      driveVecRef.current = { x, y };
      setDriveVec({ x, y });
      sendJoystickCoordinates(x, y);
    };

    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space') {
        e.preventDefault();
        keys.clear();
        sendJoystickCoordinates(0, 0);
        sendMecanumCommand('S');
        ptzCameraService.stop();
        return;
      }
      if (e.code === 'KeyC') {
        setCamMode((prev) => {
          const idx = VR_CAM_MODES.findIndex((m) => m.id === prev);
          return VR_CAM_MODES[(idx + 1) % VR_CAM_MODES.length].id;
        });
        return;
      }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
        keys.add(e.code);
        syncKeys();
        if (!driveTimer) driveTimer = window.setInterval(syncKeys, 120);
      } else if (e.code === 'ArrowLeft') {
        ptzCameraService.move(CAMERA_ROTATED_180 ? 0.65 : -0.65, 0);
      } else if (e.code === 'ArrowRight') {
        ptzCameraService.move(CAMERA_ROTATED_180 ? -0.65 : 0.65, 0);
      } else if (e.code === 'ArrowUp') {
        ptzCameraService.move(0, CAMERA_ROTATED_180 ? -0.65 : 0.65);
      } else if (e.code === 'ArrowDown') {
        ptzCameraService.move(0, CAMERA_ROTATED_180 ? 0.65 : -0.65);
      }
    };

    const onUp = (e: KeyboardEvent) => {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
        keys.delete(e.code);
        syncKeys();
        if (keys.size === 0 && driveTimer) {
          clearInterval(driveTimer);
          driveTimer = null;
        }
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
        ptzCameraService.stop();
      }
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      if (driveTimer) clearInterval(driveTimer);
    };
  }, [sendJoystickCoordinates, sendMecanumCommand]);

  // ---------------------------------------------------------------------------
  // META QUEST 2 IMMERSIVE WEBXR (Pure WebGL2 egri IMAX ekran + Touch Controllers)
  // ---------------------------------------------------------------------------
  const enterMetaQuestVR = async () => {
    setXrError('');
    const xr = (navigator as unknown as { xr?: XRSystemLike }).xr;
    if (!xr || !window.XRWebGLLayer) {
      setXrError(
        !isHttps
          ? "WebXR xavfsizlik talabi: faqat HTTPS da ishlaydi! GitHub Pages (https://asil2004.github.io/My-autnomius-car/#vr) orqali oching yoki chrome://flags orqali 10.23.21.132:8000 ga ruxsat bering."
          : "Ushbu brauzerda WebXR topilmadi. Meta Quest 2 ichidagi Meta Quest Browser da oching."
      );
      return;
    }

    try {
      const session = await xr.requestSession('immersive-vr', {
        optionalFeatures: ['local', 'local-floor'],
      });
      xrSessionRef.current = session;
      setXrActive(true);

      const glCanvas = document.createElement('canvas');
      const gl = glCanvas.getContext('webgl2', { xrCompatible: true, antialias: true }) as WebGL2RenderingContext | null;
      if (!gl) throw new Error('WebGL2 ishga tushmadi');

      const layer = new window.XRWebGLLayer(session, gl);
      session.updateRenderState({ baseLayer: layer });

      let refSpace: unknown;
      try {
        refSpace = await session.requestReferenceSpace('local');
      } catch {
        refSpace = await session.requestReferenceSpace('viewer');
      }

      // Egri 3D ekran shayderi va buferlari
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, VERT_SRC));
      gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC));
      gl.linkProgram(prog);
      gl.useProgram(prog);

      const mesh = createCurvedScreenMesh(40, 2.35, 112, 1.38);
      const posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

      const uvBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.uvs, gl.STATIC_DRAW);
      const aUv = gl.getAttribLocation(prog, 'aUv');
      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

      const idxBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

      const uMvp = gl.getUniformLocation(prog, 'uMvp');
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      // 2D video+HUD kompozit kanvas
      if (!offscreenCanvasRef.current) {
        const c = document.createElement('canvas');
        c.width = TEX_W;
        c.height = TEX_H;
        offscreenCanvasRef.current = c;
      }
      const texCanvas = offscreenCanvasRef.current;
      const texCtx = texCanvas.getContext('2d')!;

      let lastTexUpdate = 0;
      let lastDriveSent = 0;
      let lastPtzSent = 0;
      let hadDrive = false;
      let hadPtz = false;
      let prevBtnA = false;
      let prevBtnB = false;
      let prevBtnX = false;
      let prevBtnY = false;
      let prevLeftTrig = false;
      let headCenter: { yaw: number; pitch: number } | null = null;

      session.addEventListener('end', () => {
        xrSessionRef.current = null;
        setXrActive(false);
        // Xavfsizlik: VR yopilganda robot va PTZ darhol to'xtaydi
        driveVecRef.current = { x: 0, y: 0 };
        ptzVecRef.current = { x: 0, y: 0 };
        sendJoystickCoordinates(0, 0);
        sendMecanumCommand('S');
        ptzCameraService.stop();
      });

      const onXrFrame = (time: number, frame: XRFrameLike) => {
        session.requestAnimationFrame(onXrFrame);
        const now = Date.now();

        // 1. META QUEST 2 TOUCH CONTROLLERS (Left = Drive, Right = PTZ)
        let lx = 0;
        let ly = 0;
        let rx = 0;
        let ry = 0;
        let eStopPressed = false;
        let btnA = false;
        let btnB = false;
        let btnX = false;
        let btnY = false;
        let leftTrig = false;

        for (const src of session.inputSources) {
          const gp = src.gamepad;
          if (!gp) continue;
          // Quest 2 xr-standard: thumbstick axes[2], axes[3] (fallback axes[0], axes[1])
          const sx = gp.axes.length >= 4 && (Math.abs(gp.axes[2]) > 0.02 || Math.abs(gp.axes[3]) > 0.02) ? gp.axes[2] : gp.axes[0] ?? 0;
          const sy = gp.axes.length >= 4 && (Math.abs(gp.axes[2]) > 0.02 || Math.abs(gp.axes[3]) > 0.02) ? gp.axes[3] : gp.axes[1] ?? 0;

          if (src.handedness === 'left') {
            lx = sx;
            ly = sy;
            leftTrig = Boolean(gp.buttons[0]?.pressed);
            btnX = Boolean(gp.buttons[4]?.pressed);
            btnY = Boolean(gp.buttons[5]?.pressed);
          } else if (src.handedness === 'right') {
            rx = sx;
            ry = sy;
            eStopPressed = Boolean(gp.buttons[0]?.pressed);
            btnA = Boolean(gp.buttons[4]?.pressed);
            btnB = Boolean(gp.buttons[5]?.pressed);
          }
        }

        // Tugma hodisalari (edge trigger)
        if (btnA && !prevBtnA) {
          setCamMode((prev) => {
            const idx = VR_CAM_MODES.findIndex((m) => m.id === prev);
            return VR_CAM_MODES[(idx + 1) % VR_CAM_MODES.length].id;
          });
        }
        prevBtnA = btnA;

        if (btnB && !prevBtnB) {
          headCenter = null;
          setHeadTrackPtz((prev) => !prev);
        }
        prevBtnB = btnB;

        if (btnX && !prevBtnX) {
          const nextSpd = ((speedRef.current % 3) + 1) as 1 | 2 | 3;
          setSpeedLevel(nextSpd);
        }
        prevBtnX = btnX;

        if (btnY && !prevBtnY) {
          toggleLight();
        }
        prevBtnY = btnY;

        if (leftTrig !== prevLeftTrig) {
          prevLeftTrig = leftTrig;
          toggleHorn();
        }

        // Favqulodda E-STOP (O'ng Trigger)
        if (eStopPressed) {
          hadDrive = false;
          hadPtz = false;
          driveVecRef.current = { x: 0, y: 0 };
          ptzVecRef.current = { x: 0, y: 0 };
          sendJoystickCoordinates(0, 0);
          sendMecanumCommand('S');
          ptzCameraService.stop();
        } else {
          // Chap Touch Stik -> Robot Harakati
          const dz = 0.16;
          if (Math.abs(lx) > dz || Math.abs(ly) > dz) {
            hadDrive = true;
            const dx = Math.round(lx * 100);
            const dy = Math.round(-ly * 100);
            driveVecRef.current = { x: dx, y: dy };
            if (now - lastDriveSent >= 55) {
              lastDriveSent = now;
              sendJoystickCoordinates(dx, dy);
            }
          } else if (hadDrive) {
            hadDrive = false;
            driveVecRef.current = { x: 0, y: 0 };
            sendJoystickCoordinates(0, 0);
          }

          // O'ng Touch Stik (yoki Bosh Harakati) -> PTZ Kamera Burish
          let ptzPanCmd = 0;
          let ptzTiltCmd = 0;
          if (Math.abs(rx) > dz || Math.abs(ry) > dz) {
            ptzPanCmd = rx;
            ptzTiltCmd = -ry;
          } else if (headTrackRef.current) {
            const poseForHead = frame.getViewerPose(refSpace);
            if (poseForHead) {
              const angles = quatToYawPitchDeg(poseForHead.transform.orientation);
              if (!headCenter) headCenter = angles;
              const dYaw = angles.yaw - headCenter.yaw;
              const dPitch = angles.pitch - headCenter.pitch;
              if (Math.abs(dYaw) > 14) ptzPanCmd = Math.max(-1, Math.min(1, -dYaw / 40));
              if (Math.abs(dPitch) > 12) ptzTiltCmd = Math.max(-1, Math.min(1, dPitch / 35));
            }
          }

          if (Math.abs(ptzPanCmd) > 0.15 || Math.abs(ptzTiltCmd) > 0.15) {
            hadPtz = true;
            ptzVecRef.current = { x: ptzPanCmd, y: ptzTiltCmd };
            if (now - lastPtzSent >= 85) {
              lastPtzSent = now;
              ptzCameraService.move(
                CAMERA_ROTATED_180 ? -ptzPanCmd : ptzPanCmd,
                CAMERA_ROTATED_180 ? -ptzTiltCmd : ptzTiltCmd
              );
            }
          } else if (hadPtz) {
            hadPtz = false;
            ptzVecRef.current = { x: 0, y: 0 };
            ptzCameraService.stop();
          }
        }

        // 2. Video + HUD teksturasini ~20 FPS da yangilash
        if (time - lastTexUpdate >= 48) {
          lastTexUpdate = time;
          renderCompositeFrame(texCtx, TEX_W, TEX_H);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texCanvas);
        }

        // 3. Stereo (Chap ko'z + O'ng ko'z) 3D Render
        const pose = frame.getViewerPose(refSpace);
        if (!pose) return;

        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
        gl.clearColor(0.02, 0.03, 0.06, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);

        for (const view of pose.views) {
          const vp = layer.getViewport(view);
          if (!vp) continue;
          gl.viewport(vp.x, vp.y, vp.width, vp.height);
          const mvp = mulMat4(view.projectionMatrix, view.transform.inverse.matrix);
          gl.uniformMatrix4fv(uMvp, false, mvp);
          gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
        }
      };

      session.requestAnimationFrame(onXrFrame);
    } catch (err) {
      setXrActive(false);
      setXrError(err instanceof Error ? err.message : 'WebXR sessiyasini ochib bolmadi');
    }
  };

  // ---------------------------------------------------------------------------
  // 2D Lazer/Sensorli Joystiklar (Meta Quest 2 2D brauzerda ham 100% ishlaydi!)
  // ---------------------------------------------------------------------------
  const drivePadRef = useRef<HTMLDivElement | null>(null);
  const ptzPadRef = useRef<HTMLDivElement | null>(null);
  const [driveDragging, setDriveDragging] = useState(false);
  const [ptzDragging, setPtzDragging] = useState(false);
  const driveHoldTimerRef = useRef<number | null>(null);
  const ptzHoldTimerRef = useRef<number | null>(null);

  const updateDrivePad = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = drivePadRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxR = rect.width * 0.42;
    let dx = e.clientX - (rect.left + rect.width / 2);
    let dy = e.clientY - (rect.top + rect.height / 2);
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    const nx = Math.round((dx / maxR) * 100);
    const ny = Math.round((-dy / maxR) * 100);
    driveVecRef.current = { x: nx, y: ny };
    setDriveVec({ x: nx, y: ny });
    sendJoystickCoordinates(nx, ny);
  };

  const stopDrive = () => {
    setDriveDragging(false);
    if (driveHoldTimerRef.current) {
      clearInterval(driveHoldTimerRef.current);
      driveHoldTimerRef.current = null;
    }
    driveVecRef.current = { x: 0, y: 0 };
    setDriveVec({ x: 0, y: 0 });
    sendJoystickCoordinates(0, 0);
  };

  const holdDriveVec = (x: number, y: number) => {
    if (driveHoldTimerRef.current) clearInterval(driveHoldTimerRef.current);
    driveVecRef.current = { x, y };
    setDriveVec({ x, y });
    sendJoystickCoordinates(x, y);
    driveHoldTimerRef.current = window.setInterval(() => {
      sendJoystickCoordinates(x, y);
    }, 120);
  };

  const updatePtzPad = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ptzPadRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxR = rect.width * 0.42;
    let dx = e.clientX - (rect.left + rect.width / 2);
    let dy = e.clientY - (rect.top + rect.height / 2);
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    const px = +(dx / maxR).toFixed(2);
    const py = +(-dy / maxR).toFixed(2);
    ptzVecRef.current = { x: px, y: py };
    setPtzVec({ x: px, y: py });
    ptzCameraService.move(CAMERA_ROTATED_180 ? -px : px, CAMERA_ROTATED_180 ? -py : py);
  };

  const stopPtz = () => {
    setPtzDragging(false);
    if (ptzHoldTimerRef.current) {
      clearInterval(ptzHoldTimerRef.current);
      ptzHoldTimerRef.current = null;
    }
    ptzVecRef.current = { x: 0, y: 0 };
    setPtzVec({ x: 0, y: 0 });
    ptzCameraService.stop();
  };

  const holdPtzVec = (px: number, py: number) => {
    if (ptzHoldTimerRef.current) clearInterval(ptzHoldTimerRef.current);
    ptzVecRef.current = { x: px, y: py };
    setPtzVec({ x: px, y: py });
    ptzCameraService.move(CAMERA_ROTATED_180 ? -px : px, CAMERA_ROTATED_180 ? -py : py);
    ptzHoldTimerRef.current = window.setInterval(() => {
      ptzCameraService.move(CAMERA_ROTATED_180 ? -px : px, CAMERA_ROTATED_180 ? -py : py);
    }, 180);
  };

  useEffect(() => {
    return () => {
      if (driveHoldTimerRef.current) clearInterval(driveHoldTimerRef.current);
      if (ptzHoldTimerRef.current) clearInterval(ptzHoldTimerRef.current);
      sendJoystickCoordinates(0, 0);
      ptzCameraService.stop();
      if (xrSessionRef.current) {
        void xrSessionRef.current.end().catch(() => {});
      }
    };
  }, [sendJoystickCoordinates]);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#050811] text-slate-100 overflow-hidden select-none font-sans">
      {/* Yashirin Frontal USB MJPEG <img> (kanvas & WebXR teksturasi uchun same-origin) */}
      {frontalUrl && (
        <img
          ref={frontalImgRef}
          src={frontalUrl}
          crossOrigin="anonymous"
          alt="Frontal USB"
          onError={() => window.setTimeout(() => setWebcamNonce((n) => n + 1), 3000)}
          className="hidden"
        />
      )}

      {/* YUQORI BAR: Holat + Meta Quest 2 WebXR Tugmasi + Chiqish */}
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#0a1020] border-b border-cyan-500/30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-400/60 flex items-center justify-center">
            <Glasses className="w-5 h-5 text-cyan-300" />
          </div>
          <div>
            <div className="font-mono font-extrabold text-sm tracking-wider text-white flex items-center gap-2">
              QALQON VR KOKPIT
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                META QUEST 2
              </span>
            </div>
            <div className="font-mono text-[10px] text-slate-400 flex items-center gap-2.5">
              <span className={`flex items-center gap-1 ${esp32Connected ? 'text-emerald-400' : 'text-rose-400'}`}>
                {esp32Connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                {esp32Connected ? esp32Status : 'ROBOT OFLAYN'}
              </span>
              <span className={ptzStatus.video ? 'text-emerald-400' : 'text-amber-400'}>
                PTZ: {ptzStatus.video ? 'JONLI' : 'KUTILMOQDA'}
              </span>
              <span className={webcamStatus.connected ? 'text-emerald-400' : 'text-amber-400'}>
                USB: {webcamStatus.connected ? 'JONLI' : 'KUTILMOQDA'}
              </span>
              <span className={lidarObs.isBlocked ? 'text-rose-400 font-bold' : 'text-cyan-300'}>
                <Radar className="w-3 h-3 inline mr-0.5" />
                {lidarObs.frontCm < 500 ? `${lidarObs.frontCm} sm` : 'OCHIQ'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Meta Quest 2 Immersive VR tugmasi */}
          <button
            type="button"
            onClick={() => {
              tacticalAudio.playClick();
              void enterMetaQuestVR();
            }}
            className={`px-3.5 py-2 rounded-lg font-mono font-black text-xs flex items-center gap-2 transition-all shadow-lg ${
              xrSupported
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:brightness-110 shadow-cyan-500/30 animate-pulse'
                : 'bg-slate-800 text-cyan-300 border border-cyan-500/50 hover:bg-slate-700'
            }`}
          >
            <Glasses className="w-4 h-4" />
            <span>
              {xrChecking
                ? 'WebXR tekshirilmoqda...'
                : xrSupported
                ? 'META QUEST 2 — VR GA KIRISH'
                : 'VR REJIM (WebXR)'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              tacticalAudio.playClick();
              sendJoystickCoordinates(0, 0);
              sendMecanumCommand('S');
              ptzCameraService.stop();
            }}
            className="px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-mono font-black text-xs flex items-center gap-1.5"
          >
            <OctagonAlert className="w-4 h-4" />
            E-STOP
          </button>

          <button
            type="button"
            onClick={() => {
              tacticalAudio.playClick();
              onExit();
            }}
            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-mono text-xs flex items-center gap-1.5"
          >
            <LogOut className="w-4 h-4" />
            HUD
          </button>
        </div>
      </header>

      {/* Xato / HTTPS ogohlantirish satri */}
      {xrError && (
        <div className="px-4 py-1.5 bg-amber-950/90 border-b border-amber-500/50 text-amber-200 font-mono text-xs flex items-center justify-between">
          <span>⚠️ {xrError}</span>
          <button type="button" onClick={() => setXrError('')} className="text-amber-400 hover:text-white ml-4">
            ✕
          </button>
        </div>
      )}

      {/* KAMERA TANLASH PANELI */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-[#080d1a] border-b border-slate-800">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <Camera className="w-4 h-4 text-cyan-400 shrink-0 mr-1" />
          {VR_CAM_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                tacticalAudio.playClick();
                setCamMode(m.id);
              }}
              className={`px-2.5 py-1 rounded font-mono text-xs font-bold whitespace-nowrap transition-all ${
                camMode === m.id
                  ? 'bg-cyan-500/25 border border-cyan-400 text-cyan-200'
                  : 'bg-slate-900 border border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              {m.short}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px]">
          <button
            type="button"
            onClick={() => setHeadTrackPtz((v) => !v)}
            className={`px-2.5 py-1 rounded border flex items-center gap-1 ${
              headTrackPtz
                ? 'bg-emerald-900/50 border-emerald-400 text-emerald-300'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            Bosh-PTZ: {headTrackPtz ? 'YONIQ' : "O'CHIQ"}
          </button>

          <span className={`px-2 py-1 rounded border flex items-center gap-1 ${
            gamepadInfo.count > 0 ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-300' : 'bg-slate-900 border-slate-700 text-slate-400'
          }`}>
            <Gamepad2 className="w-3.5 h-3.5" />
            {gamepadInfo.count > 0 ? `Kontroller: ${gamepadInfo.count}` : 'Kontroller kutilmoqda'}
          </span>

          <button
            type="button"
            onClick={() => {
              setWebcamNonce((n) => n + 1);
              void ptzCameraService.refresh();
            }}
            className="p-1 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white"
            title="Kameralarni qayta ulash"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ASOSIY KOKPIT: KATTA JONLI VIDEO + IKKI TOMONDA QUEST-MOS JOYSTIKLAR */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden p-2 gap-2">
        {/* CHAP PANEL: ROBOT HARAKATI (QUEST LAZER + TOUCH + D-PAD) */}
        <div className="lg:w-64 shrink-0 bg-[#0a1122] border border-slate-800 rounded-xl p-3 flex flex-col items-center justify-between gap-2">
          <div className="w-full flex items-center justify-between font-mono text-xs">
            <span className="font-bold text-cyan-300 flex items-center gap-1.5">
              <Shield className="w-4 h-4" /> ROBOT HARAKATI
            </span>
            <span className="text-[10px] text-slate-400">
              {driveVec.x},{driveVec.y}
            </span>
          </div>

          {/* 360° Analog Joystik */}
          <div
            ref={drivePadRef}
            onPointerDown={(e) => {
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {}
              setDriveDragging(true);
              updateDrivePad(e);
            }}
            onPointerMove={(e) => {
              if (driveDragging) updateDrivePad(e);
            }}
            onPointerUp={stopDrive}
            onPointerCancel={stopDrive}
            style={{ touchAction: 'none' }}
            className="relative w-40 h-40 rounded-full bg-slate-950 border-2 border-cyan-500/50 shadow-inner flex items-center justify-center cursor-pointer"
          >
            <span className="absolute top-2 text-[10px] font-mono text-slate-500">OLDINGA</span>
            <span className="absolute bottom-2 text-[10px] font-mono text-slate-500">ORQAGA</span>
            <span className="absolute left-2 text-[10px] font-mono text-slate-500">L</span>
            <span className="absolute right-2 text-[10px] font-mono text-slate-500">R</span>
            <div
              className="w-14 h-14 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 border-2 border-white/70 shadow-[0_0_20px_rgba(34,211,238,0.6)] pointer-events-none"
              style={{
                transform: `translate(${(driveVec.x / 100) * 52}px, ${(-driveVec.y / 100) * 52}px)`,
              }}
            />
          </div>

          {/* Quest Lazer Trigger uchun katta bosib turiladigan D-Pad */}
          <div className="grid grid-cols-3 gap-1.5 w-full">
            <div />
            <button
              type="button"
              onPointerDown={() => holdDriveVec(0, 100)}
              onPointerUp={stopDrive}
              onPointerLeave={stopDrive}
              className="h-10 rounded-lg bg-slate-800 hover:bg-cyan-700 active:bg-cyan-600 border border-slate-600 flex items-center justify-center"
            >
              <ArrowUp className="w-5 h-5" />
            </button>
            <div />
            <button
              type="button"
              onPointerDown={() => holdDriveVec(-100, 0)}
              onPointerUp={stopDrive}
              onPointerLeave={stopDrive}
              className="h-10 rounded-lg bg-slate-800 hover:bg-cyan-700 active:bg-cyan-600 border border-slate-600 flex items-center justify-center"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={stopDrive}
              className="h-10 rounded-lg bg-rose-700 hover:bg-rose-600 text-white font-mono font-bold text-[10px]"
            >
              STOP
            </button>
            <button
              type="button"
              onPointerDown={() => holdDriveVec(100, 0)}
              onPointerUp={stopDrive}
              onPointerLeave={stopDrive}
              className="h-10 rounded-lg bg-slate-800 hover:bg-cyan-700 active:bg-cyan-600 border border-slate-600 flex items-center justify-center"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
            <div />
            <button
              type="button"
              onPointerDown={() => holdDriveVec(0, -100)}
              onPointerUp={stopDrive}
              onPointerLeave={stopDrive}
              className="h-10 rounded-lg bg-slate-800 hover:bg-cyan-700 active:bg-cyan-600 border border-slate-600 flex items-center justify-center"
            >
              <ArrowDown className="w-5 h-5" />
            </button>
            <div />
          </div>

          {/* Tezlik va Qo'shimchalar */}
          <div className="w-full space-y-1.5">
            <div className="grid grid-cols-3 gap-1">
              {([1, 2, 3] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setSpeedLevel(lvl)}
                  className={`py-1.5 rounded font-mono text-xs font-bold border ${
                    speedLevel === lvl
                      ? 'bg-cyan-600/40 border-cyan-400 text-white'
                      : 'bg-slate-900 border-slate-700 text-slate-400'
                  }`}
                >
                  {lvl === 1 ? '50%' : lvl === 2 ? '75%' : '100%'}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={toggleHorn}
                className={`py-1.5 rounded font-mono text-xs flex items-center justify-center gap-1 border ${
                  hornActive ? 'bg-amber-600/40 border-amber-400 text-amber-200' : 'bg-slate-900 border-slate-700 text-slate-300'
                }`}
              >
                <Volume2 className="w-3.5 h-3.5" /> Signal
              </button>
              <button
                type="button"
                onClick={toggleLight}
                className={`py-1.5 rounded font-mono text-xs flex items-center justify-center gap-1 border ${
                  lightActive ? 'bg-yellow-500/30 border-yellow-400 text-yellow-200' : 'bg-slate-900 border-slate-700 text-slate-300'
                }`}
              >
                <Lightbulb className="w-3.5 h-3.5" /> Fara
              </button>
            </div>
          </div>
        </div>

        {/* O'RTA: KATTA VR PANORAMA / FRONTAL / PTZ EKRANI */}
        <div className="flex-1 bg-black rounded-xl border border-cyan-500/30 overflow-hidden relative flex items-center justify-center min-h-[240px]">
          <canvas ref={previewCanvasRef} className="w-full h-full object-contain" />
        </div>

        {/* O'NG PANEL: PTZ KAMERA BOSHQARUVI */}
        <div className="lg:w-64 shrink-0 bg-[#0a1122] border border-slate-800 rounded-xl p-3 flex flex-col items-center justify-between gap-2">
          <div className="w-full flex items-center justify-between font-mono text-xs">
            <span className="font-bold text-amber-300 flex items-center gap-1.5">
              <Camera className="w-4 h-4" /> PTZ KAMERA
            </span>
            <span className="text-[10px] text-slate-400">
              {ptzVec.x.toFixed(1)},{ptzVec.y.toFixed(1)}
            </span>
          </div>

          {/* PTZ Analog Joystik */}
          <div
            ref={ptzPadRef}
            onPointerDown={(e) => {
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {}
              setPtzDragging(true);
              updatePtzPad(e);
            }}
            onPointerMove={(e) => {
              if (ptzDragging) updatePtzPad(e);
            }}
            onPointerUp={stopPtz}
            onPointerCancel={stopPtz}
            style={{ touchAction: 'none' }}
            className="relative w-40 h-40 rounded-full bg-slate-950 border-2 border-amber-500/50 shadow-inner flex items-center justify-center cursor-pointer"
          >
            <span className="absolute top-2 text-[10px] font-mono text-slate-500">TEPA</span>
            <span className="absolute bottom-2 text-[10px] font-mono text-slate-500">PAST</span>
            <span className="absolute left-2 text-[10px] font-mono text-slate-500">CHAP</span>
            <span className="absolute right-2 text-[10px] font-mono text-slate-500">O'NG</span>
            <div
              className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-400 to-orange-600 border-2 border-white/70 shadow-[0_0_20px_rgba(245,158,11,0.5)] pointer-events-none"
              style={{
                transform: `translate(${ptzVec.x * 52}px, ${-ptzVec.y * 52}px)`,
              }}
            />
          </div>

          {/* PTZ D-Pad (Quest Lazer Trigger uchun juda qulay!) */}
          <div className="grid grid-cols-3 gap-1.5 w-full">
            <div />
            <button
              type="button"
              onPointerDown={() => holdPtzVec(0, 0.7)}
              onPointerUp={stopPtz}
              onPointerLeave={stopPtz}
              className="h-10 rounded-lg bg-slate-800 hover:bg-amber-700 active:bg-amber-600 border border-slate-600 flex items-center justify-center"
            >
              <ArrowUp className="w-5 h-5" />
            </button>
            <div />
            <button
              type="button"
              onPointerDown={() => holdPtzVec(-0.7, 0)}
              onPointerUp={stopPtz}
              onPointerLeave={stopPtz}
              className="h-10 rounded-lg bg-slate-800 hover:bg-amber-700 active:bg-amber-600 border border-slate-600 flex items-center justify-center"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={stopPtz}
              className="h-10 rounded-lg bg-amber-700 hover:bg-amber-600 text-white font-mono font-bold text-[10px]"
            >
              STOP
            </button>
            <button
              type="button"
              onPointerDown={() => holdPtzVec(0.7, 0)}
              onPointerUp={stopPtz}
              onPointerLeave={stopPtz}
              className="h-10 rounded-lg bg-slate-800 hover:bg-amber-700 active:bg-amber-600 border border-slate-600 flex items-center justify-center"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
            <div />
            <button
              type="button"
              onPointerDown={() => holdPtzVec(0, -0.7)}
              onPointerUp={stopPtz}
              onPointerLeave={stopPtz}
              className="h-10 rounded-lg bg-slate-800 hover:bg-amber-700 active:bg-amber-600 border border-slate-600 flex items-center justify-center"
            >
              <ArrowDown className="w-5 h-5" />
            </button>
            <div />
          </div>

          {/* Quest 2 Kontroller Yo'riqnomasi */}
          <div className="w-full p-2 rounded-lg bg-slate-950/90 border border-slate-800 font-mono text-[10px] text-slate-400 space-y-0.5">
            <div className="text-cyan-300 font-bold mb-1">META QUEST 2 TUGMALARI:</div>
            <div>• Chap stik: Robotni haydash</div>
            <div>• O'ng stik: PTZ burish</div>
            <div>• [A]: Kamera • [B]: Bosh-PTZ</div>
            <div>• [X]: Tezlik • [O'ng Trig]: STOP</div>
          </div>
        </div>
      </div>
    </div>
  );
};
