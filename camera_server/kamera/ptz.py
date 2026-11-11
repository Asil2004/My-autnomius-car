"""ONVIF orqali kamerani burish (PTZ: pan / tilt / zoom).

Tashqi ONVIF kutubxonasisiz, to'g'ridan-to'g'ri SOAP so'rovlari bilan ishlaydi.
Login/parol berilsa, WS-Security (PasswordDigest) bilan imzolanadi.
"""
from __future__ import annotations

import base64
import datetime
import hashlib
import os
import re
import threading
from typing import Optional
from xml.sax.saxutils import escape

import httpx

DIRECTIONS: dict[str, tuple[int, int]] = {
    "left": (-1, 0),
    "right": (1, 0),
    "up": (0, 1),
    "down": (0, -1),
    "up_left": (-1, 1),
    "up_right": (1, 1),
    "down_left": (-1, -1),
    "down_right": (1, -1),
}

_ENV_OPEN = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"'
    ' xmlns:tds="http://www.onvif.org/ver10/device/wsdl"'
    ' xmlns:trt="http://www.onvif.org/ver10/media/wsdl"'
    ' xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl"'
    ' xmlns:tt="http://www.onvif.org/ver10/schema">'
)
_WSSE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
_WSU = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"
_PW_DIGEST = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest"
_B64 = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary"


class PTZError(RuntimeError):
    """Kamera PTZ buyrug'ini bajara olmadi."""


def _clamp(v: float) -> float:
    return max(-1.0, min(1.0, float(v)))


class PTZController:
    def __init__(
        self,
        host: str,
        port: int = 8899,
        username: str = "",
        password: str = "",
        *,
        profile_token: Optional[str] = None,
        timeout: float = 5.0,
        invert_pan: bool = False,
        invert_tilt: bool = False,
    ) -> None:
        """
        host, port      kamera ONVIF manzili (V380: port 8899)
        username/pass   ONVIF login (V380 odatda talab qilmaydi)
        profile_token   bo'sh qolsa, PTZ'li birinchi profil avtomatik topiladi
        invert_*        kamera teskari o'rnatilgan bo'lsa yo'nalishni almashtiradi
        """
        self.base = f"http://{host}:{port}/onvif"
        self.username = username
        self.password = password
        self.invert_pan = invert_pan
        self.invert_tilt = invert_tilt
        self._profile_token = profile_token
        self._client = httpx.Client(timeout=timeout)
        self._lock = threading.Lock()
        self._stop_timer: Optional[threading.Timer] = None
        self._gen = 0

    # ── SOAP ─────────────────────────────────────────────────────────────────
    def _security_header(self) -> str:
        if not self.username:
            return ""
        nonce = os.urandom(16)
        created = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        digest = base64.b64encode(
            hashlib.sha1(nonce + created.encode() + self.password.encode()).digest()
        ).decode()
        return (
            f'<s:Header><wsse:Security xmlns:wsse="{_WSSE}" xmlns:wsu="{_WSU}">'
            f"<wsse:UsernameToken><wsse:Username>{escape(self.username)}</wsse:Username>"
            f'<wsse:Password Type="{_PW_DIGEST}">{digest}</wsse:Password>'
            f'<wsse:Nonce EncodingType="{_B64}">{base64.b64encode(nonce).decode()}</wsse:Nonce>'
            f"<wsu:Created>{created}</wsu:Created></wsse:UsernameToken></wsse:Security></s:Header>"
        )

    def _call(self, service: str, body: str) -> str:
        envelope = f"{_ENV_OPEN}{self._security_header()}<s:Body>{body}</s:Body></s:Envelope>"
        try:
            r = self._client.post(
                f"{self.base}/{service}",
                content=envelope.encode(),
                headers={"Content-Type": "application/soap+xml; charset=utf-8"},
            )
        except httpx.HTTPError as e:
            raise PTZError(f"Kameraga ulanib bo'lmadi: {e}") from e
        text = r.text
        if r.status_code >= 400 or re.search(r"<(\w+:)?Fault[ >]", text):
            m = re.search(r"<(?:\w+:)?Text[^>]*>(.*?)</", text, re.S)
            raise PTZError(m.group(1).strip() if m else f"HTTP {r.status_code}")
        return text

    # ── profil ───────────────────────────────────────────────────────────────
    @property
    def profile_token(self) -> str:
        if self._profile_token is None:
            text = self._call("media_service", "<trt:GetProfiles/>")
            profiles = re.findall(
                r'<(?:\w+:)?Profiles[^>]*token="([^"]+)"[^>]*>(.*?)</(?:\w+:)?Profiles>', text, re.S
            )
            if not profiles:
                raise PTZError("Kamerada media profil topilmadi")
            with_ptz = [tok for tok, body in profiles if "PTZConfiguration" in body]
            self._profile_token = (with_ptz or [profiles[0][0]])[0]
        return self._profile_token

    # ── harakat ──────────────────────────────────────────────────────────────
    def move(self, pan: float, tilt: float, zoom: float = 0.0, duration: Optional[float] = None) -> None:
        """Uzluksiz harakat. pan/tilt/zoom: -1..1 (tezlik va yo'nalish).

        duration berilsa, shuncha soniyadan keyin kamera o'zi to'xtaydi. Bu himoya:
        mijoz uzilib qolsa ham kamera aylanib qolmaydi.
        """
        pan = -_clamp(pan) if self.invert_pan else _clamp(pan)
        tilt = -_clamp(tilt) if self.invert_tilt else _clamp(tilt)
        zoom = _clamp(zoom)
        velocity = f'<tt:PanTilt x="{pan:.2f}" y="{tilt:.2f}"/>'
        if zoom:
            velocity += f'<tt:Zoom x="{zoom:.2f}"/>'
        body = (
            f"<tptz:ContinuousMove><tptz:ProfileToken>{escape(self.profile_token)}</tptz:ProfileToken>"
            f"<tptz:Velocity>{velocity}</tptz:Velocity></tptz:ContinuousMove>"
        )
        with self._lock:
            self._cancel_timer()
            self._call("ptz_service", body)
            if duration:
                self._stop_timer = threading.Timer(duration, self._auto_stop, args=(self._gen,))
                self._stop_timer.daemon = True
                self._stop_timer.start()

    def move_direction(self, direction: str, speed: float = 0.5, duration: Optional[float] = None) -> None:
        """direction: left, right, up, down, up_left, up_right, down_left, down_right."""
        if direction not in DIRECTIONS:
            raise ValueError(f"Noma'lum yo'nalish: {direction}")
        dx, dy = DIRECTIONS[direction]
        s = max(0.05, min(1.0, speed))
        self.move(dx * s, dy * s, 0.0, duration)

    def step(self, direction: str, speed: float = 0.5, seconds: float = 0.4) -> None:
        """Bir qadam burish: harakatlanadi va `seconds` dan keyin to'xtaydi."""
        self.move_direction(direction, speed, duration=seconds)

    def stop(self) -> None:
        with self._lock:
            self._cancel_timer()
            self._send_stop()

    # ── presetlar (saqlangan holatlar) ───────────────────────────────────────
    def get_presets(self) -> list[dict]:
        text = self._call(
            "ptz_service",
            f"<tptz:GetPresets><tptz:ProfileToken>{escape(self.profile_token)}</tptz:ProfileToken></tptz:GetPresets>",
        )
        out = []
        for tok, body in re.findall(r'<(?:\w+:)?Preset[^>]*token="([^"]*)"[^>]*>(.*?)</(?:\w+:)?Preset>', text, re.S):
            m = re.search(r"<(?:\w+:)?Name>(.*?)</", body, re.S)
            out.append({"token": tok, "name": m.group(1) if m else tok})
        return out

    def goto_preset(self, token: str, speed: float = 0.5) -> None:
        s = max(0.05, min(1.0, speed))
        self._call(
            "ptz_service",
            f"<tptz:GotoPreset><tptz:ProfileToken>{escape(self.profile_token)}</tptz:ProfileToken>"
            f"<tptz:PresetToken>{escape(token)}</tptz:PresetToken>"
            f'<tptz:Speed><tt:PanTilt x="{s:.2f}" y="{s:.2f}"/></tptz:Speed></tptz:GotoPreset>',
        )

    def set_preset(self, name: str) -> str:
        text = self._call(
            "ptz_service",
            f"<tptz:SetPreset><tptz:ProfileToken>{escape(self.profile_token)}</tptz:ProfileToken>"
            f"<tptz:PresetName>{escape(name)}</tptz:PresetName></tptz:SetPreset>",
        )
        m = re.search(r"<(?:\w+:)?PresetToken>(.*?)</", text, re.S)
        return m.group(1) if m else ""

    def close(self) -> None:
        with self._lock:
            self._cancel_timer()
        self._client.close()

    # ── ichki ────────────────────────────────────────────────────────────────
    def _send_stop(self) -> None:
        self._call(
            "ptz_service",
            f"<tptz:Stop><tptz:ProfileToken>{escape(self.profile_token)}</tptz:ProfileToken>"
            "<tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>",
        )

    def _cancel_timer(self) -> None:
        # Har bekor qilishda avlod raqami oshadi: eski taymer ishga tushib qolsa ham,
        # yangi harakatni to'xtatmaydi.
        self._gen += 1
        if self._stop_timer:
            self._stop_timer.cancel()
            self._stop_timer = None

    def _auto_stop(self, gen: int) -> None:
        with self._lock:
            if gen != self._gen:
                return
            self._stop_timer = None
            try:
                self._send_stop()
            except PTZError:
                pass
