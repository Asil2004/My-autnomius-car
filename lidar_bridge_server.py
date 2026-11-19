#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
QALQON — LDROBOT STL-19P (LD19) 360° LiDAR Apparat Serveri va WebSocket Ko'prigi
=============================================================================
Ushbu dastur kompyuterga ulangan haqiqiy LDROBOT STL-19P LiDAR sensorini
(COM3 / 230400 baud) o'qiydi va quyidagilarni ta'minlaydi:
  1. Haqiqiy 360° lazer skan nuqtalarini (4500 nuqta/sek, 10 Hz / 600 RPM) qabul qilish;
  2. WebSocket (/ws) va REST API (/api/lidar) orqali brauzer va frontendga uzatish;
  3. 4-zonali to'siq tahlili (Old, O'ng, Orqa, Chap) va avtotormoz nazorati;
  4. QALQON veb-interfeysini http://localhost:8000 da ishga tushirish.
=============================================================================
Ishga tushirish:
  python lidar_bridge_server.py
=============================================================================
"""

import os
import sys

# OpenCV C++ ogohlantirishlarini (WARN: cap_v4l) o'chirish
os.environ["OPENCV_LOG_LEVEL"] = "OFF"
os.environ["OPENCV_VIDEOIO_DEBUG"] = "0"

import time
import math
import glob
import json
import asyncio
import threading
from typing import List, Dict, Any, Optional

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    print("[-] Xatolik: pyserial o'rnatilmagan! (pip install pyserial)")
    sys.exit(1)

try:
    from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
    from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, Response, StreamingResponse
    from fastapi.staticfiles import StaticFiles
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
except ImportError:
    print("[-] Xatolik: fastapi yoki uvicorn o'rnatilmagan! (pip install fastapi uvicorn)")
    sys.exit(1)

try:
    import cv2
    HAS_CV2 = True
    try:
        if hasattr(cv2, "utils") and hasattr(cv2.utils, "logging"):
            cv2.utils.logging.setLogLevel(0)
    except Exception:
        pass
except Exception:
    cv2 = None
    HAS_CV2 = False

# ---------------------------------------------------------------------------
# LDROBOT STL-19P / LD19 Protokol Doimiylari
# ---------------------------------------------------------------------------
PKT_LEN = 47
HEADER, VERLEN = 0x54, 0x2C

def _make_crc_table(poly=0x4D):
    tbl = []
    for i in range(256):
        c = i
        for _ in range(8):
            c = ((c << 1) ^ poly) & 0xFF if c & 0x80 else (c << 1) & 0xFF
        tbl.append(c)
    return tbl

CRC_TABLE = _make_crc_table()

def crc8(data: bytes) -> int:
    c = 0
    for b in data:
        c = CRC_TABLE[(c ^ b) & 0xFF]
    return c

def parse_ld19_packet(pkt: bytes):
    if len(pkt) != PKT_LEN or pkt[0] != HEADER or pkt[1] != VERLEN:
        return None
    if crc8(pkt[:-1]) != pkt[-1]:
        return None
    speed = int.from_bytes(pkt[2:4], "little")
    start = int.from_bytes(pkt[4:6], "little") / 100.0
    end = int.from_bytes(pkt[42:44], "little") / 100.0
    diff = (end - start) % 360.0
    step = diff / 11.0
    pts = []
    for i in range(12):
        o = 6 + i * 3
        dist = int.from_bytes(pkt[o:o + 2], "little") / 1000.0
        inten = pkt[o + 2]
        pts.append(((start + step * i) % 360.0, dist, inten))
    return speed, pts

def get_candidate_lidar_ports() -> List[str]:
    """Barcha ehtimoliy LiDAR portlari ro'yxatini qaytaradi."""
    ports = []
    env_port = os.environ.get("LIDAR_PORT")
    if env_port:
        ports.append(env_port)

    # Udev qoidasi orqali /dev/lidar simvolik havolasi
    if os.path.exists("/dev/lidar"):
        ports.append("/dev/lidar")

    # Serial portlarni qidirish (CP210x, Silicon Labs, CH340)
    for p in list_ports.comports():
        text = f"{p.device} {p.description} {p.manufacturer or ''}".lower()
        if any(k in text for k in ("cp210", "ch340", "ftdi", "silicon labs", "usb-serial", "lidar")):
            if p.device not in ports:
                ports.append(p.device)

    # Linux / Raspberry Pi standart yo'llari
    if os.name != 'nt':
        for dev in ("/dev/ttyUSB0", "/dev/ttyUSB1", "/dev/ttyACM0", "/dev/ttyACM1"):
            if os.path.exists(dev) and dev not in ports:
                ports.append(dev)

    if not ports:
        ports.append("COM3" if os.name == 'nt' else "/dev/ttyUSB0")
    return ports

def auto_detect_lidar_port() -> str:
    """LDROBOT STL-19P CP210x portini avtomatik topish (Windows va Linux/Raspberry Pi)"""
    ports = get_candidate_lidar_ports()
    return ports[0] if ports else ("/dev/ttyUSB0" if os.name != 'nt' else "COM3")

# ---------------------------------------------------------------------------
# LiDAR Datchigi Oqimi va Ma'lumotlar Boshqaruvi
# ---------------------------------------------------------------------------
class LidarHardwareReader:
    def __init__(self, port: str = None, baudrate: int = 230400):
        self.specified_port = port
        self.port = port or auto_detect_lidar_port()
        self.baudrate = baudrate
        self.running = True
        self.is_connected = False
        
        self.scan_distances = [0.0] * 360
        self.scan_intensities = [0] * 360
        self.rate_hz = 0.0
        self.rpm = 0
        self.packets_count = 0
        self.crc_errors = 0
        self.last_scan_time = 0.0
        self.lock = threading.Lock()

        # Oqimni ishga tushirish
        threading.Thread(target=self._serial_loop, daemon=True).start()

    def _serial_loop(self):
        while self.running:
            candidate_ports = [self.specified_port] if self.specified_port else get_candidate_lidar_ports()
            connected_ser = None
            active_port = None

            for p in candidate_ports:
                try:
                    ser = serial.Serial(p, self.baudrate, timeout=0.5)
                    # Port haqiqatdan ham STL-19P (0x54 0x2C) paketini yuborayotganini tekshirish
                    t_probe = time.time()
                    probe_buf = bytearray()
                    is_stl19 = False
                    while time.time() - t_probe < 1.0:
                        chunk = ser.read(ser.in_waiting or 64)
                        if chunk:
                            probe_buf.extend(chunk)
                            if b"\x54\x2c" in probe_buf:
                                is_stl19 = True
                                break
                        time.sleep(0.01)

                    if is_stl19:
                        connected_ser = ser
                        active_port = p
                        self.port = p
                        self.is_connected = True
                        print(f"[+] [OK] LDROBOT STL-19P LiDAR muvaffaqiyatli ulandi: {p} ({self.baudrate} baud)")
                        break
                    else:
                        ser.close()
                except Exception:
                    continue

            if not connected_ser:
                self.is_connected = False
                time.sleep(2.0)
                continue

            ser = connected_ser
            try:
                buf = bytearray()
                acc = [0.0] * 360
                acc_i = [0] * 360
                last_start = None
                stamps = []
                last_data_time = time.time()

                while self.running:
                    data = ser.read(ser.in_waiting or 128)
                    if not data:
                        # 2 soniya davomida umuman ma'lumot kelmasa (datchik uzilgan)
                        if time.time() - last_data_time > 2.0:
                            print(f"[-] [LiDAR] {active_port} dan ma'lumot oqimi to'xtadi.")
                            break
                        time.sleep(0.005)
                        continue

                    last_data_time = time.time()
                    buf.extend(data)

                    while len(buf) >= PKT_LEN:
                        i = 0
                        while i + 1 < len(buf) and not (buf[i] == HEADER and buf[i + 1] == VERLEN):
                            i += 1
                        if i > 0:
                            del buf[:i]
                        if len(buf) < PKT_LEN:
                            break

                        pkt = bytes(buf[:PKT_LEN])
                        del buf[:PKT_LEN]

                        res = parse_ld19_packet(pkt)
                        if res is None:
                            self.crc_errors += 1
                            continue

                        speed_raw, pts = res
                        self.packets_count += 1

                        for a, d, inten in pts:
                            deg = int(round(a)) % 360
                            acc[deg] = d if 0.05 < d < 12.0 else 0.0
                            acc_i[deg] = inten

                        cur_start = pts[0][0]
                        if last_start is not None and cur_start < last_start:
                            # 360 daraja to'liq aylanish tugadi
                            now = time.time()
                            stamps.append(now)
                            if len(stamps) > 10:
                                stamps.pop(0)
                            if len(stamps) >= 2:
                                self.rate_hz = round((len(stamps) - 1) / (stamps[-1] - stamps[0]), 1)
                                self.rpm = int(self.rate_hz * 60)

                            with self.lock:
                                self.scan_distances = list(acc)
                                self.scan_intensities = list(acc_i)
                                self.last_scan_time = now

                            acc = [0.0] * 360
                            acc_i = [0] * 360
                        last_start = cur_start

            except Exception as e:
                print(f"[-] [LiDAR Xatosi] Port ulanishida uzilish ({active_port}): {e}")
            finally:
                self.is_connected = False
                try:
                    ser.close()
                except Exception:
                    pass
                time.sleep(1.0)

    def get_telemetry_payload(self) -> Dict[str, Any]:
        with self.lock:
            dists = list(self.scan_distances)
            intens = list(self.scan_intensities)
            rate_hz = self.rate_hz
            rpm = self.rpm

        points = []
        min_dist = 999.0
        min_angle = 0

        min_front = 999.0
        min_right = 999.0
        min_rear = 999.0
        min_left = 999.0

        # 4-Zonalar va to'siqlarni aniqlash
        # DIQQAT: 0.18m (18 sm) dan kichik nuqtalar robotning o'z korpusi/kamerasi/simlari hisoblanadi (Blind Zone)
        for deg in range(360):
            d = dists[deg]
            if d >= 0.18:
                points.append({
                    "angle": deg,
                    "distance": round(d, 2),
                    "intensity": intens[deg]
                })
                if d < min_dist:
                    min_dist = d
                    min_angle = deg

                # 4-Zonalar (Old, O'ng, Orqa, Chap)
                if deg >= 335 or deg <= 25:
                    if d < min_front: min_front = d
                elif 60 <= deg <= 120:
                    if d < min_right: min_right = d
                elif 150 <= deg <= 210:
                    if d < min_rear: min_rear = d
                elif 240 <= deg <= 300:
                    if d < min_left: min_left = d

        front_cm = int(round(min_front * 100)) if min_front < 900 else 250
        # Avtotormoz chegarasi: 35 sm (oldin 50 edi, robot o'z qismlarini to'siq deb o'ylamasligi uchun)
        is_front_blocked = front_cm <= 35

        return {
            "source": "LIDAR",
            "model": "LDROBOT STL-19P",
            "is_connected": self.is_connected,
            "port": self.port,
            "rate_hz": rate_hz or 10.0,
            "rpm": rpm or 600,
            "packets_count": self.packets_count,
            "crc_errors": self.crc_errors,
            "lidar": {
                "points": points,
                "total_points": len(points),
                "closest_obstacle": {
                    "distance": round(min_dist, 2) if min_dist < 900 else None,
                    "angle": min_angle if min_dist < 900 else None
                },
                "zones": {
                    "front": round(min_front, 2) if min_front < 900 else 5.0,
                    "right": round(min_right, 2) if min_right < 900 else 5.0,
                    "rear": round(min_rear, 2) if min_rear < 900 else 5.0,
                    "left": round(min_left, 2) if min_left < 900 else 5.0,
                }
            },
            "sonars": {
                "front": front_cm,
                "right": int(round(min_right * 100)) if min_right < 900 else 200,
                "rear": int(round(min_rear * 100)) if min_rear < 900 else 200,
                "left": int(round(min_left * 100)) if min_left < 900 else 200
            },
            "is_front_blocked": is_front_blocked
        }

# ---------------------------------------------------------------------------
# Ixtiyoriy MQTT Bulut Ko'prigi (HTTPS veb-saytdan Mixed Content siz ulanish uchun)
# ---------------------------------------------------------------------------
class MqttLidarBridge:
    def __init__(self, reader: LidarHardwareReader):
        self.reader = reader
        self.running = True
        self.topic = os.environ.get("QALQON_LIDAR_MQTT_TOPIC", "qalqon/robot/lidar")
        if os.environ.get("ENABLE_LIDAR_MQTT", "1") == "1":
            threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        try:
            import paho.mqtt.client as mqtt
        except ImportError:
            return
        client = mqtt.Client()
        connected = False
        while self.running:
            try:
                if not connected:
                    client.connect("broker.hivemq.com", 1883, 60)
                    client.loop_start()
                    connected = True
                    print(f"[MQTT] LiDAR bulut ko'prigi faol -> {self.topic}")
                if self.reader.is_connected:
                    payload = self.reader.get_telemetry_payload()
                    # Har 2-graduslik ixcham nuqtalar (paket hajmini kamaytirish uchun)
                    pts = payload["lidar"]["points"]
                    compact_pts = [p for p in pts if p["angle"] % 2 == 0]
                    msg = json.dumps({
                        "rate_hz": payload["rate_hz"],
                        "rpm": payload["rpm"],
                        "packets_count": payload["packets_count"],
                        "crc_errors": payload["crc_errors"],
                        "lidar": {"points": compact_pts}
                    })
                    client.publish(self.topic, msg)
            except Exception:
                connected = False
            time.sleep(0.15)

# ---------------------------------------------------------------------------
# Raspberry Pi USB Web-Kamera (Frontal / Face ID / Taktil Yo'lak) Oqimi
# ---------------------------------------------------------------------------
class PiWebcamReader:
    """
    Raspberry Pi 5 (yoki PC) ga ulangan USB web-kamerani fon oqimida o'qiydi va
    brauzer HUD (Frontal kamera) uchun MJPEG (/api/webcam/stream) uzatadi.
    Pi 5 da ichki ISP/kodek qurilmalarini (pispbe, rp1-cfe, bcm2835) chetlab o'tib,
    haqiqiy USB UVC web-kamerani avtomatik topadi.
    """
    _SKIP_NAMES = ("pispbe", "rp1-cfe", "bcm2835", "hevc", "codec", "unicam", "isp")

    def __init__(self):
        self.running = True
        self.is_connected = False
        self.device_label: Optional[str] = None
        self.device_name: str = ""
        self.width: int = 0
        self.height: int = 0
        self.fps: float = 0.0
        self.last_frame_at: float = 0.0
        self.error: Optional[str] = None

        self._lock = threading.Lock()
        self._latest_jpeg: Optional[bytes] = None
        self._frame_seq: int = 0

        self.target_w = int(os.environ.get("WEBCAM_WIDTH", "640"))
        self.target_h = int(os.environ.get("WEBCAM_HEIGHT", "480"))
        self.target_fps = int(os.environ.get("WEBCAM_FPS", "16"))
        self.jpeg_quality = int(os.environ.get("WEBCAM_JPEG_QUALITY", "55"))
        self.flip_mode = os.environ.get("WEBCAM_FLIP", "").strip().lower()

        if os.environ.get("ENABLE_PI_WEBCAM", "1") != "1":
            self.error = "ENABLE_PI_WEBCAM=0 (o'chirilgan)"
            return
        if not HAS_CV2:
            self.error = "OpenCV (opencv-python-headless) o'rnatilmagan"
            print("[WEBCAM] Ogohlantirish: opencv-python-headless topilmadi — USB web-kamera oqimi o'chiq.")
            return

        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def _candidate_devices(self) -> List[tuple]:
        """(device_id_or_path, human_name) ro'yxatini tartib bilan qaytaradi."""
        candidates: List[tuple] = []
        seen = set()

        def add(dev, name=""):
            key = str(dev)
            if key not in seen:
                seen.add(key)
                candidates.append((dev, name or key))

        env_dev = os.environ.get("WEBCAM_DEVICE", "").strip()
        if env_dev:
            add(int(env_dev) if env_dev.isdigit() else env_dev, f"env:{env_dev}")

        # Linux / Raspberry Pi 5: /sys/class/video4linux orqali haqiqiy USB web-kamerani tanlash
        if sys.platform.startswith("linux") and os.path.isdir("/sys/class/video4linux"):
            v4l_entries = []
            for path in glob.glob("/sys/class/video4linux/video*"):
                base = os.path.basename(path)
                num_str = base.replace("video", "")
                if not num_str.isdigit():
                    continue
                idx = int(num_str)
                # Faqat haqiqiy /dev/video* mavjud bo'lsa
                if not os.path.exists(f"/dev/video{idx}"):
                    continue
                name = ""
                try:
                    with open(os.path.join(path, "name"), "r", encoding="utf-8", errors="ignore") as f:
                        name = f.read().strip()
                except Exception:
                    pass
                v4l_entries.append((idx, name))
            v4l_entries.sort(key=lambda item: item[0])
            for idx, name in v4l_entries:
                low = name.lower()
                if any(skip in low for skip in self._SKIP_NAMES):
                    continue
                add(idx, name or f"/dev/video{idx}")

        if not sys.platform.startswith("linux"):
            for idx in (0, 1, 2):
                add(idx, f"Kamera {idx}")

        return candidates

    def _open_camera(self):
        for dev, name in self._candidate_devices():
            cap = None
            try:
                if sys.platform.startswith("linux") and isinstance(dev, int):
                    cap = cv2.VideoCapture(dev, cv2.CAP_V4L2)
                    if not cap.isOpened():
                        cap.release()
                        cap = cv2.VideoCapture(dev)
                else:
                    cap = cv2.VideoCapture(dev)

                if not cap.isOpened():
                    if cap:
                        cap.release()
                    continue

                # USB kamerada MJPG formati Pi 5 CPU va USB yukini keskin kamaytiradi
                try:
                    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
                except Exception:
                    pass
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.target_w)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.target_h)
                cap.set(cv2.CAP_PROP_FPS, self.target_fps)
                try:
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                except Exception:
                    pass

                ok = False
                frame = None
                for _ in range(5):
                    ok, frame = cap.read()
                    if ok and frame is not None and frame.size > 0:
                        break
                    time.sleep(0.05)

                if ok and frame is not None and frame.size > 0:
                    dev_str = f"/dev/video{dev}" if (sys.platform.startswith("linux") and isinstance(dev, int)) else str(dev)
                    self.device_label = dev_str
                    self.device_name = name
                    self.height, self.width = frame.shape[:2]
                    print(f"[WEBCAM] USB web-kamera ulandi: {dev_str} ({name}) {self.width}x{self.height}")
                    return cap
                cap.release()
            except Exception:
                if cap:
                    try:
                        cap.release()
                    except Exception:
                        pass
        return None

    def _loop(self):
        encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality]
        min_interval = 1.0 / max(1, self.target_fps)

        while self.running:
            cap = self._open_camera()
            if cap is None:
                self.is_connected = False
                self.error = "USB web-kamera topilmadi"
                time.sleep(3.0)
                continue

            self.is_connected = True
            self.error = None
            fail_count = 0
            fps_frames = 0
            fps_t0 = time.time()

            try:
                while self.running:
                    t0 = time.time()
                    ok, frame = cap.read()
                    if not ok or frame is None or frame.size == 0:
                        fail_count += 1
                        if fail_count >= 15:
                            self.error = "USB web-kamera oqimi uzildi"
                            break
                        time.sleep(0.05)
                        continue

                    fail_count = 0
                    if self.flip_mode == "180":
                        frame = cv2.rotate(frame, cv2.ROTATE_180)
                    elif self.flip_mode == "h":
                        frame = cv2.flip(frame, 1)
                    elif self.flip_mode == "v":
                        frame = cv2.flip(frame, 0)

                    enc_ok, buf = cv2.imencode(".jpg", frame, encode_params)
                    if enc_ok:
                        jpg_bytes = buf.tobytes()
                        now = time.time()
                        with self._lock:
                            self._latest_jpeg = jpg_bytes
                            self._frame_seq += 1
                            self.height, self.width = frame.shape[:2]
                            self.last_frame_at = now

                        fps_frames += 1
                        if now - fps_t0 >= 1.5:
                            self.fps = round(fps_frames / (now - fps_t0), 1)
                            fps_frames = 0
                            fps_t0 = now

                    elapsed = time.time() - t0
                    if elapsed < min_interval:
                        time.sleep(min_interval - elapsed)
            except Exception as e:
                self.error = str(e)
            finally:
                self.is_connected = False
                try:
                    cap.release()
                except Exception:
                    pass
                time.sleep(1.5)

    def get_frame(self):
        with self._lock:
            return self._latest_jpeg, self._frame_seq

    def get_status(self) -> Dict[str, Any]:
        age = round(time.time() - self.last_frame_at, 2) if self.last_frame_at > 0 else None
        return {
            "available": HAS_CV2,
            "connected": self.is_connected and self._latest_jpeg is not None,
            "device": self.device_label,
            "name": self.device_name,
            "width": self.width,
            "height": self.height,
            "fps": self.fps,
            "last_frame_age": age,
            "error": self.error,
        }


# Global Reader, MQTT Bridge & USB Webcam Reader
lidar_reader = LidarHardwareReader()
mqtt_lidar_bridge = MqttLidarBridge(lidar_reader)
webcam_reader = PiWebcamReader()

# ---------------------------------------------------------------------------
# FastAPI & WebSocket Server
# ---------------------------------------------------------------------------
app = FastAPI(title="QALQON STL-19P LiDAR & USB Kamera Server", version="2.2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def private_network_access(request: Request, call_next):
    """Chrome: https sahifadan (GitHub Pages) lokal Raspberry Pi ga so'rov uchun ruxsat."""
    response = await call_next(request)
    if request.headers.get("access-control-request-private-network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


connected_clients: List[WebSocket] = []

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.append(websocket)
    print(f"[WebSocket] Yangi mijoz ulandi. Jami faol: {len(connected_clients)}")
    try:
        while True:
            # Har 100 ms (10 Hz) da to'liq LiDAR telemetriyasini uzatish
            payload = lidar_reader.get_telemetry_payload()
            await websocket.send_text(json.dumps(payload))
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        if websocket in connected_clients:
            connected_clients.remove(websocket)
        print(f"[WebSocket] Mijoz uzildi. Qolganlar: {len(connected_clients)}")
    except Exception:
        if websocket in connected_clients:
            connected_clients.remove(websocket)

@app.get("/api/lidar")
def get_lidar_telemetry():
    return lidar_reader.get_telemetry_payload()

@app.get("/api/status")
def get_status():
    return {
        "status": "ONLINE" if lidar_reader.is_connected else "DISCONNECTED",
        "model": "LDROBOT STL-19P",
        "port": lidar_reader.port,
        "rate_hz": lidar_reader.rate_hz,
        "packets": lidar_reader.packets_count,
        "webcam": webcam_reader.get_status(),
    }


@app.get("/api/webcam/status")
def get_webcam_status():
    return JSONResponse(
        content=webcam_reader.get_status(),
        headers={"Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"},
    )


@app.get("/api/webcam/snapshot")
def get_webcam_snapshot():
    jpg, _ = webcam_reader.get_frame()
    if not jpg:
        return JSONResponse(status_code=503, content={"error": webcam_reader.error or "Kadr hali tayyor emas"})
    return Response(
        content=jpg,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"},
    )


@app.get("/api/webcam/stream")
async def get_webcam_stream():
    async def frame_generator():
        last_seq = -1
        while True:
            jpg, seq = webcam_reader.get_frame()
            if jpg and seq != last_seq:
                last_seq = seq
                header = (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    + f"Content-Length: {len(jpg)}\r\n\r\n".encode("ascii")
                )
                yield header + jpg + b"\r\n"
            await asyncio.sleep(0.03)

    return StreamingResponse(
        frame_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Access-Control-Allow-Origin": "*",
        },
    )


# Statik veb fayllarni ulash (Frontend + AI modellar + Yuzlar bazasi + Audio)
static_dir = os.path.dirname(os.path.abspath(__file__))
for folder in ("assets", "images", "models", "faces", "audio"):
    folder_path = os.path.join(static_dir, folder)
    if os.path.isdir(folder_path):
        app.mount(f"/{folder}", StaticFiles(directory=folder_path), name=folder)

@app.get("/")
def serve_index():
    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return HTMLResponse("<h1>QALQON LiDAR & Kamera Serveri Faol</h1>")

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 8000))
    print("\n" + "="*65)
    print("🛡️  QALQON — STL-19P LIDAR + USB FRONTAL KAMERA SERVERI")
    print(f"📡  LiDAR Porti: {lidar_reader.port} @ 230400 baud")
    print(f"📷  USB Frontal Kamera: http://localhost:{port}/api/webcam/stream")
    print(f"🌐  Veb Interfeys: http://localhost:{port}/#hud")
    print(f"🔌  WebSocket Telemetriya: ws://localhost:{port}/ws")
    print("="*65 + "\n")

    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
