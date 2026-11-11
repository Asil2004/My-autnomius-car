"""RTSP video oqimini o'qish va brauzerga MJPEG/JPEG ko'rinishida berish.

Bitta fon oqimi (thread) kameradan kadrlarni o'qiydi va oxirgi kadrni xotirada
saqlaydi. Nechta brauzer ulanmasin, kameraga faqat bitta RTSP ulanish ochiladi.
Ulanish uzilsa, avtomatik qayta ulanadi.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Iterator, Optional

# RTSP'ni TCP orqali olish: UDP'da paketlar yo'qolib, oqim qotib qoladi.
# (cv2 import qilinishidan oldin o'rnatilishi shart)
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

import cv2  # noqa: E402

log = logging.getLogger(__name__)


class CameraStream:
    def __init__(
        self,
        rtsp_url: str,
        *,
        jpeg_quality: int = 80,
        max_width: Optional[int] = 1280,
        reconnect_delay: float = 2.0,
        timeout_ms: int = 10000,
        lenses: int = 0,
    ) -> None:
        """
        rtsp_url        kamera manzili, masalan rtsp://192.168.1.100:554/live/ch00_0
        jpeg_quality    brauzerga yuboriladigan JPEG sifati (1-100)
        max_width       kadr shundan keng bo'lsa kichraytiriladi (None = o'zgarmaydi)
        reconnect_delay uzilganda qayta ulanishdan oldingi kutish (soniya)
        timeout_ms      ulanish/o'qish uchun kutish chegarasi
        lenses          kadrda ustma-ust joylashgan linzalar soni. 0 = kadr nisbatidan
                        avtomatik (16:9 bo'laklar). CP-159-1: 1920x3240 = 3 x 1920x1080.
                        `lens=` parametri bilan bittasini alohida olish mumkin.
        """
        self.rtsp_url = rtsp_url
        self.jpeg_quality = jpeg_quality
        self.max_width = max_width
        self.reconnect_delay = reconnect_delay
        self.timeout_ms = timeout_ms
        self._lenses_cfg = max(0, lenses)

        self._cond = threading.Condition()
        self._frame = None
        self._frame_id = 0
        self._jpeg: dict[Optional[int], tuple[int, bytes]] = {}
        self._thread: Optional[threading.Thread] = None
        self._running = False

        self.connected = False
        self.last_error: Optional[str] = None
        self.width = 0
        self.height = 0
        self.last_frame_time = 0.0

    # ── boshqaruv ────────────────────────────────────────────────────────────
    def start(self) -> None:
        """Fon o'qishni boshlaydi (qayta chaqirish xavfsiz)."""
        with self._cond:
            if self._running:
                return
            self._running = True
            self._thread = threading.Thread(target=self._loop, name="CameraStream", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._running = False
        with self._cond:
            self._cond.notify_all()
        if self._thread:
            self._thread.join(timeout=self.timeout_ms / 1000 + 2)
            self._thread = None

    def status(self) -> dict:
        age = time.time() - self.last_frame_time if self.last_frame_time else None
        return {
            "running": self._running,
            "connected": self.connected and age is not None and age < 5,
            "width": self.width,
            "height": self.height,
            "lenses": self.lenses,
            "last_frame_age": round(age, 2) if age is not None else None,
            "error": self.last_error,
        }

    # ── kadrlar ──────────────────────────────────────────────────────────────
    @property
    def lenses(self) -> int:
        """Linzalar soni (sozlangan yoki kadr nisbatidan aniqlangan)."""
        if self._lenses_cfg:
            return self._lenses_cfg
        if not self.width or not self.height:
            return 1
        return max(1, round(self.height * 16 / (self.width * 9)))

    def _crop(self, frame, lens: Optional[int]):
        if lens is None or self.lenses <= 1:
            return frame
        if not 0 <= lens < self.lenses:
            raise ValueError(f"lens 0..{self.lenses - 1} oralig'ida bo'lishi kerak")
        h = frame.shape[0] // self.lenses
        return frame[lens * h:(lens + 1) * h]

    def get_frame(self, timeout: float = 5.0, lens: Optional[int] = None):
        """Oxirgi kadrni OpenCV (numpy BGR) ko'rinishida qaytaradi yoki None.

        O'z tahlilingiz (masalan, obyekt aniqlash) uchun shu kadrdan foydalaning.
        lens: None = butun kadr, 0/1/2 = bitta linza.
        """
        self.start()
        with self._cond:
            if self._frame is None:
                self._cond.wait_for(lambda: self._frame is not None or not self._running, timeout)
            return None if self._frame is None else self._crop(self._frame, lens).copy()

    def get_jpeg(self, timeout: float = 5.0, lens: Optional[int] = None) -> Optional[bytes]:
        """Oxirgi kadrni JPEG baytlari ko'rinishida qaytaradi (keshlanadi)."""
        self.start()
        with self._cond:
            if self._frame is None:
                self._cond.wait_for(lambda: self._frame is not None or not self._running, timeout)
            if self._frame is None:
                return None
            cached = self._jpeg.get(lens)
            if cached and cached[0] == self._frame_id:
                return cached[1]
            frame, fid = self._crop(self._frame, lens), self._frame_id
        jpeg = self._encode(frame)
        with self._cond:
            cached = self._jpeg.get(lens)
            if not cached or fid >= cached[0]:
                self._jpeg[lens] = (fid, jpeg)
        return jpeg

    def mjpeg(self, fps: float = 15.0, lens: Optional[int] = None) -> Iterator[bytes]:
        """Brauzer uchun multipart/x-mixed-replace (MJPEG) oqimi generatori."""
        self.start()
        interval = 1.0 / fps if fps > 0 else 0
        last_id = -1
        while self._running:
            t0 = time.monotonic()
            with self._cond:
                self._cond.wait_for(lambda: self._frame_id != last_id or not self._running, 5.0)
                if self._frame_id == last_id:
                    continue
                last_id = self._frame_id
            jpeg = self.get_jpeg(lens=lens)
            if jpeg is None:
                continue
            yield (
                b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                + str(len(jpeg)).encode()
                + b"\r\n\r\n"
                + jpeg
                + b"\r\n"
            )
            wait = interval - (time.monotonic() - t0)
            if wait > 0:
                time.sleep(wait)

    # ── ichki ────────────────────────────────────────────────────────────────
    def _encode(self, frame) -> bytes:
        h, w = frame.shape[:2]
        if self.max_width and w > self.max_width:
            nh = int(h * self.max_width / w)
            frame = cv2.resize(frame, (self.max_width, nh), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, self.jpeg_quality])
        if not ok:
            raise RuntimeError("JPEG kodlashda xato")
        return buf.tobytes()

    def _open(self):
        params = [
            cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, self.timeout_ms,
            cv2.CAP_PROP_READ_TIMEOUT_MSEC, self.timeout_ms,
        ]
        try:
            return cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG, params)
        except TypeError:  # eski OpenCV versiyalari params qabul qilmaydi
            return cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)

    def _loop(self) -> None:
        while self._running:
            cap = self._open()
            if not cap.isOpened():
                cap.release()
                self.connected = False
                self.last_error = f"RTSP ulanib bo'lmadi: {self.rtsp_url}"
                log.warning(self.last_error)
                time.sleep(self.reconnect_delay)
                continue

            self.connected = True
            self.last_error = None
            log.info("Kameraga ulandi: %s", self.rtsp_url)
            fails = 0
            while self._running:
                ok, frame = cap.read()
                if not ok or frame is None:
                    fails += 1
                    if fails >= 25:
                        self.last_error = "Video oqimi uzildi"
                        break
                    time.sleep(0.02)
                    continue
                fails = 0
                with self._cond:
                    self._frame = frame
                    self._frame_id += 1
                    self.height, self.width = frame.shape[:2]
                    self.last_frame_time = time.time()
                    self._cond.notify_all()

            cap.release()
            self.connected = False
            if self._running:
                log.warning("%s, %.0f s dan keyin qayta ulanadi", self.last_error, self.reconnect_delay)
                time.sleep(self.reconnect_delay)
