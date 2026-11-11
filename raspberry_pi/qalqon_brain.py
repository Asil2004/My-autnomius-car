#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
🛡️ QALQON v1.0 — Raspberry Pi 4 Avtonom Patrul Roboti "Miya" (Brain Core)
Muallif: Qalqon AMR Jamoasi
Platforma: Raspberry Pi 4 (Linux) / Kompyuter / Smartfon sinovlari

Xususiyatlar:
  1. Qo'lda boshqaruv (Mecanum/Skid-steer 9 yo'nalish + tezlik 1-3)
  2. To'siqqa reaktsiya va Favqulodda Tormoz (Obstacle Interlock & Emergency Brake)
     - Oldinda to'siq bo'lsa (< 0.45m), oldinga harakat (F) qat'iy bloklanadi
     - Robot darhol tormozlaydi (S)
     - Orqaga (B), Chapga (L), O'ngga (R), Strafe (Q, E) chekinish yo'llari ochiq qoladi
  3. 360° LiDAR datchigi (STL-19P / LD19 / RPLiDAR) + Aqliy Simulyator
  4. Web-Kamera jonli MJPEG oqimi
  5. Dual-Port Web Server (8000 va 8080 portlarda parallel tinglaydi)
=============================================================================
"""

import os
import sys
import time
import json
import socket
import asyncio
import threading
from typing import Optional

# UTF-8 chiqishni ta'minlash (Windows cp1251 xatolarini oldini olish)
try:
    if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Response, Request
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

# Mahalliy modullar
from lidar_module import LidarModule
from camera_module import CameraModule, MultiCameraManager
from arduino_bridge import ArduinoBridge
from watchdog_daemon import QalqonWatchdogDaemon
from remote_control import RemoteControl

START_TIME = time.time()

print("\n" + "="*65)
print("🛡️  QALQON v1.0 AMR — MIYA TIZIMI ISHGA TUSHMOQDA (Raspberry Pi 4)")
print("="*65)

lidar = LidarModule()
camera = MultiCameraManager()
arduino = ArduinoBridge()
watchdog = QalqonWatchdogDaemon(arduino_bridge=arduino, failsafe_timeout_sec=0.65)
# Masofaviy admin boshqaruvi (internet/Cloudflare Tunnel orqali). Token: QALQON_ADMIN_TOKEN muhit o'zgaruvchisi
remote = RemoteControl(arduino=arduino, watchdog=watchdog)

# Boshqaruv rejimi: faqat qo'lda boshqaruv va xavfsizlik nazorati
patrol_mode = "MANUAL"
strobe_active = False
siren_active = False
obstacle_override_distance: Optional[float] = None

app = FastAPI(title="Qalqon Brain API", version="1.0")

# Masofaviy himoya CORS dan OLDIN o'rnatiladi (CORS eng tashqi qatlam bo'lib, xato javoblariga ham sarlavha qo'shadi)
remote.install(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_all_local_ips():
    """Tizimdagi barcha faol IPv4 manzillarni aniqlash"""
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        primary_ip = s.getsockname()[0]
        s.close()
        ips.append(primary_ip)
    except Exception:
        pass
    
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None):
            ip = info[4][0]
            if ':' not in ip and not ip.startswith('127.') and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    
    return ips if ips else ["127.0.0.1"]

LOCAL_IPS = get_all_local_ips()
PRIMARY_IP = LOCAL_IPS[0] if LOCAL_IPS else "127.0.0.1"

# --------------------------------------------------------------------------
# To'siqqa Reaksiya va Xavfsizlik Nazorati (Safety Supervisor Loop)
# --------------------------------------------------------------------------
def safety_supervisor_loop():
    """
    To'siq nazorati:
    1. LiDAR va Sonar datchiklaridan old masofani doimiy o'lchaydi.
    2. Agar to'siq < 0.45m bo'lsa:
       - Agar robot 'F' (oldinga) ketayotgan bo'lsa, avtomatik 'S' (tormoz) beradi.
       - 'F' buyrug'ini qulflaydi.
       - Lekin orqaga (B), chapga (L), o'ngga (R), strafe (Q, E) yo'llari ochiq turadi.
    """
    global patrol_mode
    while True:
        front_blocked = lidar.is_front_blocked(safe_distance=0.45)
        
        if arduino.is_hardware:
            sonar_front = arduino.get_sonars().get("front", 99)
            is_hazard = front_blocked or (sonar_front <= 25) or arduino.obstacle_warning
        else:
            is_hazard = front_blocked or (obstacle_override_distance is not None and obstacle_override_distance <= 0.45)
            arduino.set_sim_obstacle(is_hazard)

        # Agar oldinga ketayotgan paytda to'siq chiqsa -> Favqulodda tormoz!
        if is_hazard and arduino.last_cmd == 'F':
            arduino.send_command('S')
            sonar_val = arduino.get_sonars().get("front", 18)
            arduino._add_log(f"🚨 TAZYIQ: Oldinda to'siq ({sonar_val} sm)! Avto-tormoz ishga tushdi.")
            print(f"[Xavfsizlik Nazorati] 🚨 To'siq aniqlandi ({sonar_val} sm)! Oldinga harakat to'xtatildi.")

        time.sleep(0.05)

threading.Thread(target=safety_supervisor_loop, daemon=True).start()

# MJPEG Generator
def mjpeg_frame_generator():
    while True:
        jpeg = camera.get_jpeg()
        if jpeg:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + jpeg + b'\r\n')
        time.sleep(0.04)

# --------------------------------------------------------------------------
# API Yo'llari (Endpoints)
# --------------------------------------------------------------------------

@app.get("/api/cameras")
def get_cameras_list():
    """Tizimdagi barcha faol web kameralar ro'yxati va holati"""
    return camera.get_cameras_list()

@app.get("/api/camera/select")
@app.post("/api/camera/select")
def select_active_camera(source: int):
    """Asosiy video oqim kamerasini almashtirish (0: Oldi, 1: Gumbaz / 360)"""
    ok = camera.select_camera(source)
    return {"status": "ok" if ok else "error", "active_source": camera.active_source}

@app.get("/api/camera/auto_discover")
@app.post("/api/camera/auto_discover")
def auto_discover_camera(password: str = ""):
    """Wi-Fi tarmog'idagi CP-159-1-WIFI (V380 Pro / iCSee) kamerasini avtomatik qidirish va ulash"""
    res = camera.auto_discover_wifi_camera(password=password)
    return res

@app.get("/video_feed/quad")
@app.get("/stream.mjpg/quad")
def video_feed_quad():
    """4 ta kameraning (Oldi, Orqa, Chap, O'ng) 2x2 birlashgan multi-kamera oqimi"""
    def generate():
        while True:
            jpeg = camera.get_quad_jpeg()
            if jpeg:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + jpeg + b'\r\n')
            time.sleep(0.05)
    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")


@app.get("/video_feed/{cam_id}")
@app.get("/stream.mjpg/{cam_id}")
def video_feed_by_id(cam_id: int):
    """Muayyan kamera uchun jonli MJPEG oqimi (/video_feed/0, /video_feed/1)"""
    def generate():
        while True:
            jpeg = camera.get_jpeg_by_source(cam_id)
            if jpeg:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + jpeg + b'\r\n')
            time.sleep(0.04)
    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")

@app.get("/api/hardware/test")
def test_all_hardware():
    """Barcha kameralar, LiDAR va Arduino UART aloqalarini to'liq test qilish"""
    return {
        "status": "ok",
        "cameras": camera.get_cameras_list(),
        "lidar": lidar.test_uart(),
        "arduino": arduino.test_uart(),
        "watchdog": watchdog.get_status()
    }

@app.get("/api/lidar/test_uart")
def test_lidar_uart_endpoint():
    """LiDAR UART (230400 bod) diagnostikasi"""
    return lidar.test_uart()

@app.get("/api/arduino/test_uart")
def test_arduino_uart_endpoint():
    """Arduino Uno UART (115200 bod) diagnostikasi"""
    return arduino.test_uart()

@app.get("/stream.mjpg")
@app.get("/video_feed")
def video_feed():
    """Jonli kamera oqimi"""
    return StreamingResponse(
        mjpeg_frame_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@app.get("/cmd")
def handle_command(request: Request, c: Optional[str] = None, speed: Optional[int] = None):
    """
    Boshqaruv buyruqlari ('F', 'B', 'L', 'R', 'Q', 'E', 'S', speed=1..3)
    Agar to'siq bo'lsa, 'F' buyrug'i qabul qilinmaydi va bloklanadi!
    src: "local" (robotdagi monitor, LAN) yoki "admin" (internet orqali, token bilan)
    """
    src = getattr(request.state, "src", "local")

    if speed is not None:
        speed = remote.cap_speed(src, speed)
        arduino.set_speed(speed)
        return {"status": "ok", "speed": speed}

    if c:
        cmd_char = c.upper().strip()
        verdict = remote.pre_command(src, cmd_char)
        if verdict:
            return JSONResponse(verdict[1], status_code=verdict[0])
        sonars = arduino.get_sonars()
        lidar_sectors = lidar.get_sectors()
        is_blocked = (lidar_sectors["front"] <= 0.45) or (sonars["front"] <= 25) or arduino.obstacle_warning

        if cmd_char in ('F', 'G', 'I') and is_blocked:
            arduino._add_log(f"⚠️ '{cmd_char}' (Oldinga harakat) rad etildi: to'siq {sonars['front']} sm!")
            return {
                "status": "blocked",
                "cmd": cmd_char,
                "message": f"Oldinda to'siq bor ({sonars['front']} sm)! Faqat orqaga yoki burilish mumkin."
            }

        watchdog.feed_heartbeat(f"CMD:{cmd_char}")
        ok = arduino.send_command(cmd_char)
        remote.post_command(src, cmd_char, ok)
        return {"status": "ok" if ok else "blocked", "cmd": cmd_char, "src": src}

    return {"status": "error", "message": "Buyruq berilmadi"}

@app.get("/api/obstacle")
def set_obstacle(dist: Optional[float] = None):
    """
    LiDAR va datchiklar uchun virtual to'siq o'rnatish / olib tashlash.
    Masalan: ?dist=0.35 (35 sm li to'siq) yoki bo'sh (to'siqni tozalash).
    """
    global obstacle_override_distance
    obstacle_override_distance = dist
    lidar.set_virtual_obstacle(dist)
    if dist is not None and dist <= 0.45:
        arduino.set_sim_obstacle(True)
        if arduino.last_cmd == 'F':
            arduino.send_command('S')
        arduino._add_log(f"⚠️ To'siq simulyatsiyasi: {dist} metr masofada o'rnatildi!")
    else:
        arduino.set_sim_obstacle(False)
        arduino._add_log("🟢 To'siq olib tashlandi. Yo'l ochiq.")
    return {"status": "ok", "obstacle_distance_m": dist}

@app.get("/strobe")
def toggle_strobe():
    """Politsiya stroboskopi holatini almashtirish"""
    global strobe_active
    strobe_active = not strobe_active
    arduino._add_log(f"Stroboskop: {'YOQILDI' if strobe_active else 'O`CHIRILDI'}")
    return {"status": "ok", "strobe": strobe_active}

@app.get("/siren")
def toggle_siren():
    """Politsiya sirenasi holatini almashtirish"""
    global siren_active
    siren_active = not siren_active
    arduino._add_log(f"Sirena: {'YOQILDI' if siren_active else 'O`CHIRILDI'}")
    return {"status": "ok", "siren": siren_active}

@app.get("/api/health")
def health_check():
    """Tizim holatini tekshirish (OTA avto-yangilanish va watchdog uchun)"""
    return {
        "status": "healthy",
        "service": "qalqon_brain",
        "uptime_sec": int(time.time() - START_TIME),
        "version": "1.0.0",
        "mode": patrol_mode
    }

@app.get("/api/dispatch_alert")
def dispatch_alert(reason: str = "Favqulodda xavf signali"):
    """Navoiy viloyati IIB navbatchilik qismiga tezkor kadr va signal uzatish (TT 2-bandi)"""
    alert = camera.dispatch_alert_to_iib(reason)
    arduino._add_log(f"🚨 NAVOIY IIB DISPETCHER: {reason}")
    return {
        "status": "ok",
        "message": "Signal Navoiy viloyati IIB navbatchilik qismiga yuborildi",
        "timestamp": alert["time_str"] if alert else time.strftime('%H:%M:%S'),
        "reason": reason,
        "persons_detected": len(camera.detected_persons)
    }

@app.get("/api/alert_snapshot")
def alert_snapshot():
    """Navoiy viloyati IIB uchun favqulodda kadr tasviri (JPEG)"""
    jpeg = camera.get_latest_alert_jpeg()
    if jpeg:
        return Response(content=jpeg, media_type="image/jpeg")
    return Response(content=b"", status_code=404)

@app.get("/api/slam_map")
@app.get("/api/occupancy_grid")
def get_slam_map():
    """LDROBOT STL-19P 2D Probabilistic Occupancy Grid (TT 3-bandi, Memorandum 2.1)"""
    return lidar.get_slam_grid(grid_size=60, resolution_m=0.1)

@app.get("/api/hazard_analysis")
def get_hazard_analysis():
    """LDROBOT STL-19P 360° to'siqlar va xavfli hududlarni avtonom monitoring tahlili (Memorandum 2.5)"""
    return lidar.get_hazard_analysis()

@app.get("/api/watchdog/status")
def get_watchdog_status():
    """Raspberry Pi 4 va Arduino Serial Watchdog telemetriyasi (Memorandum 2.4-bandi)"""
    return watchdog.get_status()


@app.post("/api/stt")
async def proxy_stt(request: Request):
    """UzbekVoice.ai STT (Speech-to-Text) Proksi Endpointi (CORS cheklovisiz)"""
    auth = request.headers.get("Authorization", "")
    content_type = request.headers.get("Content-Type", "")
    body = await request.body()
    
    import urllib.request, ssl
    req = urllib.request.Request(
        "https://uzbekvoice.ai/api/v1/stt",
        data=body,
        headers={
            "Authorization": auth,
            "Content-Type": content_type
        },
        method="POST"
    )
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            data = resp.read()
            return Response(content=data, status_code=resp.status, media_type="application/json")
    except Exception as e:
        return Response(content=json.dumps({"error": str(e)}), status_code=500, media_type="application/json")

@app.post("/api/failsafe/stop")
@app.get("/api/failsafe/stop")
def trigger_failsafe_stop(reason: str = "MANUAL_PANIC"):
    """Favqulodda to'xtash va harakatni qulflash"""
    watchdog.trigger_manual_emergency_stop(reason)
    return {"status": "TRIGGERED", "reason": reason}


@app.get("/api/status")
@app.get("/api/telemetry")
def get_telemetry():
    """To'liq telemetriya JSON (Web UI va mobil ilova uchun)"""
    sonars = arduino.get_sonars()
    battery = arduino.get_battery()
    lidar_sectors = lidar.get_sectors()
    lidar_pts = lidar.get_points_list(max_distance=6.0, step=4)
    cam_status = camera.get_status()
    ard_status = arduino.get_status()

    hazard = lidar.get_hazard_analysis()
    wd_status = watchdog.get_status()
    is_blocked = (lidar_sectors["front"] <= 0.45) or (sonars["front"] <= 25) or ard_status["obstacle_warning"] or hazard["emergency_stop_required"]

    return {
        "time": time.time(),
        "uptime_sec": int(time.time() - START_TIME),
        "mode": patrol_mode,
        "is_front_blocked": is_blocked,
        "hazard": hazard,
        "watchdog": wd_status,
        "strobe": strobe_active,
        "siren": siren_active,
        "motion": {
            "last_cmd": ard_status["last_cmd"],
            "speed_level": ard_status["speed_level"],
            "is_moving": ard_status["last_cmd"] not in ('S', 'STOP'),
            "obstacle_warning": is_blocked
        },
        "remote": remote.status(),
        "sonars": sonars,
        "battery": battery,
        "lidar": {
            "mode": lidar.status()["mode"],
            "rate_hz": lidar.status()["rate_hz"],
            "sectors": lidar_sectors,
            "points_count": len(lidar_pts),
            "points": lidar_pts
        },
        "vision": {
            "fps": cam_status["fps"],
            "persons_detected": cam_status["persons_detected"]
        },
        "logs": arduino.logs[-8:]
    }

active_websockets = set()

@app.websocket("/ws")
async def websocket_telemetry(ws: WebSocket):
    """Real-vaqtli telemetriya oqimi (10 Hz)"""
    # Masofaviy (tunnel orqali) ulanish uchun admin token talab qilinadi
    if not await remote.ws_gate(ws):
        return
    await ws.accept()
    active_websockets.add(ws)
    try:
        while True:
            watchdog.feed_heartbeat("WEBSOCKET")
            telem = get_telemetry()
            await ws.send_json(telem)
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        active_websockets.remove(ws)
    except Exception:
        if ws in active_websockets:
            active_websockets.remove(ws)


# --------------------------------------------------------------------------
# Mobil Cockpit HUD (HTML5 + CSS + JavaScript)
# --------------------------------------------------------------------------
COCKPIT_HTML = """<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>QALQON v1.0 — Mobil Taktik Cockpit</title>
  <style>
    :root {
      --bg: #070b13;
      --card: #0d1527;
      --border: #1e293b;
      --cyan: #00e5ff;
      --emerald: #00e676;
      --red: #ff1744;
      --amber: #ffc107;
      --text: #f8fafc;
      --dim: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-tap-highlight-color: transparent; }
    body {
      background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      padding: 8px; display: flex; flex-direction: column; align-items: center; min-height: 100vh;
    }
    .container { width: 100%; max-width: 960px; display: flex; flex-direction: column; gap: 8px; }

    /* Top Bar */
    .topbar {
      display: flex; justify-content: space-between; align-items: center; background: var(--card);
      border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px;
    }
    .brand { font-size: 1rem; font-weight: 800; color: var(--cyan); letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px; }
    .badge { font-size: 0.72rem; padding: 4px 8px; border-radius: 6px; font-weight: bold; background: rgba(0, 229, 255, 0.15); color: var(--cyan); border: 1px solid var(--cyan); }
    .badge.danger { background: rgba(255, 23, 68, 0.25); color: var(--red); border-color: var(--red); animation: pulse 0.7s infinite alternate; }
    .badge.ok { background: rgba(0, 230, 118, 0.15); color: var(--emerald); border-color: var(--emerald); }
    @keyframes pulse { from { opacity: 0.6; } to { opacity: 1; transform: scale(1.03); } }

    /* Alert Banner */
    .alert-banner {
      display: none; background: rgba(255, 23, 68, 0.2); border: 1.5px solid var(--red);
      color: #fff; padding: 8px 12px; border-radius: 8px; font-size: 0.82rem; font-weight: bold;
      text-align: center; letter-spacing: 0.5px;
    }
    .alert-banner.active { display: block; }

    /* Main Grid */
    .grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
    @media (min-width: 768px) { .grid { grid-template-columns: 1fr 1fr; } }

    .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
    .card-title { font-size: 0.8rem; font-weight: bold; color: var(--cyan); display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 4px; }

    /* Video Box */
    .video-box {
      width: 100%; aspect-ratio: 4/3; background: #000; border-radius: 8px; overflow: hidden; position: relative; border: 1px solid var(--border);
    }
    .video-box img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .video-overlay {
      position: absolute; bottom: 6px; left: 6px; right: 6px; display: flex; justify-content: space-between;
      background: rgba(0,0,0,0.7); padding: 4px 8px; border-radius: 6px; font-size: 0.72rem; font-family: monospace;
    }

    /* Radar Box */
    .radar-box { width: 100%; aspect-ratio: 1; max-height: 250px; background: #040711; border-radius: 8px; position: relative; display: flex; justify-content: center; align-items: center; border: 1px solid var(--border); }
    canvas#radarCanvas { width: 100%; height: 100%; }

    /* Sonar Indicators */
    .sonar-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
    .sonar-chip { background: #060b17; border: 1px solid var(--border); border-radius: 6px; padding: 5px; text-align: center; }
    .sonar-label { font-size: 0.62rem; color: var(--dim); }
    .sonar-val { font-size: 0.85rem; font-weight: bold; color: var(--emerald); font-family: monospace; }
    .sonar-val.danger { color: var(--red); animation: pulse 0.7s infinite alternate; }

    /* Obstacle Test Bar */
    .test-bar { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
    .btn-test {
      padding: 8px 4px; font-size: 0.72rem; font-weight: bold; border-radius: 6px; border: 1px solid var(--border);
      background: #141e33; color: var(--text); cursor: pointer; text-align: center;
    }
    .btn-test.active { background: #ff1744; color: #fff; border-color: #ff1744; }
    .btn-test.clear { background: #003322; color: var(--emerald); border-color: var(--emerald); }

    /* Direction Control Pad */
    .pad-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; max-width: 320px; margin: 0 auto; width: 100%; }
    .btn-key {
      background: #121c2f; color: var(--cyan); border: 1px solid #1f375b; border-radius: 10px;
      font-size: 1.25rem; font-weight: bold; aspect-ratio: 1.15; display: flex; flex-direction: column;
      align-items: center; justify-content: center; cursor: pointer; transition: 0.08s;
      touch-action: manipulation;
    }
    .btn-key:active { background: var(--cyan); color: #000; transform: scale(0.96); }
    .btn-key small { font-size: 0.62rem; color: var(--dim); margin-top: 2px; }
    .btn-key.stop { background: #55121b; border-color: var(--red); color: #fff; }
    .btn-key.stop:active { background: var(--red); color: #fff; }
    
    /* Forward button locked style */
    .btn-key.blocked {
      background: #3b1118 !important; border-color: #ff1744 !important; color: #ff6b81 !important;
      opacity: 0.6; cursor: not-allowed;
    }
    .btn-key.blocked:active { transform: none; background: #55121b !important; }

    /* Speed Bar */
    .speed-bar { display: flex; gap: 6px; width: 100%; }
    .btn-speed {
      flex: 1; padding: 7px; font-size: 0.78rem; font-weight: bold; border-radius: 6px; border: 1px solid var(--border);
      background: #141e33; color: var(--dim); cursor: pointer; text-align: center;
    }
    .btn-speed.active { background: var(--cyan); color: #000; border-color: var(--cyan); }

    /* Log Box */
    .log-box {
      background: #03050a; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px;
      font-size: 0.68rem; font-family: monospace; height: 75px; overflow-y: auto; display: flex; flex-direction: column-reverse;
    }
    .log-line { margin-bottom: 2px; color: var(--dim); }
    .log-line.warn { color: var(--red); font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Topbar -->
    <div class="topbar">
      <div class="brand">
        <span>🛡️ QALQON MIYA</span>
        <span id="badgeMode" class="badge">QO'LDA</span>
      </div>
      <div style="display:flex; gap:6px; align-items:center;">
        <span id="badgeBatt" class="badge ok">12.8V (90%)</span>
        <span id="badgeObstacle" class="badge ok">YO'L OCHIQ</span>
      </div>
    </div>

    <!-- Alarm Banner -->
    <div id="alertBanner" class="alert-banner">
      🚨 DIQQAT: OLDINDA TO'SIQ BOR! OLDINGA HARAKAT QULFLANDI. ORQAGA YOKI BURILISH MUMKIN.
    </div>

    <!-- Main Grid -->
    <div class="grid">
      <!-- Left: Camera & To'siq sinovlari -->
      <div class="card">
        <div class="card-title">
          <span>📹 KAMERA (JONLI OQIM)</span>
          <span id="fpsBadge" style="font-size:0.72rem; color:var(--cyan)">-- FPS</span>
        </div>

        <!-- Kamera linzalari va Wi-Fi Avto-Ulanish paneli -->
        <div style="display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap;">
          <button class="btn-test" style="flex:1;" onclick="switchCam(0)">Linz 1 (PTZ)</button>
          <button class="btn-test" style="flex:1;" onclick="switchCam(1)">Linz 2 (PTZ)</button>
          <button class="btn-test" style="flex:1;" onclick="switchCam(2)">Linz 3 (Gumbaz)</button>
          <button class="btn-test" style="flex:1.2; background:rgba(16,185,129,0.25); border-color:#10b981; color:#34d399;" onclick="autoDiscoverWifiCamera()" id="btnAutoDisc">🔍 Wi-Fi Avto-Ulanish</button>
        </div>

        <div class="video-box">
          <img id="streamImg" src="/stream.mjpg" alt="Video stream" />
          <div class="video-overlay">
            <span id="lastCmdBadge">BUYRUQ: TO'XTAGAN (S)</span>
            <span id="speedBadge">TEZLIK: 2</span>
          </div>
        </div>

        <!-- Sonar chip row -->
        <div class="sonar-grid">
          <div class="sonar-chip">
            <div class="sonar-label">OLD DATCHIK</div>
            <div id="sonarFront" class="sonar-val">-- sm</div>
          </div>
          <div class="sonar-chip">
            <div class="sonar-label">CHAP</div>
            <div id="sonarLeft" class="sonar-val">-- sm</div>
          </div>
          <div class="sonar-chip">
            <div class="sonar-label">O'NG</div>
            <div id="sonarRight" class="sonar-val">-- sm</div>
          </div>
          <div class="sonar-chip">
            <div class="sonar-label">ORQA</div>
            <div id="sonarRear" class="sonar-val">-- sm</div>
          </div>
        </div>

        <!-- To'siqqa Reaksiya Sinov Tugmalari -->
        <div style="font-size:0.72rem; color:var(--cyan); font-weight:bold; margin-top:2px;">
          🧪 TO'SIQQA REAKSIYA TEKSHIRISH (SIMULYATOR):
        </div>
        <div class="test-bar">
          <button id="btnObs35" class="btn-test" onclick="setVirtualObstacle(0.35)">⚠️ TO'SIQ (0.35m)</button>
          <button id="btnObs20" class="btn-test" onclick="setVirtualObstacle(0.20)">🚨 XAVF (0.20m)</button>
          <button id="btnObsClear" class="btn-test clear" onclick="setVirtualObstacle(null)">🟢 OCHISH (TOZA)</button>
        </div>
      </div>

      <!-- Right: 360° Radar & Direction Controls -->
      <div class="card">
        <div class="card-title">
          <span>📡 360° LIDAR RADAR</span>
          <span id="lidarModeBadge" style="font-size:0.72rem; color:var(--emerald)">SIMULYATOR (10 Hz)</span>
        </div>
        <div class="radar-box">
          <canvas id="radarCanvas" width="280" height="280"></canvas>
        </div>

        <!-- Speed row -->
        <div class="speed-bar">
          <button id="sp1" class="btn-speed" onclick="setSpeed(1)">1️⃣ SEKIN</button>
          <button id="sp2" class="btn-speed active" onclick="setSpeed(2)">2️⃣ O'RTA</button>
          <button id="sp3" class="btn-speed" onclick="setSpeed(3)">3️⃣ TEZ</button>
        </div>

        <!-- Mecanum & Direction Pad -->
        <div class="pad-grid">
          <button class="btn-key" onclick="sendCmd('Q')">↖️<small>STRAFE L</small></button>
          <button id="btnForward" class="btn-key" onclick="sendCmd('F')">⬆️<small>OLDINGA</small></button>
          <button class="btn-key" onclick="sendCmd('E')">↗️<small>STRAFE R</small></button>

          <button class="btn-key" onclick="sendCmd('L')">↺<small>CHAPGA</small></button>
          <button class="btn-key stop" onclick="sendCmd('S')">🛑<small>TO'XTA</small></button>
          <button class="btn-key" onclick="sendCmd('R')">↻<small>O'NGGA</small></button>

          <button class="btn-key" onclick="sendCmd('U')">🗼<small>MINORA ↑</small></button>
          <button class="btn-key" onclick="sendCmd('B')">⬇️<small>ORQAGA</small></button>
          <button class="btn-key" onclick="sendCmd('D')">🗼<small>MINORA ↓</small></button>
        </div>

        <!-- Logs -->
        <div id="logBox" class="log-box"></div>
      </div>
    </div>
  </div>

  <script>
    let ws;
    let sweepAngle = 0;
    let isBlocked = false;
    let audioCtx = null;

    // Web Audio orqali ogohlantirish ovozi (buzzer)
    function playBeep(freq = 600, duration = 0.15) {
      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
      } catch(e) {}
    }

    function sendCmd(c) {
      if (c === 'F' && isBlocked) {
        playBeep(350, 0.3);
        alertBannerPulse();
        return;
      }
      fetch('/cmd?c=' + c)
        .then(r => r.json())
        .then(res => {
          if (res.status === 'blocked') {
            playBeep(350, 0.3);
            alertBannerPulse();
          }
        })
        .catch(() => {});
    }

    function setSpeed(s) {
      fetch('/cmd?speed=' + s);
      [1, 2, 3].forEach(i => {
        const el = document.getElementById('sp' + i);
        if (el) el.className = (i === s) ? 'btn-speed active' : 'btn-speed';
      });
    }

    function setVirtualObstacle(dist) {
      const url = dist !== null ? ('/api/obstacle?dist=' + dist) : '/api/obstacle';
      fetch(url);
      
      const b35 = document.getElementById('btnObs35');
      const b20 = document.getElementById('btnObs20');
      const bCl = document.getElementById('btnObsClear');
      
      b35.className = (dist === 0.35) ? 'btn-test active' : 'btn-test';
      b20.className = (dist === 0.20) ? 'btn-test active' : 'btn-test';
      bCl.className = (dist === null) ? 'btn-test clear active' : 'btn-test clear';

      if (dist !== null) {
        playBeep(700, 0.2);
      }
    }

    function alertBannerPulse() {
      const b = document.getElementById('alertBanner');
      b.style.transform = 'scale(1.05)';
      setTimeout(() => { b.style.transform = 'scale(1)'; }, 150);
    }

    // Keyboard multi-key support (To'g'ri va burilish strelkalari bir vaqtda bosilganda differensial yoy)
    const activeKeys = new Set();
    function evaluateMovement() {
      const up = activeKeys.has('KeyW') || activeKeys.has('ArrowUp');
      const down = activeKeys.has('KeyS') || activeKeys.has('ArrowDown');
      const left = activeKeys.has('KeyA') || activeKeys.has('ArrowLeft');
      const right = activeKeys.has('KeyD') || activeKeys.has('ArrowRight');

      if (up && right) sendCmd('I');
      else if (up && left) sendCmd('G');
      else if (down && right) sendCmd('J');
      else if (down && left) sendCmd('H');
      else if (up) sendCmd('F');
      else if (down) sendCmd('B');
      else if (right) sendCmd('R');
      else if (left) sendCmd('L');
      else sendCmd('S');
    }

    window.addEventListener('keydown', (e) => {
      const moveKeys = ['KeyW', 'ArrowUp', 'KeyS', 'ArrowDown', 'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight'];
      if (moveKeys.includes(e.code)) {
        e.preventDefault();
        if (!activeKeys.has(e.code)) {
          activeKeys.add(e.code);
          evaluateMovement();
        }
      } else if (e.code === 'Space') {
        e.preventDefault();
        activeKeys.clear();
        sendCmd('S');
      } else if (e.code === 'Digit1') setSpeed(1);
      else if (e.code === 'Digit2') setSpeed(2);
      else if (e.code === 'Digit3') setSpeed(3);
    });

    window.addEventListener('keyup', (e) => {
      const moveKeys = ['KeyW', 'ArrowUp', 'KeyS', 'ArrowDown', 'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight'];
      if (moveKeys.includes(e.code)) {
        e.preventDefault();
        if (activeKeys.has(e.code)) {
          activeKeys.delete(e.code);
          evaluateMovement();
        }
      }
    });

    // 360 LiDAR Radar chizish
    function drawRadar(points) {
      const cv = document.getElementById('radarCanvas');
      if (!cv) return;
      const ctx = cv.getContext('2d');
      const cx = cv.width / 2, cy = cv.height / 2;
      const maxR = cx - 12;

      ctx.fillStyle = '#040711';
      ctx.fillRect(0, 0, cv.width, cv.height);

      // Masofa halqalari (1m, 2m, 3m, 4m, 5m)
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.15)';
      ctx.lineWidth = 1;
      [1, 2, 3, 4, 5].forEach(r => {
        const rad = (r / 5.0) * maxR;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.stroke();
      });

      // Old xavfli zonani belgilash (Front danger sector 60 gradus)
      ctx.fillStyle = isBlocked ? 'rgba(255, 23, 68, 0.18)' : 'rgba(0, 230, 118, 0.05)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, (0.45 / 5.0) * maxR * 3, -Math.PI * 0.7, -Math.PI * 0.3);
      ctx.closePath();
      ctx.fill();

      // Sweeping laser
      sweepAngle = (sweepAngle + 0.06) % (Math.PI * 2);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxR, sweepAngle - 0.35, sweepAngle);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 229, 255, 0.12)';
      ctx.fill();
      ctx.restore();

      // Markaz (Robot)
      ctx.fillStyle = isBlocked ? '#ff1744' : '#00e5ff';
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();

      // LiDAR nuqtalari
      if (!points || !points.length) return;
      points.forEach(pt => {
        const rad = ((pt.angle - 90) * Math.PI) / 180.0;
        const d = Math.min(pt.distance, 5.0) / 5.0;
        const px = cx + Math.cos(rad) * (d * maxR);
        const py = cy + Math.sin(rad) * (d * maxR);

        if (pt.distance <= 0.45) ctx.fillStyle = '#ff1744';
        else if (pt.distance <= 1.2) ctx.fillStyle = '#ffc107';
        else ctx.fillStyle = '#00e676';

        ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
      });
    }

    // Telemetriya WebSocket
    function connectWS() {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);

      ws.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data);
          updateUI(d);
        } catch(e) {}
      };

      ws.onclose = () => {
        setTimeout(connectWS, 1500);
      };
    }

    function updateUI(d) {
      isBlocked = d.is_front_blocked;

      // To'siq Banneri va Tugma blokirovkasi
      const banner = document.getElementById('alertBanner');
      const badgeObs = document.getElementById('badgeObstacle');
      const btnFwd = document.getElementById('btnForward');

      if (isBlocked) {
        banner.className = 'alert-banner active';
        badgeObs.className = 'badge danger';
        badgeObs.innerText = '🚨 TO`SIQ (BLOK)';
        btnFwd.className = 'btn-key blocked';
        btnFwd.innerHTML = '🔒<small>BLOKLANDI</small>';
      } else {
        banner.className = 'alert-banner';
        badgeObs.className = 'badge ok';
        badgeObs.innerText = 'YO`L OCHIQ';
        btnFwd.className = 'btn-key';
        btnFwd.innerHTML = '⬆️<small>OLDINGA</small>';
      }

      // Batareya
      document.getElementById('badgeBatt').innerText = `${d.battery.voltage}V (${d.battery.percentage}%)`;

      // Sonarlar
      const sf = document.getElementById('sonarFront');
      sf.innerText = `${d.sonars.front} sm`;
      sf.className = d.sonars.front <= 25 ? 'sonar-val danger' : 'sonar-val';

      document.getElementById('sonarLeft').innerText = `${d.sonars.left} sm`;
      document.getElementById('sonarRight').innerText = `${d.sonars.right} sm`;
      document.getElementById('sonarRear').innerText = `${d.sonars.rear} sm`;

      // Motion status
      document.getElementById('lastCmdBadge').innerText = `BUYRUQ: ${d.motion.last_cmd}`;
      document.getElementById('speedBadge').innerText = `TEZLIK: ${d.motion.speed_level}`;

      // Vision
      document.getElementById('fpsBadge').innerText = `${d.vision.fps} FPS`;

      // LiDAR Mode
      document.getElementById('lidarModeBadge').innerText = `${d.lidar.mode} (${d.lidar.rate_hz} Hz)`;

      // Radar
      drawRadar(d.lidar.points);

      // Jurnal
      if (d.logs && d.logs.length) {
        let html = '';
        d.logs.slice().reverse().forEach(l => {
          const isW = l.includes('🚨') || l.includes('⚠️') || l.includes('BLOK');
          html += `<div class="log-line ${isW ? 'warn':''}">${l}</div>`;
        });
        document.getElementById('logBox').innerHTML = html;
      }
    }

    function switchCam(sourceId) {
      fetch('/api/camera/select?source=' + sourceId, {method: 'POST'})
        .then(r => r.json())
        .then(d => {
          const img = document.getElementById('streamImg');
          img.src = '/stream.mjpg?t=' + Date.now();
        })
        .catch(e => console.error(e));
    }

    function autoDiscoverWifiCamera() {
      const btn = document.getElementById('btnAutoDisc');
      btn.innerText = "⏳ Qidirilmoqda...";
      btn.disabled = true;
      fetch('/api/camera/auto_discover', {method: 'POST'})
        .then(r => r.json())
        .then(d => {
          btn.disabled = false;
          if (d.status === 'ok') {
            btn.innerText = "✓ Ulandi (" + d.config.camera_ip + ")";
            const img = document.getElementById('streamImg');
            setTimeout(() => {
              img.src = '/stream.mjpg?t=' + Date.now();
            }, 1000);
          } else {
            btn.innerText = "🔍 Wi-Fi Avto-Ulanish";
            alert("Xatolik: " + (d.message || "Wi-Fi tarmoqda kamera topilmadi"));
          }
        })
        .catch(e => {
          btn.disabled = false;
          btn.innerText = "🔍 Wi-Fi Avto-Ulanish";
          alert("Tarmoq xatosi: " + e);
        });
    }

    connectWS();
  </script>
</body>
</html>
"""

@app.get("/", response_class=HTMLResponse)
def cockpit_ui():
    """Smartfon, planshet yoki kompyuter brauzerida to'liq taktik boshqaruv oynasi"""
    return HTMLResponse(content=COCKPIT_HTML)

@app.get("/face", response_class=HTMLResponse)
def tablet_face_ui():
    """Planshet yuzi (animated eyes va SOS chaqiruvi)"""
    face_path = os.path.join(os.path.dirname(__file__), "tablet_face_server.py")
    if os.path.exists(face_path):
        with open(face_path, "r", encoding="utf-8", errors="ignore") as f:
            code = f.read()
            if 'HTML_PAGE = """' in code:
                html_part = code.split('HTML_PAGE = """')[1].split('"""')[0]
                return HTMLResponse(content=html_part)
    return HTMLResponse("<h1>Planshet yuzi topilmadi</h1>")

# --------------------------------------------------------------------------
# Serverni ishga tushirish (Dual-Port: 8000 va 8080)
# --------------------------------------------------------------------------
def run_server_on_port(port: int):
    try:
        config = uvicorn.Config(app=app, host="0.0.0.0", port=port, log_level="warning")
        server = uvicorn.Server(config)
        server.run()
    except Exception as e:
        print(f"[Server Error] Port {port} da ishga tushirib bo'lmadi: {e}")

if __name__ == '__main__':
    print("\n" + "="*65)
    print("🚀 QALQON BRAIN SERVERI ISHGA TUSHTI!")
    print("="*65)
    print(f"💻 Kompyuterda ochish:   http://localhost:8000  yoki  http://localhost:8080")
    print(f"📱 Telefon/Planshetda:   http://{PRIMARY_IP}:8000")
    print(f"                       yoki http://{PRIMARY_IP}:8080")
    if len(LOCAL_IPS) > 1:
        print(f"📡 Boshqa IP manzillar: {', '.join(['http://' + ip + ':8000' for ip in LOCAL_IPS[1:]])}")
    print("="*65 + "\n")

    # 8080 portni alohida torda ishga tushiramiz (telefonlar uchun muqobil kirish)
    t8080 = threading.Thread(target=run_server_on_port, args=(8080,), daemon=True)
    t8080.start()

    # Asosiy 8000 port
    run_server_on_port(8000)
