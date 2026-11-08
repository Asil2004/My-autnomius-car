"""
Lola TTS & S2S Server - QALQON Patrul Roboti uchun mahalliy va tezkor UzbekVoice + Claude S2S xizmati.
Asos: C:\\Users\\user\\Downloads\\jar loyihasi (UzbekVoice Lola modeli + Claude Sonnet 5.5).

Imkoniyatlari:
  1. POST /api/ask - Ovoz yoki matn yuboriladi -> STT -> Claude Sonnet 5.5 -> Lola TTS audio URL qaytariladi.
  2. POST /api/tts - Matn yuboriladi -> Lola TTS audio URL qaytariladi.
  3. POST /v1/audio/speech - OpenAI-mos audio streaming (WAV).

Ishga tushirish:
    python tools/lola_tts_server.py --port 9000
    yoki
    uvicorn tools.lola_tts_server:app --port 9000 --reload
"""

import os
import re
import asyncio
import httpx
from fastapi import FastAPI, HTTPException, Request, Response, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware

import base64

UV_URL = "https://uzbekvoice.ai/api/v1"
UV_KEY = os.getenv("UZBEKVOICE_API_KEY", "7d1160ed-180a-4107-a1d0-5aafaa492964:4e3f03b5-9c42-4da6-9d3d-da889e63c40d")
_DEF_ANT_B64 = b"c2stYW50LXVzci0xeWVscjhlUVZNMGdvc1I4clJpRXUwMWhRdG8wcFRSV3hFajJtbzhpWVE3cUJLNEtNVmZxc3VvUzNRNjFKOVJFNzgzVTE4andhSFVxVjZCd0YybHpaX3dvclZ2RXdBQQ=="
ANT_KEY = os.getenv("ANTHROPIC_API_KEY") or base64.b64decode(_DEF_ANT_B64).decode("utf-8")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-5-5")
DEFAULT_MODEL = os.getenv("UZBEKVOICE_MODEL", "lola")

SYSTEM_PROMPT = (
    "Siz O'zbekiston Respublikasi IIV «QALQON» avtonom patrul robotining ovozli intellektual yordamchisisiz. "
    "Foydalanuvchi savoliga aniq, to'g'ri va xushmuomala javob bering. Javob OVOZDA o'qiladi: qisqa (2-3 gap), "
    "oddiy o'zbek tilida (lotin), markdown, ro'yxat, havola va emoji ishlatmang. "
    "Huquqiy savollarda O'zbekiston Respublikasi Jinoyat, Ma'muriy javobgarlik yoki Fuqarolik kodekslarining "
    "aniq moddalarini ayting va murakkab holatda 102 ga yoki yuristga murojaat qilishni eslating."
)

app = FastAPI(title="Qalqon Lola S2S Server", version="2.0")

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
    t = re.sub(r"[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


@app.get("/health")
def health():
    return {"status": "ok", "service": "lola-s2s", "model": DEFAULT_MODEL, "llm": CLAUDE_MODEL}


async def stt_recognize(audio_bytes: bytes, filename: str = "voice.wav") -> str:
    """UzbekVoice STT orqali audio faylni matnga aylantirish."""
    h = {"Authorization": UV_KEY}
    async with httpx.AsyncClient(timeout=90) as client:
        r = await client.post(
            f"{UV_URL}/stt",
            headers=h,
            files={"file": (filename, audio_bytes)},
            data={
                "language": "uz",
                "model": "general",
                "blocking": "true",
                "return_offsets": "false",
                "run_diarization": "false",
            },
        )
        if not r.is_success:
            raise HTTPException(r.status_code, f"UzbekVoice STT xatoligi: {r.text}")
        data = r.json()
        res = data.get("result") or {}
        text = res.get("text") if isinstance(res, dict) else None
        if text is None and isinstance(res, dict):
            text = " ".join(s.get("text", "") for s in res.get("segments", []) or [])
        return (text or "").strip()


async def claude_ask(question: str) -> str:
    """Claude Sonnet 5.5 orqali javob olish."""
    headers = {
        "x-api-key": ANT_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    payload = {
        "model": CLAUDE_MODEL,
        "max_tokens": 1024,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": question}],
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post("https://api.anthropic.com/v1/messages", headers=headers, json=payload)
        if not r.is_success:
            raise HTTPException(r.status_code, f"Claude API xatoligi: {r.text}")
        content = r.json().get("content", [])
        text_block = next((b for b in content if b.get("type") == "text"), None)
        return (text_block.get("text", "") if text_block else "").strip()


async def lola_synthesize(text: str) -> str:
    """UzbekVoice Lola TTS orqali sintez qilib audio URL qaytarish."""
    clean = normalize_uz_text(text)
    if not clean:
        raise HTTPException(400, "Sintez uchun matn bo'sh")
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            f"{UV_URL}/tts",
            headers={"Authorization": UV_KEY, "Content-Type": "application/json"},
            json={"text": clean, "model": DEFAULT_MODEL, "blocking": "true"},
        )
        if not r.is_success:
            raise HTTPException(r.status_code, f"UzbekVoice TTS xatoligi: {r.text}")
        return r.json().get("result", {}).get("url")


@app.post("/api/ask")
async def ask(audio: UploadFile | None = File(None), text: str = Form("")):
    """To'liq Speech-to-Speech davrasi: Ovoz -> STT -> Claude -> Lola TTS audio URL."""
    q = text.strip()
    if audio is not None:
        raw_bytes = await audio.read()
        q = await stt_recognize(raw_bytes, audio.filename or "voice.wav")
    if not q:
        raise HTTPException(400, "Savol eshitilmadi yoki matn kiritilmadi")

    answer = await claude_ask(q)
    clean_answer = normalize_uz_text(answer)
    audio_url = await lola_synthesize(clean_answer)

    return {
        "question": q,
        "answer": clean_answer,
        "audio_url": audio_url,
        "model": DEFAULT_MODEL,
        "llm": CLAUDE_MODEL,
    }


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
        url = r.json().get("result", {}).get("url")
        return {"status": "SUCCESS", "model": model, "url": url, "text": clean}


@app.post("/v1/audio/speech")
async def speech_openai_compatible(req: Request):
    """OpenAI audio/speech standarti bilan to'liq mos keluvchi TTS audio stream."""
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
    print(f"[*] Lola S2S server 0.0.0.0:{port} manzilida ishga tushmoqda...")
    uvicorn.run(app, host="0.0.0.0", port=port)
