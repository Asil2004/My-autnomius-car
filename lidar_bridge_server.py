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
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
    from fastapi.staticfiles import StaticFiles
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
except ImportError:
    print("[-] Xatolik: fastapi yoki uvicorn o'rnatilmagan! (pip install fastapi uvicorn)")
    sys.exit(1)

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

def auto_detect_lidar_port() -> str:
    """LDROBOT STL-19P CP210x portini avtomatik topish"""
    for p in list_ports.comports():
        desc = f"{p.description} {p.manufacturer or ''}".lower()
        if any(k in desc for k in ("cp210", "ch340", "ftdi", "silicon labs", "usb-serial", "lidar")):
            return p.device
    return "COM3"

# ---------------------------------------------------------------------------
# LiDAR Datchigi Oqimi va Ma'lumotlar Boshqaruvi
# ---------------------------------------------------------------------------
class LidarHardwareReader:
    def __init__(self, port: str = None, baudrate: int = 230400):
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
            try:
                print(f"[LiDAR] {self.port} portiga ulanilmoqda ({self.baudrate} baud)...")
                ser = serial.Serial(self.port, self.baudrate, timeout=0.1)
                self.is_connected = True
                print(f"[+] [OK] LDROBOT STL-19P LiDAR muvaffaqiyatli ulandi: {self.port}")

                buf = bytearray()
                acc = [0.0] * 360
                acc_i = [0] * 360
                last_start = None
                stamps = []

                while self.running:
                    data = ser.read(ser.in_waiting or 128)
                    if not data:
                        time.sleep(0.005)
                        continue
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
                self.is_connected = False
                print(f"[-] [LiDAR Xatosi] Port ulanishida uzilish: {e}. 2 soniyadan so'ng qayta uriniladi...")
                time.sleep(2.0)

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

        for deg in range(360):
            d = dists[deg]
            if d > 0.05:
                points.append({
                    "angle": deg,
                    "distance": round(d, 2),
                    "intensity": intens[deg]
                })
                if d < min_dist:
                    min_dist = d
                    min_angle = deg

                # 4-Zonalar
                if deg >= 330 or deg <= 30:
                    if d < min_front: min_front = d
                elif 60 <= deg <= 120:
                    if d < min_right: min_right = d
                elif 150 <= deg <= 210:
                    if d < min_rear: min_rear = d
                elif 240 <= deg <= 300:
                    if d < min_left: min_left = d

        front_cm = int(round(min_front * 100)) if min_front < 900 else 250
        is_front_blocked = front_cm <= 40

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

# Global Reader
lidar_reader = LidarHardwareReader()

# ---------------------------------------------------------------------------
# FastAPI & WebSocket Server
# ---------------------------------------------------------------------------
app = FastAPI(title="QALQON STL-19P LiDAR Server", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
        "packets": lidar_reader.packets_count
    }

# Statik veb fayllarni ulash (Frontend)
static_dir = os.path.dirname(os.path.abspath(__file__))
app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")

@app.get("/")
def serve_index():
    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return HTMLResponse("<h1>QALQON LiDAR Server Faol</h1>")

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 8000))
    print("\n" + "="*65)
    print("🛡️  QALQON — LDROBOT STL-19P 360° LIDAR SERVERI ISHGA TUSHMOQDA")
    print(f"📡  LiDAR Porti: {lidar_reader.port} @ 230400 baud")
    print(f"🌐  Veb Interfeys: http://localhost:{port}")
    print(f"🔌  WebSocket Telemetriya: ws://localhost:{port}/ws")
    print("="*65 + "\n")

    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
