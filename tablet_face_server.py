"""
=============================================================================
PIYODALAR YO'LAGI ROBOTI: PLANSHET YUZI VA STROBOSKOP BOSHQARUV SERVERI
Platforma: Raspberry Pi 4/5 (yoki test uchun Kompyuter)
Bog'lanish: Planshet Wi-Fi orqali ushbu serverga ulanadi (http://<RPi_IP>:8080)
=============================================================================
"""

import http.server
import socketserver
import json
import time
import threading
import sys

# Raspberry Pi GPIO (Agar kompyuterda ishlatilsa xatolik bermasligi uchun emulyator)
try:
    import RPi.GPIO as GPIO
    IS_RPI = True
except (ImportError, RuntimeError):
    IS_RPI = False

# GPIO pinlari (Stroboskop chiroqlar uchun)
PIN_STROBE_RED = 23   # Qizil LED drayveri (MOSFET)
PIN_STROBE_BLUE = 24  # Ko'k LED drayveri (MOSFET)

class StrobeController:
    """Politsiya uslubidagi qizil va ko'k stroboskop chiroqlarini boshqarish"""
    def __init__(self):
        self.mode = "police"  # "off", "police", "warning", "solid"
        self.running = True
        
        if IS_RPI:
            GPIO.setmode(GPIO.BCM)
            GPIO.setup(PIN_STROBE_RED, GPIO.OUT)
            GPIO.setup(PIN_STROBE_BLUE, GPIO.OUT)
            GPIO.output(PIN_STROBE_RED, GPIO.LOW)
            GPIO.output(PIN_STROBE_BLUE, GPIO.LOW)
            
        self.thread = threading.Thread(target=self._strobe_loop, daemon=True)
        self.thread.start()

    def set_mode(self, mode):
        self.mode = mode
        print(f"[STROBOSKOP] Yangi rejim: {mode.upper()}")

    def _strobe_loop(self):
        while self.running:
            if self.mode == "police":
                # Tezkor politsiya stroboskop effekti: 3 marta qizil, 3 marta ko'k
                for _ in range(3):
                    self._set_leds(red=True, blue=False)
                    time.sleep(0.06)
                    self._set_leds(red=False, blue=False)
                    time.sleep(0.05)
                time.sleep(0.05)
                for _ in range(3):
                    self._set_leds(red=False, blue=True)
                    time.sleep(0.06)
                    self._set_leds(red=False, blue=False)
                    time.sleep(0.05)
                time.sleep(0.1)
            elif self.mode == "warning":
                # Yumshoq ogohlantirish: Ikkalasi birga miltillaydi
                self._set_leds(red=True, blue=True)
                time.sleep(0.3)
                self._set_leds(red=False, blue=False)
                time.sleep(0.5)
            elif self.mode == "solid":
                self._set_leds(red=True, blue=True)
                time.sleep(0.2)
            else: # "off"
                self._set_leds(red=False, blue=False)
                time.sleep(0.5)

    def _set_leds(self, red, blue):
        if IS_RPI:
            GPIO.output(PIN_STROBE_RED, GPIO.HIGH if red else GPIO.LOW)
            GPIO.output(PIN_STROBE_BLUE, GPIO.HIGH if blue else GPIO.LOW)

    def cleanup(self):
        self.running = False
        if IS_RPI:
            GPIO.cleanup()


strobe = StrobeController()

# Planshet uchun Web Dashboard (HTML5 + CSS3 + JS)
# To'liq ekranda ekspressiv robot ko'zlari va sensorli PIN-kod klaviaturasi
HTML_PAGE = """<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Qalqon Robot — Planshet Yuzi</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; }
    body {
      background: #000;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    
    /* 🚨 Tepa stroboskop indikatori */
    .strobe-bar {
      height: 8px;
      display: flex;
      width: 100%;
    }
    .strobe-half { flex: 1; opacity: 0.2; transition: opacity 0.05s; }
    .strobe-red { background: #ef4444; }
    .strobe-blue { background: #3b82f6; }
    
    /* 👀 Jonli Robot Ko'zlari */
    .face-container {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 70px;
      cursor: pointer;
    }
    .eye {
      width: 140px;
      height: 95px;
      background: radial-gradient(circle at 50% 50%, #38bdf8 0%, #0284c7 60%, #0369a1 100%);
      border-radius: 16px;
      clip-path: polygon(0% 20%, 100% 5%, 92% 100%, 8% 100%);
      box-shadow: 0 0 35px rgba(56, 189, 248, 0.85), inset 0 0 15px #e0f2fe;
      transition: transform 0.15s ease-out;
    }
    
    /* ⌨️ Pastki PIN-kod paneli */
    .pin-box {
      background: #090d16;
      border-top: 2px solid #1e293b;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }
    .status-text {
      font-size: 14px;
      color: #38bdf8;
      font-weight: bold;
      letter-spacing: 1px;
    }
    .keypad-toggle-btn {
      background: #0284c7;
      color: white;
      border: none;
      padding: 12px 28px;
      font-size: 15px;
      font-weight: bold;
      border-radius: 25px;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(2, 132, 199, 0.4);
    }
    
    /* Modal PIN Klaviaturasi */
    .pin-modal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.92);
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .pin-display {
      font-size: 32px;
      letter-spacing: 10px;
      color: #22c55e;
      margin-bottom: 20px;
      height: 40px;
      font-weight: bold;
    }
    .grid-keys {
      display: grid;
      grid-template-columns: repeat(3, 80px);
      gap: 15px;
    }
    .key-btn {
      width: 80px;
      height: 70px;
      background: #1e293b;
      color: white;
      font-size: 24px;
      font-weight: bold;
      border: 1px solid #334155;
      border-radius: 14px;
      cursor: pointer;
    }
    .key-btn:active { background: #0284c7; }
  </style>
</head>
<body>

  <!-- Tepa stroboskop indikatori -->
  <div class="strobe-bar">
    <div class="strobe-half strobe-red" id="strobeRed"></div>
    <div class="strobe-half strobe-blue" id="strobeBlue"></div>
  </div>

  <!-- Ekspressiv robot ko'zlari -->
  <div class="face-container" onclick="blinkFast()">
    <div class="eye" id="leftEye"></div>
    <div class="eye" id="rightEye"></div>
  </div>

  <!-- Pastki boshqaruv & PIN paneli -->
  <div class="pin-box">
    <div class="status-text" id="lblStatus">🛡️ IIV PATRUL VA JAMOAT XAVFSIZLIGI ROBOTI</div>
    <div style="display:flex; gap:12px;">
      <button class="keypad-toggle-btn" style="background:#dc2626;" onclick="call102SOS()">🆘 102 YORDAM CHAQIRISH</button>
      <button class="keypad-toggle-btn" onclick="openKeypad()">🔑 XIZMAT / YUKNI OCHISH</button>
    </div>
  </div>

  <!-- PIN Klaviaturasi Modali -->
  <div class="pin-modal" id="pinModal">
    <h3 style="color:#94a3b8; font-size:16px; margin-bottom:10px;">SMS ORQALI KELGAN KODNI KIRITING:</h3>
    <div class="pin-display" id="pinDisplay">----</div>
    <div class="grid-keys">
      <button class="key-btn" onclick="pressKey('1')">1</button>
      <button class="key-btn" onclick="pressKey('2')">2</button>
      <button class="key-btn" onclick="pressKey('3')">3</button>
      <button class="key-btn" onclick="pressKey('4')">4</button>
      <button class="key-btn" onclick="pressKey('5')">5</button>
      <button class="key-btn" onclick="pressKey('6')">6</button>
      <button class="key-btn" onclick="pressKey('7')">7</button>
      <button class="key-btn" onclick="pressKey('8')">8</button>
      <button class="key-btn" onclick="pressKey('9')">9</button>
      <button class="key-btn" style="background:#dc2626;" onclick="clearPin()">C</button>
      <button class="key-btn" onclick="pressKey('0')">0</button>
      <button class="key-btn" style="background:#16a34a;" onclick="submitPin()">OK</button>
    </div>
    <button style="margin-top:20px; background:transparent; border:none; color:#94a3b8; font-size:14px; cursor:pointer;" onclick="closeKeypad()">✕ Yopish</button>
  </div>

  <script>
    // Tabiiy ko'z miltillashi va nigoh harakatlari
    const leftEye = document.getElementById('leftEye');
    const rightEye = document.getElementById('rightEye');

    function naturalBlink() {
      leftEye.style.transform = 'scaleY(0.08)';
      rightEye.style.transform = 'scaleY(0.08)';
      setTimeout(() => {
        leftEye.style.transform = 'scaleY(1)';
        rightEye.style.transform = 'scaleY(1)';
      }, 100);

      // Vaqti-vaqti bilan yon tomonga qarash
      if (Math.random() < 0.4) {
        const lookX = (Math.random() - 0.5) * 50;
        leftEye.style.transform = `translateX(${lookX}px)`;
        rightEye.style.transform = `translateX(${lookX}px)`;
        setTimeout(() => {
          leftEye.style.transform = 'translateX(0)';
          rightEye.style.transform = 'translateX(0)';
        }, 1500);
      }

      const nextBlink = 2000 + Math.random() * 3000;
      setTimeout(naturalBlink, nextBlink);
    }
    setTimeout(naturalBlink, 1500);

    function blinkFast() {
      leftEye.style.transform = 'scaleY(0.6) scaleX(1.1)';
      rightEye.style.transform = 'scaleY(0.6) scaleX(1.1)';
      setTimeout(() => {
        leftEye.style.transform = 'scaleY(1) scaleX(1)';
        rightEye.style.transform = 'scaleY(1) scaleX(1)';
      }, 600);
    }

    function call102SOS() {
      fetch('/api/strobe?mode=police');
      alert("🚨 102 TEZKOR ALOQA: Navbatchilik qismi bilan video aloqa o'rnatilmoqda! Robot joylashuv koordinatalari uzatildi.");
      document.getElementById('lblStatus').innerText = "🚨 102 FAVQULODDA CHAQIRUV ULANDI!";
      document.getElementById('lblStatus').style.color = "#ef4444";
    }

    // PIN Kod klaviaturasi
    let enteredPin = "";
    function openKeypad() { document.getElementById('pinModal').style.display = 'flex'; }
    function closeKeypad() { document.getElementById('pinModal').style.display = 'none'; enteredPin = ""; updatePinDisplay(); }
    function pressKey(num) {
      if (enteredPin.length < 4) {
        enteredPin += num;
        updatePinDisplay();
      }
    }
    function clearPin() { enteredPin = ""; updatePinDisplay(); }
    function updatePinDisplay() {
      const display = document.getElementById('pinDisplay');
      display.innerText = enteredPin.padEnd(4, '-');
    }
    function submitPin() {
      if (enteredPin.length === 4) {
        fetch('/api/unlock?pin=' + enteredPin)
          .then(r => r.json())
          .then(data => {
            if (data.success) {
              alert("✅ KOD TO'G'RI! Kuryer bo'limi ochildi. Marhamat, yukingizni oling!");
              closeKeypad();
            } else {
              alert("❌ KOD NOTO'G'RI! Qayta urinib ko'ring.");
              clearPin();
            }
          });
      }
    }
  </script>
</body>
</html>
"""

class RobotRequestHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(HTML_PAGE.encode("utf-8"))
        elif self.path.startswith("/api/strobe"):
            # Rejimni o'zgartirish: /api/strobe?mode=police / warning / off
            mode = "police"
            if "mode=" in self.path:
                mode = self.path.split("mode=")[1].split("&")[0]
            strobe.set_mode(mode)
            self._send_json({"success": True, "mode": mode})
        elif self.path.startswith("/api/unlock"):
            # PIN tekshirish: Test pin "1234"
            pin = ""
            if "pin=" in self.path:
                pin = self.path.split("pin=")[1].split("&")[0]
            success = (pin == "1234")
            self._send_json({"success": success})
        else:
            self.send_response(404)
            self.end_headers()

    def _send_json(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def log_message(self, format, *args):
        pass  # Konsolni to'ldirmaslik uchun jim turish

def start_server(port=8080):
    print("=" * 60)
    print(f"🤖 QALQON ROBOT — PLANSHET VA STROBOSKOP SERVERI ISHGA TUSHDI")
    print(f"🌐 Planshetdan kirish manzili: http://<ROBOT_IP>:{port}")
    print(f"🚨 Stroboskop nazoratchisi faol (Rejim: POLICE)")
    print("=" * 60)
    with socketserver.TCPServer(("", port), RobotRequestHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer to'xtatilmoqda...")
            strobe.cleanup()

if __name__ == "__main__":
    start_server(8080)
