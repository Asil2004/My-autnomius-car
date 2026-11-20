#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
QALQON — Raspberry Pi 5 -> VPS Cloud Uplink Agent
=============================================================================
Robot (4G SIM-karta yoki istalgan Wi-Fi da) ichida ishlaydi va bitta chiquvchi
WSS (443-port) orqali VPS ga ulanadi:
  1. Frontal USB veb-kamera (localhost:8000) -> 0x01 binary JPEG
  2. PTZ 3-linzali kamera (localhost:8090)   -> 0x02 binary JPEG (4G uchun ixcham)
  3. LiDAR 360° + Status                     -> JSON telemetriya
  4. VPS (Meta Quest 2 VR / HUD) buyruqlari  -> ESP32 & PTZ ga real vaqtda!

Statik IP yoki routerda port ochish SHART EMAS!
=============================================================================
"""

import os
import sys
import json
import time
import asyncio
import urllib.parse
from typing import Optional

os.environ["OPENCV_LOG_LEVEL"] = "OFF"

try:
    import httpx
except ImportError:
    print("[-] Xatolik: httpx o'rnatilmagan! (pip install httpx)")
    sys.exit(1)

try:
    import websockets
except ImportError:
    print("[-] Xatolik: websockets o'rnatilmagan! (pip install websockets)")
    sys.exit(1)

try:
    import cv2
    import numpy as np
    HAS_CV2 = True
except Exception:
    cv2 = None
    np = None
    HAS_CV2 = False

# ---------------------------------------------------------------------------
# Konfiguratsiya (env yoki /etc/qalqon/vps.env)
# ---------------------------------------------------------------------------
CH_WEBCAM_JPEG = b"\x01"
CH_PTZ_JPEG = b"\x02"


def load_env_file(path: str):
    if not os.path.isfile(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if not s or s.startswith("#") or "=" not in s:
                    continue
                k, v = s.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
    except Exception:
        pass


load_env_file("/etc/qalqon/vps.env")
load_env_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "vps.env"))

RAW_VPS_URL = os.environ.get("QALQON_VPS_URL", "").strip()
ROBOT_ID = os.environ.get("QALQON_ROBOT_ID", "QALQON-01").strip() or "QALQON-01"
ROBOT_TOKEN = os.environ.get("QALQON_ROBOT_TOKEN", "").strip()

LOCAL_HUB_URL = os.environ.get("QALQON_LOCAL_HUB", "http://127.0.0.1:8000").rstrip("/")
LOCAL_PTZ_URL = os.environ.get("QALQON_LOCAL_PTZ", "http://127.0.0.1:8090").rstrip("/")

WEBCAM_FPS = float(os.environ.get("WEBCAM_UPLINK_FPS", "12"))
PTZ_FPS = float(os.environ.get("PTZ_UPLINK_FPS", "10"))
PTZ_MAX_WIDTH = int(os.environ.get("PTZ_UPLINK_MAX_WIDTH", "960"))
PTZ_JPEG_QUALITY = int(os.environ.get("PTZ_UPLINK_QUALITY", "58"))
LIDAR_HZ = float(os.environ.get("LIDAR_UPLINK_HZ", "8"))


def build_ws_url(raw: str) -> str:
    s = raw.strip().rstrip("/")
    if not s:
        return ""
    if s.startswith("https://"):
        s = "wss://" + s[len("https://"):]
    elif s.startswith("http://"):
        s = "ws://" + s[len("http://"):]
    elif not s.startswith(("ws://", "wss://")):
        s = "wss://" + s

    if not s.endswith("/ws/robot"):
        s = f"{s}/ws/robot"

    q = urllib.parse.urlencode({"robot_id": ROBOT_ID, "token": ROBOT_TOKEN})
    return f"{s}?{q}"


def downscale_ptz_jpeg(jpg_bytes: bytes) -> bytes:
    """1920x3240 (3-linza) kadrni 4G tarmoqqa moslab (masalan 960x1620, q=58) yengillashtiradi."""
    if not HAS_CV2 or PTZ_MAX_WIDTH <= 0:
        return jpg_bytes
    try:
        arr = np.frombuffer(jpg_bytes, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return jpg_bytes
        h, w = img.shape[:2]
        if w > PTZ_MAX_WIDTH:
            nh = max(1, int(round(h * PTZ_MAX_WIDTH / w)))
            img = cv2.resize(img, (PTZ_MAX_WIDTH, nh), interpolation=cv2.INTER_AREA)
        ok, out = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), PTZ_JPEG_QUALITY])
        return out.tobytes() if ok else jpg_bytes
    except Exception:
        return jpg_bytes


async def safe_emergency_stop(http: httpx.AsyncClient):
    """Aloqa uzilganda robot va PTZ ni darhol to'xtatish (Failsafe)."""
    try:
        await http.post(f"{LOCAL_HUB_URL}/api/esp32/cmd", json={"cmd": "S"}, timeout=1.5)
    except Exception:
        pass
    try:
        await http.post(f"{LOCAL_PTZ_URL}/camera/ptz/stop", json={}, timeout=1.5)
    except Exception:
        pass


async def handle_vps_command(http: httpx.AsyncClient, msg: dict):
    mtype = msg.get("type")
    try:
        if mtype == "joystick":
            await http.post(
                f"{LOCAL_HUB_URL}/api/esp32/joystick",
                json={"x": int(msg.get("x", 0)), "y": int(msg.get("y", 0))},
                timeout=1.5,
            )
        elif mtype == "cmd":
            await http.post(
                f"{LOCAL_HUB_URL}/api/esp32/cmd",
                json={"cmd": str(msg.get("cmd", "S"))},
                timeout=1.5,
            )
        elif mtype == "speed":
            await http.post(
                f"{LOCAL_HUB_URL}/api/esp32/speed",
                json={"speed": int(msg.get("speed", 2))},
                timeout=1.5,
            )
        elif mtype == "ptz_move":
            payload = {
                "pan": float(msg.get("pan", 0)),
                "tilt": float(msg.get("tilt", 0)),
                "zoom": float(msg.get("zoom", 0)),
                "duration": float(msg.get("duration", 0.7)),
            }
            if msg.get("direction"):
                payload["direction"] = msg["direction"]
                payload["speed"] = float(msg.get("speed", 0.6))
            await http.post(f"{LOCAL_PTZ_URL}/camera/ptz/move", json=payload, timeout=2.0)
        elif mtype == "ptz_stop":
            await http.post(f"{LOCAL_PTZ_URL}/camera/ptz/stop", json={}, timeout=2.0)
        elif mtype == "ptz_preset":
            token = urllib.parse.quote(str(msg.get("token", "")))
            if token:
                await http.post(f"{LOCAL_PTZ_URL}/camera/ptz/presets/{token}/goto", json={}, timeout=2.5)
    except Exception:
        pass


async def run_uplink_session(ws_url: str):
    send_lock = asyncio.Lock()

    async def safe_send(ws, data):
        async with send_lock:
            await ws.send(data)

    async with httpx.AsyncClient(timeout=2.5) as http:
        async with websockets.connect(
            ws_url,
            ping_interval=15,
            ping_timeout=15,
            max_size=4 * 1024 * 1024,
        ) as ws:
            print(f"[UPLINK] ✅ VPS ga ulandi ({ROBOT_ID}) -> {RAW_VPS_URL}")

            async def webcam_task():
                interval = 1.0 / max(1.0, WEBCAM_FPS)
                while True:
                    t0 = time.monotonic()
                    try:
                        r = await http.get(f"{LOCAL_HUB_URL}/api/webcam/snapshot", timeout=1.5)
                        if r.status_code == 200 and r.content:
                            await safe_send(ws, CH_WEBCAM_JPEG + r.content)
                    except Exception:
                        await asyncio.sleep(0.5)
                    wait = interval - (time.monotonic() - t0)
                    if wait > 0:
                        await asyncio.sleep(wait)

            async def ptz_video_task():
                interval = 1.0 / max(1.0, PTZ_FPS)
                while True:
                    t0 = time.monotonic()
                    try:
                        r = await http.get(f"{LOCAL_PTZ_URL}/camera/snapshot.jpg", timeout=2.0)
                        if r.status_code == 200 and r.content:
                            jpg = await asyncio.to_thread(downscale_ptz_jpeg, r.content)
                            await safe_send(ws, CH_PTZ_JPEG + jpg)
                    except Exception:
                        await asyncio.sleep(0.8)
                    wait = interval - (time.monotonic() - t0)
                    if wait > 0:
                        await asyncio.sleep(wait)

            async def telemetry_task():
                interval = 1.0 / max(1.0, LIDAR_HZ)
                last_meta = 0.0
                last_presets = 0.0
                cached_webcam = {}
                cached_ptz = {}
                cached_esp32 = {}
                while True:
                    t0 = time.monotonic()
                    now = time.monotonic()
                    lidar = None
                    try:
                        r = await http.get(f"{LOCAL_HUB_URL}/api/lidar", timeout=1.0)
                        if r.status_code == 200:
                            lidar = r.json()
                    except Exception:
                        pass

                    if now - last_meta >= 2.0:
                        last_meta = now
                        try:
                            rs = await http.get(f"{LOCAL_HUB_URL}/api/status", timeout=1.0)
                            if rs.status_code == 200:
                                j = rs.json()
                                cached_webcam = j.get("webcam") or {}
                                cached_esp32 = j.get("esp32") or {}
                        except Exception:
                            pass
                        try:
                            rp = await http.get(f"{LOCAL_PTZ_URL}/camera/status", timeout=1.0)
                            if rp.status_code == 200:
                                cached_ptz = rp.json()
                        except Exception:
                            pass

                    if now - last_presets >= 30.0:
                        last_presets = now
                        try:
                            rpr = await http.get(f"{LOCAL_PTZ_URL}/camera/ptz/presets", timeout=2.0)
                            if rpr.status_code == 200:
                                await safe_send(ws, json.dumps({"type": "presets", "presets": rpr.json()}))
                        except Exception:
                            pass

                    payload = {
                        "type": "telemetry",
                        "lidar": lidar,
                        "webcam": cached_webcam,
                        "ptz": cached_ptz,
                        "esp32": cached_esp32,
                    }
                    await safe_send(ws, json.dumps(payload, separators=(",", ":")))

                    wait = interval - (time.monotonic() - t0)
                    if wait > 0:
                        await asyncio.sleep(wait)

            async def command_recv_task():
                async for raw in ws:
                    if isinstance(raw, str):
                        try:
                            msg = json.loads(raw)
                            if msg.get("type") != "pong":
                                asyncio.create_task(handle_vps_command(http, msg))
                        except Exception:
                            pass

            tasks = [
                asyncio.create_task(webcam_task()),
                asyncio.create_task(ptz_video_task()),
                asyncio.create_task(telemetry_task()),
                asyncio.create_task(command_recv_task()),
            ]
            try:
                done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for t in pending:
                    t.cancel()
                for t in done:
                    exc = t.exception()
                    if exc:
                        raise exc
            finally:
                for t in tasks:
                    if not t.done():
                        t.cancel()
                await safe_emergency_stop(http)


async def main():
    ws_url = build_ws_url(RAW_VPS_URL)
    if not ws_url:
        print("[-] QALQON_VPS_URL kiritilmagan! /etc/qalqon/vps.env ni sozlang.")
        print("    Misol: sudo bash raspberry_pi/setup_vps_uplink.sh https://sizning-domeningiz.uz MAXFIY_TOKEN")
        sys.exit(1)

    print("=" * 65)
    print(f"🛡️  QALQON PI 5 -> VPS CLOUD UPLINK ({ROBOT_ID})")
    print(f"🌐  VPS Manzil:   {RAW_VPS_URL}")
    print(f"📷  Webcam FPS:   {WEBCAM_FPS} | PTZ FPS: {PTZ_FPS} (max {PTZ_MAX_WIDTH}px)")
    print("=" * 65)

    backoff = 1.5
    while True:
        try:
            await run_uplink_session(ws_url)
            backoff = 1.5
        except Exception as e:
            print(f"[UPLINK] ⚠️ Aloqa uzildi ({e}). {backoff:.1f}s dan keyin qayta ulaniladi...")
            await asyncio.sleep(backoff)
            backoff = min(6.0, backoff * 1.4)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[UPLINK] To'xtatildi.")
