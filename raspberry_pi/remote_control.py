"""
=============================================================================
QALQON: Masofaviy admin boshqaruvi (internet orqali, Cloudflare Tunnel bilan)
=============================================================================
Maqsad: ikkinchi planshetdan (admin) internet orqali robotni qo'lda boshqarish. Buyruq to'g'ridan-to'g'ri shu Pi ga
keladi, monitor (robotdagi planshet) esa telemetriya orqali "kim, qaysi buyruqni berdi" ma'lumotini ko'radi.

Xavfsizlik qoidalari:
  1. So'rov "masofaviy" hisoblanadi, agar Cloudflare sarlavhalari (CF-Connecting-IP, CF-Ray) bor bo'lsa yoki Host
     lokal manzil (IP, localhost, *.local) bo'lmasa. Tunnel orqali kelgan so'rov Pi ga 127.0.0.1 dan kiradi, shuning uchun
     IP bo'yicha ajratib bo'lmaydi.
  2. Masofaviy so'rov ADMIN TOKEN talab qiladi (env: QALQON_ADMIN_TOKEN). Token bo'sh bo'lsa, masofaviy kirish butunlay o'chiq.
     Noto'g'ri token ketma-ket urinishlari cheklanadi.
  3. Masofaviy admin faqat ruxsat etilgan yo'llarga kira oladi (buyruq, telemetriya, video, holat). To'siq simulyatsiyasi,
     OTA va boshqa xizmat yo'llari yopiq.
  4. Deadman: admin harakat buyrug'i LEASE_MS ichida yangilanmasa, robot o'zi to'xtaydi (internet uzilsa robot qochib ketmasin).
  5. Lokal ustuvorlik: monitordan (lokal) buyruq kelsa, admin buyruqlari LOCAL_HOLD_MS ga to'xtatiladi (STOP doim ishlaydi).
  6. Kalit (kill-switch): monitor /api/remote/allow?on=0 bilan masofaviy buyruqlarni o'chira oladi (STOP doim ishlaydi).
=============================================================================
"""

import hmac
import ipaddress
import os
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

MOVE_CMDS = {"F", "B", "L", "R", "Q", "E"}
ALL_CMDS = MOVE_CMDS | {"S", "U", "D"}
# Masofaviy admin kira oladigan yo'llar (boshqa hammasi yopiq)
ADMIN_PATHS = {
    "/cmd", "/api/telemetry", "/stream.mjpg", "/video_feed", "/api/health",
    "/api/remote/status", "/strobe", "/siren", "/openapi.json"
}


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


class RemoteControl:
    def __init__(self, arduino=None, watchdog=None):
        self.arduino = arduino
        self.watchdog = watchdog
        self.token: str = os.environ.get("QALQON_ADMIN_TOKEN", "").strip()
        self.lease_ms: float = _env_float("QALQON_LEASE_MS", 700)
        self.local_hold_ms: float = _env_float("QALQON_LOCAL_HOLD_MS", 3000)
        self.max_speed: int = int(_env_float("QALQON_REMOTE_MAX_SPEED", 2))
        self.active_ms: float = 2000  # shu vaqt ichida buyruq kelgan bo'lsa, admin "faol"
        # Lokal manzillar ro'yxati. Berilmasa: IP manzillar, localhost va *.local lokal hisoblanadi
        raw = os.environ.get("QALQON_LOCAL_HOSTS", "").strip()
        self.local_hosts = {h.strip().lower() for h in raw.split(",") if h.strip()} if raw else None

        self.allowed = True  # kill-switch: False bo'lsa masofaviy harakat buyruqlari rad etiladi
        self.lock = threading.Lock()
        self.events: List[Dict[str, Any]] = []
        self.last_admin_cmd_t = 0.0
        self.last_admin_move_t = 0.0
        self.last_local_cmd_t = 0.0
        self.lease_active = False
        self.last_event: Optional[Dict[str, Any]] = None
        self._fails: Dict[str, List[float]] = {}

        self._running = True
        threading.Thread(target=self._deadman_loop, daemon=True).start()
        if not self.token:
            print("[Remote] QALQON_ADMIN_TOKEN o'rnatilmagan: masofaviy kirish O'CHIQ.")

    # ------------------------------------------------------------------ aniqlash va autentifikatsiya
    def is_remote(self, headers, client_host: str = "") -> bool:
        if headers.get("cf-connecting-ip") or headers.get("cf-ray"):
            return True
        host = (headers.get("host") or "").split(":")[0].strip().lower().strip("[]")
        if not host:
            return False
        if self.local_hosts is not None:
            return host not in self.local_hosts
        if host in ("localhost", "::1") or host.endswith(".local") or "." not in host:
            return False
        try:
            ipaddress.ip_address(host)
            return False
        except ValueError:
            return True

    def _client_key(self, headers, client_host: str) -> str:
        return headers.get("cf-connecting-ip") or client_host or "?"

    def _check_token(self, headers, query_token: Optional[str], client_host: str) -> Tuple[bool, int, str]:
        if not self.token:
            return False, 503, "Masofaviy boshqaruv o'chiq (Pi da token o'rnatilmagan)"
        key = self._client_key(headers, client_host)
        now = time.time()
        with self.lock:
            fails = [t for t in self._fails.get(key, []) if now - t < 60]
            self._fails[key] = fails
            if len(fails) >= 8:
                return False, 429, "Juda ko'p noto'g'ri urinish. Bir daqiqadan keyin qayta urining"
        given = (headers.get("x-admin-token") or query_token or "").strip()
        if given and hmac.compare_digest(given.encode(), self.token.encode()):
            return True, 200, "ok"
        with self.lock:
            self._fails.setdefault(key, []).append(now)
        return False, 401, "Admin token noto'g'ri"

    async def ws_gate(self, ws) -> bool:
        """WebSocket uchun: masofaviy bo'lsa token kerak. Ruxsat bo'lmasa ulanish yopiladi"""
        if not self.is_remote(ws.headers, ws.client.host if ws.client else ""):
            return True
        ok, _, _ = self._check_token(ws.headers, ws.query_params.get("token"), ws.client.host if ws.client else "")
        if not ok:
            await ws.close(code=1008)
        return ok

    # ------------------------------------------------------------------ buyruqlar
    def pre_command(self, src: str, cmd: str) -> Optional[Tuple[int, Dict[str, Any]]]:
        """None qaytarsa buyruq o'tadi. Aks holda (status, javob) qaytariladi"""
        cmd = cmd.upper().strip()
        if src != "admin":
            return None  # lokal (LAN) buyruqlar avvalgidek, cheklovsiz
        if cmd not in ALL_CMDS:
            return 400, {"status": "error", "message": f"Noma'lum buyruq: {cmd}"}
        if cmd == "S":
            return None
        now = time.time()
        if not self.allowed:
            return 423, {"status": "locked", "message": "Masofaviy boshqaruv monitor tomonidan o'chirilgan"}
        if (now - self.last_local_cmd_t) * 1000 < self.local_hold_ms:
            return 409, {"status": "local_override", "message": "Robot yonidagi operator boshqaryapti"}
        return None

    def post_command(self, src: str, cmd: str, ok: bool):
        cmd = cmd.upper().strip()
        now = time.time()
        with self.lock:
            ev = {"t": now, "src": src, "cmd": cmd, "ok": bool(ok)}
            self.last_event = ev
            self.events.append(ev)
            self.events = self.events[-12:]
            if src == "admin":
                self.last_admin_cmd_t = now
                if cmd in MOVE_CMDS and ok:
                    self.last_admin_move_t = now
                    self.lease_active = True
                elif cmd == "S":
                    self.lease_active = False
            else:
                if cmd != "S":
                    self.last_local_cmd_t = now
                self.lease_active = False  # lokal buyruq admin lease ini bekor qiladi
        if self.arduino and hasattr(self.arduino, "_add_log"):
            who = "ADMIN" if src == "admin" else "LOKAL"
            self.arduino._add_log(f"{who} buyrug'i: {cmd}")

    def cap_speed(self, src: str, speed: int) -> int:
        return min(speed, self.max_speed) if src == "admin" else speed

    def _deadman_loop(self):
        while self._running:
            try:
                fire = False
                with self.lock:
                    if self.lease_active and (time.time() - self.last_admin_move_t) * 1000 > self.lease_ms:
                        self.lease_active = False
                        fire = True
                if fire:
                    if self.arduino:
                        self.arduino.send_command("S")
                    with self.lock:
                        ev = {"t": time.time(), "src": "system", "cmd": "S", "ok": True, "reason": "deadman"}
                        self.last_event = ev
                        self.events.append(ev)
                        self.events = self.events[-12:]
                    if self.arduino and hasattr(self.arduino, "_add_log"):
                        self.arduino._add_log("DEADMAN: admin signali uzildi, robot to'xtatildi")
            except Exception as exc:  # noqa: BLE001
                print(f"[Remote] deadman xatosi: {exc}")
            time.sleep(0.05)

    # ------------------------------------------------------------------ holat (telemetriyaga qo'shiladi)
    def status(self) -> Dict[str, Any]:
        now = time.time()
        with self.lock:
            return {
                "enabled": bool(self.token),
                "allowed": self.allowed,
                "admin_active": (now - self.last_admin_cmd_t) * 1000 < self.active_ms,
                "local_hold": (now - self.last_local_cmd_t) * 1000 < self.local_hold_ms,
                "lease_ms": self.lease_ms,
                "max_speed": self.max_speed,
                "last": self.last_event,
                "events": self.events[-6:],
            }

    # ------------------------------------------------------------------ FastAPI ulanishi
    def install(self, app: FastAPI):
        """CORS middleware'idan OLDIN chaqiring, shunda xato javoblariga ham CORS sarlavhalari qo'shiladi"""
        remote = self

        @app.middleware("http")
        async def remote_guard(request: Request, call_next):
            headers = request.headers
            client_host = request.client.host if request.client else ""
            if remote.is_remote(headers, client_host):
                request.state.src = "admin"
                if request.method != "OPTIONS":
                    ok, status, msg = remote._check_token(headers, request.query_params.get("token"), client_host)
                    if not ok:
                        return JSONResponse({"status": "denied", "message": msg}, status_code=status)
                    if request.url.path not in ADMIN_PATHS:
                        return JSONResponse({"status": "forbidden", "message": "Bu yo'l masofaviy admin uchun yopiq"}, status_code=403)
            else:
                request.state.src = "local"
            return await call_next(request)

        @app.get("/api/remote/status")
        def remote_status():
            return remote.status()

        @app.get("/api/remote/allow")
        def remote_allow(request: Request, on: int = 1):
            # Faqat lokal (monitor) o'zgartira oladi: admin yo'llari ro'yxatida yo'q, middleware 403 beradi
            remote.allowed = bool(on)
            if remote.arduino and hasattr(remote.arduino, "_add_log"):
                remote.arduino._add_log(f"Masofaviy boshqaruv: {'RUXSAT' if remote.allowed else 'TAQIQ'}")
            if not remote.allowed and remote.arduino and remote.lease_active:
                remote.arduino.send_command("S")
                remote.lease_active = False
            return remote.status()
