"""
assistant.py va knowledge/ingest_lex.py uchun sinovlar (internetsiz, soxta Gemini va TTS bilan).
Ishga tushirish:  python test_assistant.py
Diqqat: sinovdagi hujjatlar SOXTA ("SINOV QONUNI"), haqiqiy qonun matni emas.
"""
import asyncio
import os
import sys
import tempfile
import time
import urllib.error

os.environ["QALQON_ADMIN_TOKEN"] = "tok"
os.environ["QALQON_LOCAL_HOSTS"] = "127.0.0.1"
_tmp = tempfile.mkdtemp()
os.environ["QALQON_ASSISTANT_STATE"] = os.path.join(_tmp, "state.json")

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "knowledge"))
import assistant as A  # noqa: E402
import ingest_lex as I  # noqa: E402

passed = 0


def check(name, cond):
    global passed
    assert cond, f"FAIL: {name}"
    passed += 1
    print(f"ok  {name}")


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------- normallashtirish
check("kirill va lotin bir xil normallashadi", A.normalize("Қалқон Ўзбекистон") == A.normalize("Qalqon O'zbekiston"))
check("kirill javob lotinga o'giriladi (bosh harf saqlanadi)", A.to_latin("Ички ишлар Ўзбекистон, Шарт.") == "Ichki ishlar O'zbekiston, Sharт.".replace("т","t"))
check("apostrof variantlari birlashadi", A.normalize("o‘zbek") == A.normalize("o'zbek") == A.normalize("o`zbek"))

# ---------------------------------------------------------------- yuklash (soxta HTML)
HTML_LATIN = """<html><head><title>SINOV QONUNI: Piyodalar to'g'risida</title><script>var x=1;</script></head><body>
<h1>SINOV QONUNI</h1>
<p>1-bob. Umumiy qoidalar</p>
<p>1-modda. Piyodalar yo'lakdan o'tishi</p>
<p>Piyodalar yo'lakdan faqat svetofor yashil chiroq yoqilganda o'tishi shart.</p>
<p>2-modda. Mashinalarning to'xtashi</p>
<p>Haydovchi yo'lakka yaqinlashganda piyodalarga yo'l berishi va to'xtashi shart.</p>
<p>3-modda. Jarima miqdori</p>
<p>Qoidani buzgan shaxsga bazaviy hisoblash miqdorining yarmi miqdorida jarima solinadi.</p>
</body></html>"""
HTML_CYR = """<html><head><title>СИНОВ</title></head><body>
<p>5-модда. Ҳужжат билан таништириш</p><p>Фуқаро ўз ҳужжатини сўров бўйича кўрсатиши шарт.</p>
<p>6-модда. Ёрдам кўрсатиш</p><p>Ходим фуқарога зарур ёрдам кўрсатади.</p></body></html>"""
chunks = I.ingest_one("https://example.test/a", "SINOV QONUNI A", HTML_LATIN)
chunks += I.ingest_one("https://example.test/b", "SINOV QONUNI B", HTML_CYR)
check("modda bo'yicha bo'laklarga ajraladi", len(chunks) == 5)
check("modda nomi saqlanadi", any(c["article"].startswith("1-modda. Piyodalar") for c in chunks))
check("skript matni kirmaydi", not any("var x" in c["text"] for c in chunks))
check("kirill hujjat ham bo'laklanadi", sum(1 for c in chunks if c["url"].endswith("/b")) == 2)
check("id barqaror", chunks[0]["id"] == I.ingest_one("https://example.test/a", "x", HTML_LATIN)[0]["id"])
long = I.split_articles(["1-modda. Uzun", "so'z " * 600], "T", "u")
check("uzun modda bo'linadi", len(long) >= 2 and all(len(c["text"]) <= I.MAX_CHUNK for c in long))

# ---------------------------------------------------------------- qidiruv
R = A.Retriever(chunks)
top = R.search("piyodalar svetoforda qachon o'tishi kerak")
check("savolga mos modda topiladi", top and top[0]["article"].startswith("1-modda"))
top = R.search("haydovchi piyodani ko'rsa to'xtashi shartmi?")
check("qo'shimchali so'zlar bilan ham topiladi", top and top[0]["article"].startswith("2-modda"))
top = R.search("ҳужжатимни кўрсатишим керакми")
check("kirillcha savol kirillcha bazadan topadi", top and "5-modda" in top[0]["article"])
check("aloqasiz savolga javob yo'q", R.search("bugun ob-havo qanday bo'ladi, quyosh chiqadimi") == [])
check("bo'sh bazada xato bermaydi", A.Retriever([]).search("salom dunyo") == [])

# ---------------------------------------------------------------- Assistant (soxta Gemini va TTS)
calls = {"gemini": 0, "prompt": ""}


def fake_gemini(prompt, key, model, timeout=25.0, system="", max_tokens=500):
    if system:
        calls["rewrite"] = calls.get("rewrite", 0) + 1
        return "ob-havo, quyosh" if "ob-havo" in prompt else "piyodalar, svetofor, yo'lak"
    calls["gemini"] += 1
    calls["prompt"] = prompt
    return "SINOV QONUNI A, 1-modda: piyodalar faqat yashil chiroqda o'tadi. **Eslatma** [1]"


async def fake_tts(text):
    return "0123456789abcdef0123"


A.call_gemini = fake_gemini
A.synthesize = fake_tts
os.environ["QALQON_GEMINI_API_KEY"] = "fake"
asst = A.Assistant(chunks)
Q = "Piyodalar qachon yo'lakdan o'tishi kerak?"

res = run(asst.ask(Q))
check("javob muvaffaqiyatli", res["status"] == "ok" and res["found"])
check("so'rov qayta yozildi (kalit bor)", calls.get("rewrite", 0) >= 1)
check("Gemini ga faqat manbalar va savol beriladi", calls["gemini"] == 1 and "MANBALAR" in calls["prompt"] and "1-modda" in calls["prompt"])
check("manbalar ro'yxati qaytadi", res["sources"] and res["sources"][0]["url"] == "https://example.test/a")
check("belgilar ovoz uchun tozalanadi", "*" not in res["answer"] and "[" not in res["answer"])
check("audio havolasi qaytadi", res["audio_url"] == "/api/assistant/audio/0123456789abcdef0123")
check("ogohlantirish matni bor", "yuridik maslahat emas" in res["disclaimer"])

time.sleep(1.1)
before = calls["gemini"]
res = run(asst.ask("bugun ob-havo qanday bo'ladi, quyosh chiqadimi"))
check("manba topilmasa Gemini chaqirilmaydi", calls["gemini"] == before and res["found"] is False and res["answer"] == A.NOT_FOUND)
check("topilmaganda manbalar bo'sh", res["sources"] == [] and res["disclaimer"] == "")

time.sleep(1.1)
A.call_gemini = lambda *a, **k: A.NOT_FOUND
res = run(asst.ask(Q))
check("Gemini 'topilmadi' desa manbalar ko'rsatilmaydi", res["found"] is False and res["sources"] == [])

time.sleep(1.1)
A.call_gemini = fake_gemini
asst.api_key = ""
res = run(asst.ask(Q))
check("kalit yo'q: modda matni qaytadi", res["status"] == "ok" and "1-modda" in res["answer"])

time.sleep(1.1)
asst.api_key = "fake"


def boom(*a, **k):
    raise urllib.error.URLError("offline")


A.call_gemini = boom
res = run(asst.ask(Q))
check("internet yo'q: tushunarli xato", res["status"] == "llm_error")
A.call_gemini = fake_gemini

res = run(asst.ask(Q))
check("tez-tez so'rash cheklanadi", res["status"] == "busy")
time.sleep(1.1)
check("juda qisqa savol rad etiladi", run(asst.ask("a"))["status"] == "error")

# ---------------------------------------------------------------- yoqish holati
check("standart: o'chiq", asst.enabled is False)
asst.set_enabled(True)
check("yoqish saqlanadi (qayta yuklaganda ham)", A.Assistant(chunks).enabled is True)
asst.set_enabled(False)

# ---------------------------------------------------------------- HTTP yo'llari va admin cheklovi
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from remote_control import RemoteControl  # noqa: E402

app = FastAPI()
RemoteControl().install(app)
asst2 = A.Assistant(chunks)
A.install_routes(app, asst2)
client = TestClient(app)
LOCAL = {"host": "127.0.0.1:8000"}
ADMIN = {"host": "robot.example.com", "x-admin-token": "tok"}

time.sleep(1.1)
r = client.post("/api/assistant/ask", json={"q": Q}, headers=LOCAL)
check("lokal: /ask ishlaydi", r.status_code == 200 and r.json()["found"])
check("lokal: yoqish", client.get("/api/assistant/enable?on=1", headers=LOCAL).json()["enabled"] is True)
check("admin: holatni ko'ra oladi", client.get("/api/assistant/status", headers=ADMIN).json()["enabled"] is True)
check("admin: o'chira oladi", client.get("/api/assistant/enable?on=0", headers=ADMIN).json()["enabled"] is False)
check("admin: savol bera olmaydi (403)", client.post("/api/assistant/ask", json={"q": "salom dunyo"}, headers=ADMIN).status_code == 403)
check("tokensiz masofaviy: 401", client.get("/api/assistant/status", headers={"host": "robot.example.com"}).status_code == 401)
check("audio: noto'g'ri id 404", client.get("/api/assistant/audio/xyz", headers=LOCAL).status_code == 404)
check("audio: yo'l bosib o'tish rad etiladi", client.get("/api/assistant/audio/..%2F..%2Fetc", headers=LOCAL).status_code in (404, 422))

print(f"\n{passed} ta sinov o'tdi")
