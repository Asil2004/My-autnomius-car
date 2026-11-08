"""
Lola TTS Server - QALQON Patrul Roboti uchun mahalliy va tezkor UzbekVoice TTS xizmati.
Asos: C:\\Users\\user\\Downloads\\jar loyihasi (UzbekVoice Lola modeli).

Ishga tushirish:
    python tools/lola_tts_server.py --port 9000
    yoki
    uvicorn tools.lola_tts_server:app --port 9000 --reload
"""

import os
import re
import asyncio
import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware

UV_URL = "https://uzbekvoice.ai/api/v1"
UV_KEY = os.getenv("UZBEKVOICE_API_KEY", "7d1160ed-180a-4107-a1d0-5aafaa492964:4e3f03b5-9c42-4da6-9d3d-da889e63c40d")
DEFAULT_MODEL = os.getenv("UZBEKVOICE_MODEL", "lola")

app = FastAPI(title="Qalqon Lola TTS Server", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def normalize_uz_text(text: str) -> str:
    """Markdown, URL, keraksiz belgilar va apostroflarni tozalash (jar/lola qoidalari)."""
    t = re.sub(r"[*_#`>~\[\]()]+", " ", text)
    t = re.sub(r"https?://\S+", "", t)
    t = re.sub(r"['`’‘]", "'", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


@app.get("/health")
def health():
    return {"status": "ok", "service": "lola-tts", "model": DEFAULT_MODEL}


@app.post("/api/tts")
async def tts(req: Request):
    """Matnni UzbekVoice Lola TTS orqali sintez qilib audio URL qaytarish."""
    data = await req.json()
    raw = data.get("text", "")
    model = data.get("model", DEFAULT_MODEL)
    clean = normalize_uz_text(raw)
    if not clean:
        raise HTTPException(400, "Matn bo'sh")

    auth = req.headers.get("Authorization") or UV_KEY
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            f"{UV_URL}/tts",
            headers={"Authorization": auth, "Content-Type": "application/json"},
            json={"text": clean, "model": model, "blocking": "true"},
        )
        if not r.is_success:
            raise HTTPException(r.status_code, f"UzbekVoice TTS xatoligi: {r.text}")
        j = r.json()
        url = j.get("result", {}).get("url")
        return {"status": "SUCCESS", "model": model, "url": url, "text": clean}


@app.post("/v1/audio/speech")
async def speech_openai_compatible(req: Request):
    """OpenAI audio/speech standarti bilan to'liq mos keluvchi TTS stream."""
    data = await req.json()
    raw = data.get("input", "")
    model = data.get("model", DEFAULT_MODEL)
    clean = normalize_uz_text(raw)
    if not clean:
        raise HTTPException(400, "input bo'sh")

    auth = req.headers.get("Authorization")
    if auth and auth.startswith("Bearer "):
        auth = auth.replace("Bearer ", "").strip()
    if not auth:
        auth = UV_KEY

    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            f"{UV_URL}/tts",
            headers={"Authorization": auth, "Content-Type": "application/json"},
            json={"text": clean, "model": model, "blocking": "true"},
        )
        if not r.is_success:
            raise HTTPException(r.status_code, f"UzbekVoice xatosi: {r.text}")
        audio_url = r.json().get("result", {}).get("url")
        if not audio_url:
            raise HTTPException(502, "Audio URL topilmadi")

        audio_resp = await client.get(audio_url)
        return Response(content=audio_resp.content, media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn
    import sys
    port = 9000
    if "--port" in sys.argv:
        idx = sys.argv.index("--port")
        if idx + 1 < len(sys.argv):
            port = int(sys.argv[idx + 1])
    print(f"[*] Lola TTS server 0.0.0.0:{port} manzilida ishga tushmoqda...")
    uvicorn.run(app, host="0.0.0.0", port=port)
