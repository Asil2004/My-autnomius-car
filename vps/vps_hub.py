#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
QALQON — VPS Cloud Hub & Meta Quest 2 VR Relay Server
=============================================================================
Vazifasi:
  1. Bitta maxsus HTTPS domenda (masalan https://qalqon.uz) QALQON veb-interfeysini
     (#hud, #vr, #controller) va barcha API/Video/WebSocket kanallarini uzatadi.
  2. Robot ichidagi Raspberry Pi 5 (4G/5G SIM-karta yoki boshqa Wi-Fi da) ushbu
     serverga tashqaridan bitta shifrlangan WSS (/ws/robot) orqali ulanadi:
       - Statik IP yoki routerda port ochish SHART EMAS!
       - Meta Quest 2 VR ko'zoynak boshqa istalgan tarmoqdan kirib boshqaradi!
  3. Bitta HTTPS domen ichida (Mixed Content siz!):
       - /api/webcam/stream     -> Frontal USB kamera (MJPEG)
       - /camera/stream         -> 3-linzali PTZ kamera (lensHub 100% mos!)
       - /camera/ptz/move|stop  -> PTZ kamerani real vaqtda burish
       - /ws                    -> 10Hz LiDAR + real vaqtda Joystik/PTZ buyruqlari
       - /api/esp32/* & /cmd    -> ESP32 harakat buyruqlari
=============================================================================
Ishga tushirish:
  uvicorn vps_hub:app --host 0.0.0.0 --port 8000
=============================================================================
"""

import os
import hmac
import json
import time
import asyncio
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

# ---------------------------------------------------------------------------
# Sozlamalar (.env orqali)
# ---------------------------------------------------------------------------
ROBOT_TOKEN = os.environ.get("QALQON_ROBOT_TOKEN", "").strip()
DEFAULT_ROBOT_ID = os.environ.get("QALQON_DEFAULT_ROBOT_ID", "QALQON-01").strip() or "QALQON-01"
FRAME_STALE_SEC = float(os.environ.get("QALQON_FRAME_STALE_SEC", "6.0"))

# Statik veb-sayt ildiz papkasi (repo ildizi: index.html, assets/, models/, ...)
REPO_ROOT = Path(os.environ.get("QALQON_STATIC_DIR", str(Path(__file__).resolve().parent.parent)))

# Binary protokol prefikslari (Pi 5 -> VPS)
CH_WEBCAM_JPEG = 0x01
CH_PTZ_JPEG = 0x02


# ---------------------------------------------------------------------------
# Har bir ulangan robot holati va kadr buferlari
# ---------------------------------------------------------------------------
class RobotSlot:
    def __init__(self, robot_id: str):
        self.robot_id = robot_id
        self.ws: Optional[WebSocket] = None
        self.connected = False
        self.connected_at = 0.0
        self.last_seen_at = 0.0

        # Frontal USB veb-kamera
        self.webcam_jpg: Optional[bytes] = None
        self.webcam_seq = 0
        self.webcam_at = 0.0
        self.webcam_event = asyncio.Event()
        self.webcam_fps = 0.0
        self._webcam_frames = 0
        self._webcam_fps_t0 = time.monotonic()

        # PTZ 3-linzali kamera (ustma-ust 3 ta 16:9 kadr — lensHub.ts bilan 100% mos)
        self.ptz_jpg: Optional[bytes] = None
        self.ptz_seq = 0
        self.ptz_at = 0.0
        self.ptz_event = asyncio.Event()
        self.ptz_fps = 0.0
        self._ptz_frames = 0
        self._ptz_fps_t0 = time.monotonic()

        # Telemetriya & holatlar
        self.lidar_payload: Dict[str, Any] = {
            "source": "LIDAR",
            "model": "LDROBOT STL-19P",
            "is_connected": False,
            "port": "vps-relay",
            "rate_hz": 0.0,
            "rpm": 0,
            "packets_count": 0,
            "crc_errors": 0,
            "lidar": {
                "points": [],
                "total_points": 0,
                "closest_obstacle": {"distance": None, "angle": None},
                "zones": {"front": 5.0, "right": 5.0, "rear": 5.0, "left": 5.0},
            },
            "sonars": {"front": 250, "right": 200, "rear": 200, "left": 200},
            "is_front_blocked": False,
        }
        self.webcam_meta: Dict[str, Any] = {}
        self.ptz_meta: Dict[str, Any] = {"video": {"running": False, "connected": False, "lenses": 3}, "ptz": True, "ptz_lens": 0}
        self.esp32_meta: Dict[str, Any] = {}
        self.ptz_presets: List[Dict[str, str]] = []
        self._send_lock = asyncio.Lock()

    def push_webcam_frame(self, jpg: bytes):
        now = time.time()
        self.webcam_jpg = jpg
        self.webcam_seq += 1
        self.webcam_at = now
        self.last_seen_at = now
        self._webcam_frames += 1
        mono = time.monotonic()
        if mono - self._webcam_fps_t0 >= 1.5:
            self.webcam_fps = round(self._webcam_frames / (mono - self._webcam_fps_t0), 1)
            self._webcam_frames = 0
            self._webcam_fps_t0 = mono
        self.webcam_event.set()
        self.webcam_event.clear()

    def push_ptz_frame(self, jpg: bytes):
        now = time.time()
        self.ptz_jpg = jpg
        self.ptz_seq += 1
        self.ptz_at = now
        self.last_seen_at = now
        self._ptz_frames += 1
        mono = time.monotonic()
        if mono - self._ptz_fps_t0 >= 1.5:
            self.ptz_fps = round(self._ptz_frames / (mono - self._ptz_fps_t0), 1)
            self._ptz_frames = 0
            self._ptz_fps_t0 = mono
        self.ptz_event.set()
        self.ptz_event.clear()

    async def send_command(self, payload: Dict[str, Any]) -> bool:
        ws = self.ws
        if not self.connected or ws is None:
            return False
        try:
            async with self._send_lock:
                await ws.send_text(json.dumps(payload, separators=(",", ":")))
            return True
        except Exception:
            return False

    def webcam_status(self) -> Dict[str, Any]:
        now = time.time()
        age = round(now - self.webcam_at, 2) if self.webcam_at > 0 else None
        fresh = self.connected and self.webcam_jpg is not None and (age is not None and age < FRAME_STALE_SEC)
        meta = self.webcam_meta or {}
        err = None
        if not self.connected:
            err = f"Robot ({self.robot_id}) VPS serverga ulanmagan"
        elif not fresh:
            err = meta.get("error") or "Frontal USB kameradan kadr kutilmoqda..."
        return {
            "available": True,
            "connected": fresh,
            "device": meta.get("device") or "vps-relay",
            "name": meta.get("name") or f"{self.robot_id} USB Frontal",
            "width": meta.get("width") or 640,
            "height": meta.get("height") or 480,
            "fps": self.webcam_fps or meta.get("fps") or 0.0,
            "last_frame_age": age,
            "error": err,
        }

    def ptz_status(self) -> Dict[str, Any]:
        now = time.time()
        age = round(now - self.ptz_at, 2) if self.ptz_at > 0 else None
        fresh = self.connected and self.ptz_jpg is not None and (age is not None and age < FRAME_STALE_SEC)
        raw_video = (self.ptz_meta or {}).get("video") or {}
        err = None
        if not self.connected:
            err = f"Robot ({self.robot_id}) VPS serverga ulanmagan"
        elif not fresh:
            err = raw_video.get("error") or "PTZ kameradan kadr kutilmoqda..."
        return {
            "video": {
                "running": self.connected,
                "connected": fresh,
                "width": raw_video.get("width") or 960,
                "height": raw_video.get("height") or 1620,
                "lenses": raw_video.get("lenses") or 3,
                "fps": self.ptz_fps,
                "last_frame_age": age,
                "error": err,
            },
            "ptz": bool((self.ptz_meta or {}).get("ptz", True)) and self.connected,
            "ptz_lens": int((self.ptz_meta or {}).get("ptz_lens", 0)),
        }


robots: Dict[str, RobotSlot] = {DEFAULT_ROBOT_ID: RobotSlot(DEFAULT_ROBOT_ID)}


def get_robot(robot_id: Optional[str] = None) -> RobotSlot:
    rid = (robot_id or "").strip()
    if rid:
        if rid not in robots:
            robots[rid] = RobotSlot(rid)
        return robots[rid]
    # Agar default robot online bo'lsa o'shani, aks holda birinchi online robotni qaytarish
    if DEFAULT_ROBOT_ID in robots and robots[DEFAULT_ROBOT_ID].connected:
        return robots[DEFAULT_ROBOT_ID]
    for slot in robots.values():
        if slot.connected:
            return slot
    return robots[DEFAULT_ROBOT_ID]


def verify_robot_token(provided: Optional[str]) -> bool:
    if not ROBOT_TOKEN:
        return True
    if not provided:
        return False
    return hmac.compare_digest(provided.strip(), ROBOT_TOKEN)


# ---------------------------------------------------------------------------
# FastAPI Ilova
# ---------------------------------------------------------------------------
app = FastAPI(title="QALQON VPS Cloud Relay & VR Hub", version="3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    online = [r.robot_id for r in robots.values() if r.connected]
    return {"ok": True, "mode": "vps_cloud_relay", "robots_online": online}


@app.get("/api/robots")
def list_robots():
    now = time.time()
    out = []
    for slot in robots.values():
        out.append({
            "robot_id": slot.robot_id,
            "online": slot.connected,
            "last_seen_age": round(now - slot.last_seen_at, 1) if slot.last_seen_at > 0 else None,
            "webcam_fps": slot.webcam_fps,
            "ptz_fps": slot.ptz_fps,
            "lidar_connected": bool(slot.lidar_payload.get("is_connected")),
        })
    return {"robots": out}


# ===========================================================================
# 1. ROBOT UPLINK (Raspberry Pi 5 -> VPS, faqat chiquvchi WSS 443!)
# ===========================================================================
@app.websocket("/ws/robot")
async def robot_uplink_ws(websocket: WebSocket):
    robot_id = (websocket.query_params.get("robot_id") or DEFAULT_ROBOT_ID).strip() or DEFAULT_ROBOT_ID
    token = (
        websocket.query_params.get("token")
        or websocket.headers.get("x-qalqon-token")
        or (websocket.headers.get("authorization", "").removeprefix("Bearer ").strip())
    )

    if not verify_robot_token(token):
        await websocket.close(code=1008, reason="Invalid robot token")
        return

    await websocket.accept()
    slot = get_robot(robot_id)

    # Agar eski ulanish osilib qolgan bo'lsa yopish
    if slot.ws is not None and slot.ws is not websocket:
        try:
            await slot.ws.close(code=1000, reason="Replaced by new uplink")
        except Exception:
            pass

    slot.ws = websocket
    slot.connected = True
    slot.connected_at = time.time()
    slot.last_seen_at = time.time()
    print(f"[VPS-UPLINK] ✅ Robot ulandi: {robot_id}")

    try:
        while True:
            msg = await websocket.receive()
            if msg["type"] == "websocket.disconnect":
                break

            raw_bytes = msg.get("bytes")
            if raw_bytes and len(raw_bytes) > 1:
                ch = raw_bytes[0]
                payload = raw_bytes[1:]
                if ch == CH_WEBCAM_JPEG:
                    slot.push_webcam_frame(payload)
                elif ch == CH_PTZ_JPEG:
                    slot.push_ptz_frame(payload)
                continue

            raw_text = msg.get("text")
            if raw_text:
                slot.last_seen_at = time.time()
                try:
                    data = json.loads(raw_text)
                    mtype = data.get("type")
                    if mtype == "telemetry":
                        if isinstance(data.get("lidar"), dict):
                            slot.lidar_payload = data["lidar"]
                        if isinstance(data.get("webcam"), dict):
                            slot.webcam_meta = data["webcam"]
                        if isinstance(data.get("ptz"), dict):
                            slot.ptz_meta = data["ptz"]
                        if isinstance(data.get("esp32"), dict):
                            slot.esp32_meta = data["esp32"]
                    elif mtype == "presets" and isinstance(data.get("presets"), list):
                        slot.ptz_presets = data["presets"]
                    elif mtype == "ping":
                        await slot.send_command({"type": "pong", "t": data.get("t")})
                except Exception:
                    pass
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[VPS-UPLINK] ⚠️ Robot xatosi ({robot_id}): {e}")
    finally:
        if slot.ws is websocket:
            slot.ws = None
            slot.connected = False
            # Xavfsizlik: telemetriya uzildi deb belgilash
            slot.lidar_payload["is_connected"] = False
            slot.webcam_event.set()
            slot.webcam_event.clear()
            slot.ptz_event.set()
            slot.ptz_event.clear()
        print(f"[VPS-UPLINK] ❌ Robot uzildi: {robot_id}")


# ===========================================================================
# 2. OPERATOR & META QUEST 2 WEBSOCKET (LiDAR + Real-time Drive/PTZ)
# ===========================================================================
@app.websocket("/ws")
async def operator_ws(websocket: WebSocket):
    robot_id = websocket.query_params.get("robot_id")
    await websocket.accept()
    slot = get_robot(robot_id)

    async def sender_loop():
        while True:
            cur = get_robot(robot_id)
            await websocket.send_text(json.dumps(cur.lidar_payload, separators=(",", ":")))
            await asyncio.sleep(0.1)

    async def receiver_loop():
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
                cur = get_robot(robot_id)
                mtype = msg.get("type")
                if mtype in ("joystick", "cmd", "speed", "ptz_move", "ptz_stop", "ptz_preset"):
                    await cur.send_command(msg)
            except Exception:
                pass

    send_task = asyncio.create_task(sender_loop())
    recv_task = asyncio.create_task(receiver_loop())
    try:
        _, pending = await asyncio.wait([send_task, recv_task], return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
    except (WebSocketDisconnect, Exception):
        send_task.cancel()
        recv_task.cancel()


# ===========================================================================
# 3. STATUS, LIDAR & FRONTAL WEBCAM ENDPOINTLARI (Same-Origin HTTPS)
# ===========================================================================
@app.get("/api/lidar")
def api_lidar(robot_id: Optional[str] = None):
    return get_robot(robot_id).lidar_payload


@app.get("/api/status")
def api_status(robot_id: Optional[str] = None):
    slot = get_robot(robot_id)
    lidar = slot.lidar_payload
    return {
        "status": "ONLINE" if (slot.connected and lidar.get("is_connected")) else "DISCONNECTED",
        "cloud_relay": True,
        "robot_id": slot.robot_id,
        "robot_online": slot.connected,
        "model": lidar.get("model", "LDROBOT STL-19P"),
        "port": lidar.get("port", "vps-relay"),
        "rate_hz": lidar.get("rate_hz", 0.0),
        "packets": lidar.get("packets_count", 0),
        "webcam": slot.webcam_status(),
        "ptz": slot.ptz_status(),
        "esp32": slot.esp32_meta,
    }


@app.get("/api/webcam/status")
def api_webcam_status(robot_id: Optional[str] = None):
    return JSONResponse(
        content=get_robot(robot_id).webcam_status(),
        headers={"Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"},
    )


@app.get("/api/webcam/snapshot")
def api_webcam_snapshot(robot_id: Optional[str] = None):
    slot = get_robot(robot_id)
    if not slot.webcam_jpg:
        return JSONResponse(status_code=503, content={"error": "Frontal kamera kadri hali kelmadi"})
    return Response(
        content=slot.webcam_jpg,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"},
    )


@app.get("/api/webcam/stream")
async def api_webcam_stream(request: Request, robot_id: Optional[str] = None):
    async def gen():
        last_seq = -1
        try:
            while True:
                if await request.is_disconnected():
                    break
                slot = get_robot(robot_id)
                if slot.webcam_jpg and slot.webcam_seq != last_seq:
                    last_seq = slot.webcam_seq
                    jpg = slot.webcam_jpg
                    yield (
                        b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                        + str(len(jpg)).encode("ascii")
                        + b"\r\n\r\n"
                        + jpg
                        + b"\r\n"
                    )
                try:
                    await asyncio.wait_for(slot.webcam_event.wait(), timeout=1.0)
                except asyncio.TimeoutError:
                    pass
        except (asyncio.CancelledError, GeneratorExit):
            pass

    return StreamingResponse(
        gen(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


# ===========================================================================
# 4. PTZ 3-LINZALI KAMERA & BOSHQARUV ENDPOINTLARI (/camera/*)
# ===========================================================================
@app.get("/camera/status")
def camera_status(robot_id: Optional[str] = None):
    return JSONResponse(
        content=get_robot(robot_id).ptz_status(),
        headers={"Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"},
    )


@app.get("/camera/snapshot.jpg")
def camera_snapshot(robot_id: Optional[str] = None):
    slot = get_robot(robot_id)
    if not slot.ptz_jpg:
        return JSONResponse(status_code=503, content={"error": "PTZ kamera kadri hali kelmadi"})
    return Response(
        content=slot.ptz_jpg,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"},
    )


@app.get("/camera/stream")
async def camera_stream(request: Request, robot_id: Optional[str] = None):
    async def gen():
        last_seq = -1
        try:
            while True:
                if await request.is_disconnected():
                    break
                slot = get_robot(robot_id)
                if slot.ptz_jpg and slot.ptz_seq != last_seq:
                    last_seq = slot.ptz_seq
                    jpg = slot.ptz_jpg
                    yield (
                        b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                        + str(len(jpg)).encode("ascii")
                        + b"\r\n\r\n"
                        + jpg
                        + b"\r\n"
                    )
                try:
                    await asyncio.wait_for(slot.ptz_event.wait(), timeout=1.0)
                except asyncio.TimeoutError:
                    pass
        except (asyncio.CancelledError, GeneratorExit):
            pass

    return StreamingResponse(
        gen(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


@app.post("/camera/ptz/move")
async def camera_ptz_move(request: Request, robot_id: Optional[str] = None):
    body = await request.json()
    ok = await get_robot(robot_id).send_command({
        "type": "ptz_move",
        "pan": float(body.get("pan", 0)),
        "tilt": float(body.get("tilt", 0)),
        "zoom": float(body.get("zoom", 0)),
        "duration": float(body.get("duration", 0.7)),
        "direction": body.get("direction"),
        "speed": float(body.get("speed", 0.6)),
    })
    return JSONResponse(status_code=200 if ok else 503, content={"ok": ok})


@app.post("/camera/ptz/stop")
async def camera_ptz_stop(robot_id: Optional[str] = None):
    ok = await get_robot(robot_id).send_command({"type": "ptz_stop"})
    return JSONResponse(status_code=200 if ok else 503, content={"ok": ok})


@app.get("/camera/ptz/presets")
def camera_ptz_presets(robot_id: Optional[str] = None):
    return get_robot(robot_id).ptz_presets


@app.post("/camera/ptz/presets/{token}/goto")
async def camera_ptz_preset_goto(token: str, robot_id: Optional[str] = None):
    ok = await get_robot(robot_id).send_command({"type": "ptz_preset", "token": token})
    return JSONResponse(status_code=200 if ok else 503, content={"ok": ok})


# ===========================================================================
# 5. ESP32 MOTOR BOSHQARUV ENDPOINTLARI
# ===========================================================================
@app.get("/cmd")
async def esp32_cmd_get(c: str = "S", robot_id: Optional[str] = None):
    ok = await get_robot(robot_id).send_command({"type": "cmd", "cmd": c})
    return {"ok": ok, "cmd": c}


@app.get("/move")
async def esp32_move_get(dir: Optional[str] = None, x: Optional[int] = None, y: Optional[int] = None, robot_id: Optional[str] = None):
    slot = get_robot(robot_id)
    if x is not None or y is not None:
        ok = await slot.send_command({"type": "joystick", "x": x or 0, "y": y or 0})
        return {"ok": ok, "x": x or 0, "y": y or 0}
    ok = await slot.send_command({"type": "cmd", "cmd": dir or "S"})
    return {"ok": ok, "cmd": dir or "S"}


@app.post("/api/esp32/cmd")
async def esp32_cmd_post(request: Request, robot_id: Optional[str] = None):
    body = await request.json()
    cmd = str(body.get("cmd", "S"))
    ok = await get_robot(robot_id).send_command({"type": "cmd", "cmd": cmd})
    return {"ok": ok, "cmd": cmd}


@app.post("/api/esp32/joystick")
async def esp32_joystick_post(request: Request, robot_id: Optional[str] = None):
    body = await request.json()
    x, y = int(body.get("x", 0)), int(body.get("y", 0))
    ok = await get_robot(robot_id).send_command({"type": "joystick", "x": x, "y": y})
    return {"ok": ok, "x": x, "y": y}


@app.post("/api/esp32/speed")
async def esp32_speed_post(request: Request, robot_id: Optional[str] = None):
    body = await request.json()
    speed = int(body.get("speed", 2))
    ok = await get_robot(robot_id).send_command({"type": "speed", "speed": speed})
    return {"ok": ok, "speed": speed}


# ===========================================================================
# 6. STATIK FRONTEND SAYT (React HUD + Meta Quest 2 VR)
# ===========================================================================
for folder in ("assets", "images", "models", "faces", "audio"):
    folder_path = REPO_ROOT / folder
    if folder_path.is_dir():
        app.mount(f"/{folder}", StaticFiles(directory=str(folder_path)), name=folder)

for static_file in ("favicon.svg", "shield.svg", "icons.svg"):
    sf_path = REPO_ROOT / static_file
    if sf_path.is_file():
        def _make_static(p: Path = sf_path):
            return lambda: FileResponse(str(p))
        app.add_api_route(f"/{static_file}", _make_static(), methods=["GET"])


@app.get("/")
def serve_index():
    index_file = REPO_ROOT / "index.html"
    if index_file.is_file():
        return FileResponse(str(index_file), headers={"Cache-Control": "no-cache"})
    return HTMLResponse("<h1>QALQON VPS Cloud Hub Faol</h1><p>index.html topilmadi.</p>")
