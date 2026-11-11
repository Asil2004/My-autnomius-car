"""QALQON kamera serveri: CP-159-1 (V380) uch linzali kamera.

  lens=0  PTZ (buriladigan) linza      -> HUD "PTZ" oynasi, joystik bilan boshqariladi
  lens=1  o'ngga qaragan linza         -> HUD "O'ng" oynasi
  lens=2  chapga qaragan linza         -> HUD "Chap" oynasi

Ishga tushirish (camera_server papkasida):
    powershell -ExecutionPolicy Bypass -File start.ps1
yoki qo'lda:
    uvicorn main:app --host 0.0.0.0 --port 8090

HUD (Sozlamalar -> PTZ kamera moduli) standart manzili: http://localhost:8090/camera
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

try:  # .env fayli bo'lsa o'qiladi (ixtiyoriy)
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

from kamera import camera_from_env, create_camera_router

stream, ptz = camera_from_env()


@asynccontextmanager
async def lifespan(app: FastAPI):
    stream.start()  # video oqimi server bilan birga boshlanadi
    yield
    stream.stop()
    ptz.close()


app = FastAPI(title="QALQON kamera", lifespan=lifespan)

# HUD boshqa manzildan ochiladi (localhost:5173, GitHub Pages, Capacitor APK): burish buyruqlari (POST, JSON)
# uchun CORS kerak. Ruxsat etilgan manzillarni CAMERA_CORS_ORIGINS bilan cheklash mumkin (vergul bilan).
_origins = [o.strip() for o in os.getenv("CAMERA_CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def private_network_access(request: Request, call_next):
    """Chrome: https sahifadan (GitHub Pages) lokal tarmoqdagi serverga so'rov uchun ruxsat sarlavhasi."""
    response = await call_next(request)
    if request.headers.get("access-control-request-private-network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


app.include_router(
    create_camera_router(stream, ptz, ptz_lens=int(os.getenv("CAMERA_PTZ_LENS", "0"))),
    prefix="/camera",
)


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/camera/")
