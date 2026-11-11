"""FastAPI router: video oqimi, surat va PTZ boshqaruvi uchun HTTP API.

Ulash:
    app.include_router(create_camera_router(stream, ptz), prefix="/camera")

Endpointlar (prefix="/camera" bo'lsa):
    GET  /camera/                tayyor veb sahifa (video + yo'nalish tugmalari)
    GET  /camera/stream          MJPEG jonli video (<img src="/camera/stream">)
    GET  /camera/snapshot.jpg    bitta kadr (JPEG)
    GET  /camera/status          ulanish holati
    POST /camera/ptz/move        {"direction": "left", "speed": 0.5, "duration": 1.0}
                                 yoki {"pan": -0.5, "tilt": 0.2, "zoom": 0, "duration": 1.0}
    POST /camera/ptz/stop
    GET  /camera/ptz/presets
    POST /camera/ptz/presets               {"name": "Eshik"}
    POST /camera/ptz/presets/{token}/goto
"""
from __future__ import annotations

from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from .ptz import PTZController, PTZError
from .stream import CameraStream

STATIC = Path(__file__).resolve().parent / "static"
NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"}

Direction = Literal["left", "right", "up", "down", "up_left", "up_right", "down_left", "down_right"]


class MoveRequest(BaseModel):
    direction: Optional[Direction] = None
    pan: float = Field(0.0, ge=-1, le=1)
    tilt: float = Field(0.0, ge=-1, le=1)
    zoom: float = Field(0.0, ge=-1, le=1)
    speed: float = Field(0.5, gt=0, le=1)
    duration: Optional[float] = Field(1.0, gt=0, le=10, description="Shuncha soniyadan keyin avtomatik to'xtaydi")


class PresetRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)


def create_camera_router(
    stream: CameraStream,
    ptz: Optional[PTZController] = None,
    *,
    fps: float = 15,
    ptz_lens: int = 0,
) -> APIRouter:
    """ptz_lens: ko'p linzali kamerada qaysi linza buriladi (0 dan boshlab)."""
    router = APIRouter(tags=["camera"])

    def need_ptz() -> PTZController:
        if ptz is None:
            raise HTTPException(404, "PTZ sozlanmagan")
        return ptz

    def run(fn, *args, **kw):
        try:
            return fn(*args, **kw)
        except PTZError as e:
            raise HTTPException(502, f"Kamera PTZ xatosi: {e}") from e

    @router.get("/", include_in_schema=False)
    def page():
        return FileResponse(STATIC / "camera.html", headers=NO_CACHE)

    def check_lens(lens: Optional[int]) -> Optional[int]:
        if lens is not None and not 0 <= lens < stream.lenses:
            raise HTTPException(400, f"lens 0..{stream.lenses - 1} oralig'ida bo'lishi kerak")
        return lens

    @router.get("/stream")
    def video_stream(lens: Optional[int] = None):
        """MJPEG jonli video. lens bo'lmasa butun kadr, lens=0/1/2 bitta linza."""
        return StreamingResponse(
            stream.mjpeg(fps, lens=check_lens(lens)),
            media_type="multipart/x-mixed-replace; boundary=frame",
            headers=NO_CACHE,
        )

    @router.get("/snapshot.jpg")
    def snapshot(lens: Optional[int] = None):
        jpeg = stream.get_jpeg(timeout=8, lens=check_lens(lens))
        if jpeg is None:
            raise HTTPException(503, stream.last_error or "Kameradan kadr kelmadi")
        return Response(jpeg, media_type="image/jpeg", headers=NO_CACHE)

    @router.get("/status")
    def status():
        # ptz_lens: buriladigan linza raqami (CP-159-1 da faqat yuqoridagi, 0)
        return {"video": stream.status(), "ptz": ptz is not None, "ptz_lens": ptz_lens}

    @router.post("/ptz/move")
    def ptz_move(req: MoveRequest):
        p = need_ptz()
        if req.direction:
            run(p.move_direction, req.direction, req.speed, req.duration)
        else:
            run(p.move, req.pan, req.tilt, req.zoom, req.duration)
        return {"ok": True}

    @router.post("/ptz/stop")
    def ptz_stop():
        run(need_ptz().stop)
        return {"ok": True}

    @router.get("/ptz/presets")
    def ptz_presets():
        return run(need_ptz().get_presets)

    @router.post("/ptz/presets")
    def ptz_set_preset(req: PresetRequest):
        return {"token": run(need_ptz().set_preset, req.name)}

    @router.post("/ptz/presets/{token}/goto")
    def ptz_goto_preset(token: str, speed: float = 0.5):
        run(need_ptz().goto_preset, token, speed)
        return {"ok": True}

    return router
