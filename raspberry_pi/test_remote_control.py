"""
remote_control.py uchun sinovlar (apparatsiz, soxta Arduino bilan).
Ishga tushirish:  python test_remote_control.py
"""
import os
import time

os.environ["QALQON_ADMIN_TOKEN"] = "test-token-123"
os.environ["QALQON_LEASE_MS"] = "300"
os.environ["QALQON_LOCAL_HOLD_MS"] = "500"
os.environ["QALQON_LOCAL_HOSTS"] = "127.0.0.1"  # sinov rejimi: boshqa Host masofaviy hisoblanadi

from typing import Optional
from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from remote_control import RemoteControl


class FakeArduino:
    def __init__(self):
        self.cmds = []
        self.logs = []
        self.speed = 1

    def send_command(self, cmd):
        self.cmds.append(cmd)
        return True

    def set_speed(self, level):
        self.speed = level

    def _add_log(self, text):
        self.logs.append(text)


ard = FakeArduino()
remote = RemoteControl(arduino=ard)
app = FastAPI()
remote.install(app)


@app.get("/cmd")
def cmd(request: Request, c: Optional[str] = None, speed: Optional[int] = None):
    src = getattr(request.state, "src", "local")
    if speed is not None:
        speed = remote.cap_speed(src, speed)
        ard.set_speed(speed)
        return {"status": "ok", "speed": speed}
    verdict = remote.pre_command(src, c)
    if verdict:
        return JSONResponse(verdict[1], status_code=verdict[0])
    ok = ard.send_command(c.upper())
    remote.post_command(src, c.upper(), ok)
    return {"status": "ok", "src": src}


@app.get("/api/obstacle")
def obstacle():
    return {"status": "ok"}


@app.get("/api/telemetry")
def telem():
    return {"remote": remote.status()}


@app.websocket("/ws")
async def ws(ws: WebSocket):
    if not await remote.ws_gate(ws):
        return
    await ws.accept()
    await ws.send_json({"remote": remote.status()})
    await ws.close()


client = TestClient(app)
LOCAL = {"host": "127.0.0.1:8000"}
REMOTE = {"host": "robot.example.com", "x-admin-token": "test-token-123"}
passed = 0


def check(name, cond):
    global passed
    assert cond, f"FAIL: {name}"
    passed += 1
    print(f"ok  {name}")


# --- aniqlash
check("lokal so'rov token talab qilmaydi", client.get("/cmd?c=F", headers=LOCAL).json()["src"] == "local")
check("tunnel sarlavhasi bilan token talab qilinadi", client.get("/cmd?c=F", headers={**LOCAL, "cf-connecting-ip": "1.2.3.4"}).status_code == 401)
check("[sinov rejimi] lokal ro'yxatda yo'q Host masofaviy hisoblanadi", client.get("/cmd?c=F", headers={"host": "robot.example.com"}).status_code == 401)
check("noto'g'ri token rad etiladi", client.get("/cmd?c=F", headers={"host": "robot.example.com", "x-admin-token": "xxx"}).status_code == 401)
r = client.get("/cmd?c=S", headers=REMOTE)
check("to'g'ri token (sarlavha) qabul qilinadi", r.status_code == 200 and r.json()["src"] == "admin")
check("token so'rov parametrida ham qabul qilinadi", client.get("/api/telemetry?token=test-token-123", headers={"host": "robot.example.com"}).status_code == 200)

# --- yopiq yo'llar
check("admin xizmat yo'liga kira olmaydi", client.get("/api/obstacle", headers=REMOTE).status_code == 403)
check("admin kill-switch ni o'zgartira olmaydi", client.get("/api/remote/allow?on=0", headers=REMOTE).status_code == 403)
check("lokal xizmat yo'liga kira oladi", client.get("/api/obstacle", headers=LOCAL).status_code == 200)

# --- buyruq tekshiruvi va tezlik
check("admin noma'lum buyruq: 400", client.get("/cmd?c=X", headers=REMOTE).status_code == 400)
client.get("/cmd?speed=3", headers=REMOTE)
check("admin tezligi 2 bilan cheklanadi", ard.speed == 2)
client.get("/cmd?speed=3", headers=LOCAL)
check("lokal tezlik cheklanmaydi", ard.speed == 3)

# --- deadman
time.sleep(0.6)  # oldingi lokal buyruq ushlab turishi tugasin
ard.cmds.clear()
check("admin F qabul qilindi", client.get("/cmd?c=F", headers=REMOTE).status_code == 200)
st = client.get("/api/telemetry", headers=REMOTE).json()["remote"]
check("admin faol deb ko'rinadi", st["admin_active"] and st["last"]["cmd"] == "F" and st["last"]["src"] == "admin")
time.sleep(0.6)
check("deadman: yangilanmasa robot to'xtaydi", ard.cmds[-1] == "S")
check("deadman hodisasi yozildi", remote.status()["last"].get("reason") == "deadman")

ard.cmds.clear()
for _ in range(4):
    client.get("/cmd?c=F", headers=REMOTE)
    time.sleep(0.15)
check("yangilab turilsa deadman ishlamaydi", "S" not in ard.cmds)
client.get("/cmd?c=S", headers=REMOTE)

# --- lokal ustuvorlik
time.sleep(0.6)
client.get("/cmd?c=L", headers=LOCAL)
check("lokal buyruqdan keyin admin harakati 409", client.get("/cmd?c=F", headers=REMOTE).status_code == 409)
check("lokal ushlab turganda admin STOP o'tadi", client.get("/cmd?c=S", headers=REMOTE).status_code == 200)
time.sleep(0.6)
check("ushlab turish tugagach admin yana boshqaradi", client.get("/cmd?c=F", headers=REMOTE).status_code == 200)

# --- kill-switch
client.get("/api/remote/allow?on=0", headers=LOCAL)
check("kill-switch: admin harakati 423", client.get("/cmd?c=F", headers=REMOTE).status_code == 423)
check("kill-switch: admin STOP baribir o'tadi", client.get("/cmd?c=S", headers=REMOTE).status_code == 200)
check("kill-switch holati telemetriyada", client.get("/api/telemetry", headers=REMOTE).json()["remote"]["allowed"] is False)
client.get("/api/remote/allow?on=1", headers=LOCAL)
time.sleep(0.6)
check("kalit yoqilgach admin yana boshqaradi", client.get("/cmd?c=B", headers=REMOTE).status_code == 200)
client.get("/cmd?c=S", headers=REMOTE)

# --- WebSocket
try:
    with client.websocket_connect("/ws", headers={"host": "robot.example.com"}):
        ok = False
except Exception:
    ok = True
check("tokensiz masofaviy WebSocket rad etiladi", ok)
with client.websocket_connect("/ws?token=test-token-123", headers={"host": "robot.example.com"}) as w:
    check("tokenli masofaviy WebSocket ochiladi", "remote" in w.receive_json())
with client.websocket_connect("/ws", headers=LOCAL) as w:
    check("lokal WebSocket tokensiz ochiladi", "remote" in w.receive_json())

# --- urinishlarni cheklash (oxirida: IP bloklanadi)
codes = [client.get("/cmd?c=S", headers={"host": "robot.example.com", "x-admin-token": "bad", "cf-connecting-ip": "9.9.9.9"}).status_code for _ in range(10)]
check("ko'p noto'g'ri urinish: 429", codes[-1] == 429 and codes[0] == 401)

# --- standart holat (QALQON_LOCAL_HOSTS yo'q): Host e'tiborga olinmaydi, faqat Cloudflare sarlavhalari
_saved = os.environ.pop("QALQON_LOCAL_HOSTS")
default = RemoteControl(arduino=FakeArduino())
os.environ["QALQON_LOCAL_HOSTS"] = _saved
check("standart: .lan hosti lokal (monitor buzilmaydi)", default.is_remote({"host": "qalqon.lan:8000"}) is False)
check("standart: .local hosti lokal", default.is_remote({"host": "raspberrypi.local"}) is False)
check("standart: IP hosti lokal", default.is_remote({"host": "192.168.1.50:8000"}) is False)
check("standart: Cloudflare sarlavhasi masofaviy", default.is_remote({"host": "qalqon.lan", "cf-ray": "abc"}) is True)

print(f"\n{passed} ta sinov o'tdi")
