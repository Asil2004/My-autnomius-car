"""
QALQON: apparatsiz sinov serveri (Pi, Arduino, LiDAR va kamerasiz).
Frontend va masofaviy admin boshqaruvini (remote_control.py) kompyuterda sinash uchun.

Ishga tushirish (Windows PowerShell):
  $env:QALQON_ADMIN_TOKEN="demo123"; $env:QALQON_LOCAL_HOSTS="127.0.0.1"; python dev_mock_pi.py

QALQON_LOCAL_HOSTS="127.0.0.1" bo'lsa, http://127.0.0.1:8000 lokal (monitor), http://localhost:8000 esa masofaviy (admin,
token talab qilinadi) hisoblanadi. Shu bilan bitta kompyuterda ikkala tomonni sinash mumkin.
"""

import asyncio
import io
import os
import time
from typing import Optional

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from remote_control import RemoteControl

START = time.time()


class MockArduino:
    def __init__(self):
        self.last_cmd = "S"
        self.speed_level = 1
        self.logs = []
        self.sonars = {"front": 120, "rear": 150, "left": 80, "right": 95}

    def send_command(self, cmd: str) -> bool:
        cmd = cmd.upper().strip()
        if cmd == "F" and self.sonars["front"] <= 25:
            self.last_cmd = "S"
            return False
        self.last_cmd = cmd
        print(f"[Mock Arduino] -> {cmd}")
        return True

    def set_speed(self, level: int):
        self.speed_level = max(1, min(3, level))

    def _add_log(self, text: str):
        self.logs.append(text)
        print(f"[Mock log] {text}")


arduino = MockArduino()
remote = RemoteControl(arduino=arduino)
app = FastAPI(title="Qalqon Mock Pi")
remote.install(app)  # CORS dan oldin
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


def telemetry() -> dict:
    return {
        "time": time.time(),
        "uptime_sec": int(time.time() - START),
        "mode": "MANUAL",
        "is_front_blocked": arduino.sonars["front"] <= 25,
        "motion": {
            "last_cmd": arduino.last_cmd,
            "speed_level": arduino.speed_level,
            "is_moving": arduino.last_cmd not in ("S", "STOP"),
            "obstacle_warning": arduino.sonars["front"] <= 25,
        },
        "remote": remote.status(),
        "sonars": arduino.sonars,
        "battery": {"voltage": 12.4, "percentage": 83, "current": 1.2, "temp": 31, "isCharging": False},
        "watchdog": {"failsafe_active": False, "heartbeat_age_ms": 0},
        "logs": arduino.logs[-8:],
    }


@app.get("/cmd")
def handle_command(request: Request, c: Optional[str] = None, speed: Optional[int] = None):
    src = getattr(request.state, "src", "local")
    if speed is not None:
        speed = remote.cap_speed(src, speed)
        arduino.set_speed(speed)
        return {"status": "ok", "speed": speed}
    if c:
        cmd = c.upper().strip()
        verdict = remote.pre_command(src, cmd)
        if verdict:
            return JSONResponse(verdict[1], status_code=verdict[0])
        ok = arduino.send_command(cmd)
        remote.post_command(src, cmd, ok)
        return {"status": "ok" if ok else "blocked", "cmd": cmd, "src": src}
    return {"status": "error", "message": "Buyruq berilmadi"}


@app.get("/api/obstacle")
def obstacle(dist: Optional[float] = None):
    arduino.sonars["front"] = int((dist or 1.2) * 100)
    return {"status": "ok", "front_cm": arduino.sonars["front"]}


@app.get("/api/health")
def health():
    return {"status": "healthy", "uptime_sec": int(time.time() - START)}


@app.get("/api/telemetry")
def get_telemetry():
    return telemetry()


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    if not await remote.ws_gate(ws):
        return
    await ws.accept()
    try:
        while True:
            await ws.send_json(telemetry())
            await asyncio.sleep(0.1)
    except (WebSocketDisconnect, Exception):
        pass


def _frame(n: int) -> bytes:
    try:
        from PIL import Image, ImageDraw

        im = Image.new("RGB", (640, 360), (28, 34, 46))
        d = ImageDraw.Draw(im)
        d.text((20, 20), f"MOCK KAMERA  {time.strftime('%H:%M:%S')}  cmd={arduino.last_cmd}", fill=(90, 209, 230))
        d.rectangle((250 + (n % 60) * 2, 150, 330 + (n % 60) * 2, 230), outline=(74, 222, 128), width=3)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=70)
        return buf.getvalue()
    except Exception:
        return bytes.fromhex("ffd8ffdb004300ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffda00080101000003f00ffd9")


@app.get("/stream.mjpg")
@app.get("/video_feed")
def video():
    async def gen():
        n = 0
        while True:
            jpeg = _frame(n)
            n += 1
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n"
            await asyncio.sleep(0.2)

    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame")


if __name__ == "__main__":
    print("Mock Pi: http://127.0.0.1:8000  (admin token:", os.environ.get("QALQON_ADMIN_TOKEN") or "O'RNATILMAGAN", ")")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")
