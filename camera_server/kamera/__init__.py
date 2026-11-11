"""IP kamera moduli: RTSP video + ONVIF PTZ (yo'nalishni boshqarish).

Tez boshlash:
    from kamera import camera_from_env, create_camera_router
    stream, ptz = camera_from_env()
    app.include_router(create_camera_router(stream, ptz), prefix="/camera")
"""
from __future__ import annotations

import os

from .ptz import DIRECTIONS, PTZController, PTZError
from .stream import CameraStream

__all__ = [
    "CameraStream",
    "PTZController",
    "PTZError",
    "DIRECTIONS",
    "camera_from_env",
    "create_camera_router",
]


def create_camera_router(*args, **kwargs):
    """FastAPI router yaratadi (fastapi faqat shu yerda kerak bo'ladi)."""
    from .router import create_camera_router as _create

    return _create(*args, **kwargs)


def _flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes", "ha")


def camera_from_env() -> tuple[CameraStream, PTZController]:
    """Sozlamalarni muhit o'zgaruvchilaridan (.env) o'qiydi.

    CAMERA_HOST         192.168.1.100
    CAMERA_RTSP_URL     rtsp://<host>:554/live/ch00_0
    CAMERA_ONVIF_PORT   8899
    CAMERA_USER / CAMERA_PASSWORD   (ixtiyoriy)
    CAMERA_MAX_WIDTH    1280  (brauzerga beriladigan kenglik, 0 = asl o'lcham)
    CAMERA_JPEG_QUALITY 80
    CAMERA_LENSES       0  (0 = avtomatik; kadrdagi ustma-ust linzalar soni)
    CAMERA_INVERT_PAN / CAMERA_INVERT_TILT   1 = yo'nalishni teskari qilish
    """
    host = os.getenv("CAMERA_HOST", "192.168.1.100")
    rtsp = os.getenv("CAMERA_RTSP_URL", f"rtsp://{host}:554/live/ch00_0")
    max_w = int(os.getenv("CAMERA_MAX_WIDTH", "1280")) or None
    stream = CameraStream(
        rtsp,
        max_width=max_w,
        jpeg_quality=int(os.getenv("CAMERA_JPEG_QUALITY", "80")),
        lenses=int(os.getenv("CAMERA_LENSES", "0")),
    )
    ptz = PTZController(
        host,
        int(os.getenv("CAMERA_ONVIF_PORT", "8899")),
        os.getenv("CAMERA_USER", ""),
        os.getenv("CAMERA_PASSWORD", ""),
        invert_pan=_flag("CAMERA_INVERT_PAN"),
        invert_tilt=_flag("CAMERA_INVERT_TILT"),
    )
    return stream, ptz
