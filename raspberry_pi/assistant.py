"""
=============================================================================
QALQON: Ovozli yordamchi (savol-javob) - lex.uz bazasi asosida
=============================================================================
Oqim: savol (matn) -> bazadan eng mos moddalar -> Gemini (faqat shu moddalardan javob) -> Sardor ovozi (mp3)

Qoidalar:
  1. Javob FAQAT topilgan manbalardan. Manba topilmasa Gemini chaqirilmaydi, "bazada topilmadi" javobi qaytadi.
  2. Har javob modda raqami bilan, manbalar ro'yxati (hujjat, modda, havola) alohida qaytariladi.
  3. Gemini kaliti faqat shu Pi da (QALQON_GEMINI_API_KEY). Kalit yo'q bo'lsa, topilgan modda matni to'g'ridan-to'g'ri qaytariladi.
  4. Yoqish/o'chirish holati Pi da saqlanadi va telemetriya orqali monitorga (planshetga) tarqaladi: admin paneldan ham boshqariladi.
  5. Ovoz yozib saqlanmaydi. Savol matni jurnalga yozilmaydi (faqat vaqt va natija).

Muhit o'zgaruvchilari:
  QALQON_GEMINI_API_KEY   Gemini API kaliti (Google AI Studio)
  QALQON_GEMINI_MODEL     Model nomi (standart: gemini-2.5-flash; ai.google.dev da joriy nomni tekshiring)
  QALQON_KNOWLEDGE        Bilim bazasi fayli (standart: knowledge/lex_chunks.json)
=============================================================================
"""

import asyncio
import hashlib
import json
import math
import os
import re
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
KNOWLEDGE_PATH = os.environ.get("QALQON_KNOWLEDGE", os.path.join(BASE_DIR, "knowledge", "lex_chunks.json"))
STATE_PATH = os.environ.get("QALQON_ASSISTANT_STATE", os.path.join(tempfile.gettempdir(), "qalqon_assistant_state.json"))
AUDIO_DIR = os.path.join(tempfile.gettempdir(), "qalqon_tts")
TTS_VOICE = "uz-UZ-SardorNeural"
NOT_FOUND = "Bu savolga bazamda javob topa olmadim."
DISCLAIMER = "Bu ma'lumot, yuridik maslahat emas."
MIN_SCORE = float(os.environ.get("QALQON_MIN_SCORE", 0.2))
TOP_K = 6

# ---------------------------------------------------------------------- matnni normallashtirish
_CYR = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "j", "з": "z", "и": "i", "й": "y",
    "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
    "х": "x", "ц": "ts", "ч": "ch", "ш": "sh", "ъ": "'", "ь": "", "ы": "i", "э": "e", "ю": "yu", "я": "ya",
    "ў": "o'", "қ": "q", "ғ": "g'", "ҳ": "h",
}
_APOS = re.compile(r"[‘’ʻʼ`´′]")


def normalize(text: str) -> str:
    """Kichik harf, kirill -> lotin, bir xil apostrof, tinish belgilarisiz"""
    t = _APOS.sub("'", text.lower())
    t = "".join(_CYR.get(ch, ch) for ch in t)
    t = re.sub(r"[^a-z0-9'\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def to_latin(text: str) -> str:
    """Kirill -> lotin, bosh harflar va tinish belgilari saqlanadi. Sardor ovozi faqat lotin yozuvini o'qiy oladi"""
    out = []
    for ch in text:
        low = ch.lower()
        if low in _CYR:
            rep = _CYR[low]
            out.append(rep[:1].upper() + rep[1:] if ch != low and rep else rep)
        else:
            out.append(_APOS.sub("'", ch))
    return "".join(out)


def _grams(text: str, sizes=(3, 4)) -> Counter:
    """So'z chegarasi belgili n-gramlar: o'zbek tilidagi qo'shimchalarga chidamli (kitob, kitobning, kitoblar...)"""
    out: Counter = Counter()
    for w in normalize(text).split():
        padded = f"_{w}_"
        for n in sizes:
            if len(padded) < n:
                continue
            for i in range(len(padded) - n + 1):
                out[padded[i:i + n]] += 1
    return out


# ---------------------------------------------------------------------- qidiruv
class Retriever:
    def __init__(self, chunks: List[Dict[str, Any]]):
        self.chunks = chunks
        self.index: Dict[str, List[tuple]] = defaultdict(list)
        n = max(1, len(chunks))
        df: Counter = Counter()
        tfs = []
        for c in chunks:
            tf = _grams(f"{c.get('title', '')} {c.get('article', '')} {c['text']}")
            tfs.append(tf)
            df.update(tf.keys())
        self.idf = {g: math.log((n + 1) / (d + 1)) + 1.0 for g, d in df.items()}
        for i, tf in enumerate(tfs):
            vec = {g: (1 + math.log(f)) * self.idf[g] for g, f in tf.items()}
            norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
            for g, v in vec.items():
                self.index[g].append((i, v / norm))

    def search(self, query: str, k: int = TOP_K, min_score: float = MIN_SCORE) -> List[Dict[str, Any]]:
        tf = _grams(query)
        qvec = {g: (1 + math.log(f)) * self.idf[g] for g, f in tf.items() if g in self.idf}
        if not qvec:
            return []
        norm = math.sqrt(sum(v * v for v in qvec.values())) or 1.0
        scores: Dict[int, float] = defaultdict(float)
        for g, v in qvec.items():
            for i, w in self.index.get(g, ()):
                scores[i] += (v / norm) * w
        ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:k]
        return [{**self.chunks[i], "score": round(s, 3)} for i, s in ranked if s >= min_score]


def load_chunks(path: str = KNOWLEDGE_PATH) -> List[Dict[str, Any]]:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return [c for c in data if isinstance(c, dict) and c.get("text")]
    except FileNotFoundError:
        return []
    except Exception as exc:  # noqa: BLE001
        print(f"[Yordamchi] Bilim bazasini o'qib bo'lmadi: {exc}")
        return []


# ---------------------------------------------------------------------- Gemini
SYSTEM_PROMPT = (
    "Sen QALQON patrul robotining yordamchisisan. Foydalanuvchi savoliga FAQAT quyida berilgan lex.uz manbalaridan "
    "foydalanib, o'zbek tilida (lotin yozuvida) javob ber. Javob ovoz bilan o'qiladi: 2-4 qisqa, oddiy gap yoz, "
    "ro'yxat, belgilar va markdown ishlatma. Har bir fakt uchun qaysi hujjat va nechanchi moddadan ekanini ayt. "
    "Manbalarda javob bo'lmasa yoki manbalar savolga aloqasiz bo'lsa, aynan shu gapni yoz: "
    f"\"{NOT_FOUND}\" Hech qachon manbada yo'q narsani o'ylab topma. Yuridik maslahat berma, faqat qonun matnini tushuntir."
)


def call_gemini(prompt: str, api_key: str, model: str, timeout: float = 25.0, system: str = "", max_tokens: int = 500) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    body = {
        "systemInstruction": {"parts": [{"text": system or SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": max_tokens},
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    parts = data["candidates"][0]["content"]["parts"]
    return "".join(p.get("text", "") for p in parts).strip()


REWRITE_SYSTEM = (
    "Foydalanuvchi savolini O'zbekiston qonunchiligi bazasida qidirish uchun 6-10 ta kalit so'z yoki rasmiy huquqiy atamaga "
    "aylantir (o'zbek lotin yozuvida, vergul bilan). Oddiy so'zlarni qonuniy atamaga almashtir (masalan 'o'g'irlik' -> 'o'g'rilik'). "
    "Faqat kalit so'zlarni yoz, boshqa hech narsa yozma."
)


def rewrite_query(question: str, api_key: str, model: str) -> str:
    return call_gemini(question, api_key, model, timeout=10.0, system=REWRITE_SYSTEM, max_tokens=80)


def build_prompt(question: str, hits: List[Dict[str, Any]]) -> str:
    blocks = []
    for i, h in enumerate(hits, 1):
        blocks.append(f"[{i}] {h.get('title', '')}, {h.get('article', '')}\n{h['text']}")
    return "MANBALAR:\n\n" + "\n\n".join(blocks) + f"\n\nSAVOL: {question}"


def clean_for_speech(text: str) -> str:
    t = re.sub(r"[*_#`>\[\]]", "", text)
    return re.sub(r"\s+", " ", t).strip()


# ---------------------------------------------------------------------- Sardor ovozi (edge-tts)
async def synthesize(text: str) -> Optional[str]:
    """Matnni uz-UZ-SardorNeural ovozida mp3 ga aylantiradi. Muvaffaqiyatli bo'lsa fayl identifikatorini qaytaradi"""
    try:
        import edge_tts  # type: ignore
    except ImportError:
        return None
    try:
        os.makedirs(AUDIO_DIR, exist_ok=True)
        aid = hashlib.sha1(f"{TTS_VOICE}|{text}".encode("utf-8")).hexdigest()[:20]
        path = os.path.join(AUDIO_DIR, f"{aid}.mp3")
        if not os.path.exists(path):
            await asyncio.wait_for(edge_tts.Communicate(text, TTS_VOICE).save(path), timeout=20)
        _cleanup_audio()
        return aid
    except Exception as exc:  # noqa: BLE001
        print(f"[Yordamchi] Ovoz sintezi xatosi: {exc}")
        return None


def _cleanup_audio(keep: int = 30):
    try:
        files = sorted(
            (os.path.join(AUDIO_DIR, f) for f in os.listdir(AUDIO_DIR) if f.endswith(".mp3")),
            key=os.path.getmtime,
            reverse=True,
        )
        for old in files[keep:]:
            os.remove(old)
    except OSError:
        pass


def audio_path(aid: str) -> Optional[str]:
    if not re.fullmatch(r"[0-9a-f]{20}", aid):
        return None
    p = os.path.join(AUDIO_DIR, f"{aid}.mp3")
    return p if os.path.exists(p) else None


# ---------------------------------------------------------------------- yordamchi
class Assistant:
    def __init__(self, chunks: Optional[List[Dict[str, Any]]] = None):
        self.api_key = os.environ.get("QALQON_GEMINI_API_KEY", "").strip()
        self.model = os.environ.get("QALQON_GEMINI_MODEL", "gemini-2.5-flash").strip()
        self.lock = threading.Lock()
        self.busy = False
        self.last_ask_t = 0.0
        self.last_result: Optional[Dict[str, Any]] = None
        self.kb_ready = False
        self.retriever = Retriever([])
        if chunks is not None:
            self.reload(chunks)
        else:
            # Katta bazani indekslash Pi da yarim minutgacha olishi mumkin: server tez ishga tushishi uchun fonda
            threading.Thread(target=self.reload, daemon=True).start()
        self.enabled = self._load_state()

    def reload(self, chunks: Optional[List[Dict[str, Any]]] = None):
        self.retriever = Retriever(chunks if chunks is not None else load_chunks())
        self.kb_ready = True

    # holat (yoqish/o'chirish) Pi qayta ishga tushganda ham saqlanadi
    def _load_state(self) -> bool:
        try:
            with open(STATE_PATH, encoding="utf-8") as f:
                return bool(json.load(f).get("enabled", False))
        except Exception:  # noqa: BLE001
            return False

    def set_enabled(self, on: bool):
        self.enabled = bool(on)
        try:
            with open(STATE_PATH, "w", encoding="utf-8") as f:
                json.dump({"enabled": self.enabled}, f)
        except OSError:
            pass

    def status(self) -> Dict[str, Any]:
        last = self.last_result
        return {
            "enabled": self.enabled,
            "wake_word": "qalqon",
            "kb_chunks": len(self.retriever.chunks),
            "kb_ready": self.kb_ready,
            "llm": bool(self.api_key),
            "busy": self.busy,
            "last": {"t": last["t"], "found": last["found"]} if last else None,
        }

    async def ask(self, question: str) -> Dict[str, Any]:
        q = (question or "").strip()[:500]
        if len(q) < 3:
            return {"status": "error", "message": "Savol juda qisqa"}
        if not self.kb_ready:
            return {"status": "busy", "message": "Bilim bazasi yuklanmoqda, birozdan keyin urinib ko'ring"}
        now = time.time()
        with self.lock:
            if self.busy:
                return {"status": "busy", "message": "Oldingi savolga javob tayyorlanmoqda"}
            if now - self.last_ask_t < 1.0:
                return {"status": "busy", "message": "Juda tez-tez so'ralmoqda"}
            self.busy = True
            self.last_ask_t = now
        try:
            hits = self.retriever.search(q)
            if self.api_key and os.environ.get("QALQON_QUERY_REWRITE", "1") != "0":
                # Oddiy so'zlarni qonuniy atamaga o'zgartirib, ikkinchi marta qidiramiz (xato bo'lsa e'tiborga olinmaydi)
                try:
                    kw = await asyncio.get_running_loop().run_in_executor(None, rewrite_query, q, self.api_key, self.model)
                    merged = {h["id"]: h for h in hits}
                    for h in self.retriever.search(kw):
                        if h["id"] not in merged or h["score"] > merged[h["id"]]["score"]:
                            merged[h["id"]] = h
                    hits = sorted(merged.values(), key=lambda h: h["score"], reverse=True)[:TOP_K]
                except Exception as exc:  # noqa: BLE001
                    print(f"[Yordamchi] So'rovni qayta yozish o'tkazib yuborildi: {exc}")
            found = bool(hits)
            if not hits:
                answer = NOT_FOUND
            elif self.api_key:
                try:
                    answer = await asyncio.get_running_loop().run_in_executor(
                        None, call_gemini, build_prompt(q, hits), self.api_key, self.model
                    )
                except (urllib.error.URLError, TimeoutError, KeyError, IndexError, ValueError) as exc:
                    print(f"[Yordamchi] Gemini xatosi: {exc}")
                    return {"status": "llm_error", "message": "Javob tayyorlab bo'lmadi: internet yoki Gemini bilan aloqa yo'q"}
            else:
                # Kalit yo'q: eng mos modda matni (qisqartirilgan) to'g'ridan-to'g'ri o'qiladi
                top = hits[0]
                answer = f"{top.get('title', '')}, {top.get('article', '')}. {top['text'][:350]}"
            answer = to_latin(clean_for_speech(answer))
            if answer.startswith(NOT_FOUND):
                found = False
            sources = (
                [{"title": h.get("title", ""), "article": h.get("article", ""), "url": h.get("url", ""), "score": h["score"]} for h in hits]
                if found
                else []
            )
            audio_id = await synthesize(answer)
            result = {
                "status": "ok",
                "answer": answer,
                "found": found,
                "sources": sources,
                "disclaimer": DISCLAIMER if found else "",
                "audio_url": f"/api/assistant/audio/{audio_id}" if audio_id else None,
                "t": time.time(),
            }
            self.last_result = result
            return result
        finally:
            self.busy = False


# ---------------------------------------------------------------------- FastAPI yo'llari
def install_routes(app, assistant: Assistant):
    from fastapi import Request
    from fastapi.responses import FileResponse, JSONResponse

    @app.post("/api/assistant/ask")
    async def assistant_ask(request: Request):
        try:
            payload = await request.json()
        except Exception:  # noqa: BLE001
            return JSONResponse({"status": "error", "message": "JSON kutilgan"}, status_code=400)
        res = await assistant.ask(str(payload.get("q", "")))
        code = 200 if res.get("status") == "ok" else (429 if res.get("status") == "busy" else 502 if res.get("status") == "llm_error" else 400)
        return JSONResponse(res, status_code=code)

    @app.get("/api/assistant/status")
    def assistant_status():
        return assistant.status()

    @app.get("/api/assistant/enable")
    def assistant_enable(on: int = 1):
        assistant.set_enabled(bool(on))
        return assistant.status()

    @app.get("/api/assistant/audio/{aid}")
    def assistant_audio(aid: str):
        p = audio_path(aid)
        if not p:
            return JSONResponse({"status": "error", "message": "Audio topilmadi"}, status_code=404)
        return FileResponse(p, media_type="audio/mpeg")
