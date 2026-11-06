/*
 * ==============================================================================
 * LOYIHA: «QALQON v1.0» / AVTONOM ROBOT PLATFORMASI
 * MIKROKONTROLLER: ESP32 (WROOM-32 / NodeMCU ESP32)
 * MOTOR DRAYVER: 2x BTS7960 (IBT-2 High-Power H-Bridge, 43A)
 * 
 * ALOQA TOPOLOGIYASI:
 * 1. Robot ustidagi Planshet o'zining "Kirish nuqtasi" (Wi-Fi Hotspot)ni yoqadi.
 *    Planshetning o'zida 4G/5G mobil interneti uzilmaydi va faol qoladi!
 * 2. Ushbu ESP32 planshetning Wi-Fi Hotspotiga Station (WIFI_STA) rejimida ulanadi.
 * 3. Planshet ESP32 ga lokal IP beradi (masalan: 192.168.43.50).
 * 4. Boshqaruv:
 *    A) Lokal rejim: Planshet yoki o'sha tarmoqdagi har qanday telefon brauzerida 
 *       http://<ESP32_IP>/ manzilini ochib to'g'ridan-to'g'ri boshqarish.
 *    B) Masofaviy Web rejim (Internet / MQTT / HTTP Relay): Saytdan kelgan buyruqlar
 *       /move?dir=F, /cmd?c=F yoki MQTT broker orqali bir zumda ijro etiladi.
 * 5. Failsafe (Xavfsizlik taymeri): Agar 800 ms davomida yangi harakat buyrug'i 
 *    kelmasa, motorlar avtomatik to'xtaydi (falokatlarning oldini olish uchun).
 * ==============================================================================
 */

#include <WiFi.h>
#include <WebServer.h>

// ==============================================================================
// 0. MASOFAVIY INTERNET BOSHQARUV (MQTT BULUT) TANLOVI
// ==============================================================================
// Agar Internet orqali (boshqa telefondan) boshqarmoqchi bo'lsangiz: 1 qoldiring.
// Buning uchun Arduino IDE da "PubSubClient" kutubxonasi o'rnatilgan bo'lishi kerak.
// Agar faqat lokal Wi-Fi (HTTP) orqali ishlatmoqchi bo'lsangiz: 0 qiling.
#define ENABLE_MQTT 1

#if ENABLE_MQTT
#include <PubSubClient.h>
WiFiClient espClient;
PubSubClient mqttClient(espClient);
const char* mqttServer = "broker.hivemq.com"; // Ochiq bepul IoT broker
const int   mqttPort   = 1883;
const char* mqttTopic  = "qalqon/robot/cmd";   // Masofaviy buyruqlar mavzusi
#endif

// ==============================================================================
// 1. WI-FI SOZLAMALARI (PLANSHET HOTSPOT MA'LUMOTLARI)
// ==============================================================================
// Planshetingizda "Kirish nuqtasi" (Tochka dostupa / Hotspot) nomi va parolini kiriting:
const char* ssid     = "Qalqon_Hotspot";   // Planshet Hotspot nomi
const char* password = "12345678";         // Planshet Hotspot paroli (kamida 8 belgi)

// WebServer porti (Standart HTTP - 80)
WebServer server(80);

// ==============================================================================
// 2. BTS7960 (IBT-2) MOTOR DRAYVER PINLARI
// ==============================================================================
// 1-IBT-2 (Chap tomondagi motorlar)
const int chapOldinga_RPWM = 25;
const int chapOrqaga_LPWM  = 26;

// 2-IBT-2 (O'ng tomondagi motorlar)
const int ongOldinga_RPWM  = 27;
const int ongOrqaga_LPWM   = 14;

// DIQQAT: BTS7960 drayverlaridagi R_EN va L_EN pinlarini 
// ESP32 ning 3.3V yoki 5V piniga ulab qo'yish kerak (Drayver doim yoqiq turishi uchun)!

// ==============================================================================
// 3. TEZLIK VA XAVFSIZLIK SOZLAMALARI
// ==============================================================================
int tezlik = 255;                          // Boshlang'ich tezlik (0 - 255)
unsigned long oxirgiBuyruqVaqti = 0;       // Xavfsizlik taymeri uchun vaqt
const unsigned long TIMEOUT_MS = 800;      // 800 ms signal kelmasa avtotormoz
bool harakatda = false;                    // Motorlar aylanayotganini tekshirish

// ==============================================================================
// 4. MOTORLARNI BOSHQARISH FUNKSIYALARI
// ==============================================================================

void oldingaYur(int chapKuch, int ongKuch) {
  analogWrite(chapOldinga_RPWM, constrain(chapKuch, 0, 255));
  analogWrite(chapOrqaga_LPWM, 0);
  analogWrite(ongOldinga_RPWM, constrain(ongKuch, 0, 255));
  analogWrite(ongOrqaga_LPWM, 0);
  harakatda = true;
  oxirgiBuyruqVaqti = millis();
}

void orqagaYur(int chapKuch, int ongKuch) {
  analogWrite(chapOldinga_RPWM, 0);
  analogWrite(chapOrqaga_LPWM, constrain(chapKuch, 0, 255));
  analogWrite(ongOldinga_RPWM, 0);
  analogWrite(ongOrqaga_LPWM, constrain(ongKuch, 0, 255));
  harakatda = true;
  oxirgiBuyruqVaqti = millis();
}

void joyidaChapga(int kuch) {
  analogWrite(chapOldinga_RPWM, 0);
  analogWrite(chapOrqaga_LPWM, constrain(kuch, 0, 255));
  analogWrite(ongOldinga_RPWM, constrain(kuch, 0, 255));
  analogWrite(ongOrqaga_LPWM, 0);
  harakatda = true;
  oxirgiBuyruqVaqti = millis();
}

void joyidaOngga(int kuch) {
  analogWrite(chapOldinga_RPWM, constrain(kuch, 0, 255));
  analogWrite(chapOrqaga_LPWM, 0);
  analogWrite(ongOldinga_RPWM, 0);
  analogWrite(ongOrqaga_LPWM, constrain(kuch, 0, 255));
  harakatda = true;
  oxirgiBuyruqVaqti = millis();
}

void toxta() {
  analogWrite(chapOldinga_RPWM, 0);
  analogWrite(chapOrqaga_LPWM, 0);
  analogWrite(ongOldinga_RPWM, 0);
  analogWrite(ongOrqaga_LPWM, 0);
  harakatda = false;
}

// Barcha buyruqlarni qayta ishlovchi markaziy funksiya
void buyruqniBajar(char xarf) {
  switch (xarf) {
    case 'F': oldingaYur(tezlik, tezlik); break;        // Oldinga
    case 'B': orqagaYur(tezlik, tezlik); break;         // Orqaga
    case 'L': joyidaChapga(tezlik); break;              // Chapga burilish
    case 'R': joyidaOngga(tezlik); break;               // O'ngga burilish
    case 'G': oldingaYur(tezlik / 3, tezlik); break;    // Oldinga-chapga egri
    case 'I': oldingaYur(tezlik, tezlik / 3); break;    // Oldinga-o'ngga egri
    case 'H': orqagaYur(tezlik / 3, tezlik); break;     // Orqaga-chapga egri
    case 'J': orqagaYur(tezlik, tezlik / 3); break;     // Orqaga-o'ngga egri
    case 'S': toxta(); break;                           // To'xtash
    default:  toxta(); break;
  }
}

// ==============================================================================
// 5. O'RNATILGAN BOSHQARUV VEB-SAHIFASI (HTML + CSS + JAVASCRIPT)
// ==============================================================================
const char index_html[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Qalqon Robot Control</title>
  <style>
    * {
      box-sizing: border-box;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #0f172a;
      color: #f8fafc;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    /* Yuqori panel */
    .header {
      background: linear-gradient(135deg, #0d9488, #115e59);
      color: white;
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      font-size: 18px;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .status-badge {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 12px;
      background: rgba(255,255,255,0.2);
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 18px;
    }
    /* Asosiy 3 ustunli qism */
    .main {
      flex: 1;
      display: grid;
      grid-template-columns: 1.2fr 1fr 1.2fr;
      gap: 16px;
      padding: 16px;
      height: calc(100vh - 52px);
      max-width: 900px;
      margin: 0 auto;
      width: 100%;
    }
    /* Chap va O'ng ustunlar */
    .left-col, .right-col {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    /* Katta boshqaruv tugmalari */
    .ctrl-btn {
      flex: 1;
      background: #1e293b;
      border: 2px solid #334155;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 6px 14px rgba(0,0,0,0.4);
      touch-action: none;
      transition: all 0.1s ease;
      cursor: pointer;
    }
    .ctrl-btn:active, .ctrl-btn.active {
      background: #0d9488;
      border-color: #14b8a6;
      transform: scale(0.96);
      box-shadow: 0 0 20px rgba(20, 184, 166, 0.6);
    }
    .ctrl-btn svg {
      width: 64px;
      height: 64px;
      fill: #f8fafc;
    }
    /* O'rta ustun */
    .center-col {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
    }
    .speed-box {
      width: 100%;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 12px;
      text-align: center;
    }
    .speed-title {
      font-size: 13px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .speed-val {
      font-size: 22px;
      font-weight: 700;
      color: #14b8a6;
    }
    input[type=range] {
      width: 100%;
      margin-top: 10px;
      accent-color: #14b8a6;
      height: 6px;
      cursor: pointer;
    }
    /* Markaziy to'xtatish doirasi */
    .car-circle {
      width: 90px;
      height: 90px;
      border-radius: 50%;
      background: radial-gradient(circle, #334155 30%, #1e293b 100%);
      border: 3px solid #ef4444;
      box-shadow: 0 4px 16px rgba(239, 68, 68, 0.3);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.15s ease;
    }
    .car-circle:active {
      transform: scale(0.92);
      background: #ef4444;
    }
    .car-circle svg {
      width: 40px;
      height: 40px;
      fill: #f8fafc;
    }
    .car-circle span {
      font-size: 10px;
      font-weight: 700;
      color: #ef4444;
      margin-top: 2px;
    }
    .car-circle:active span {
      color: #fff;
    }
    /* Qo'shimcha tugmalar (Signal / Fara) */
    .aux-row {
      display: flex;
      gap: 14px;
      width: 100%;
      justify-content: center;
    }
    .aux-btn {
      width: 52px;
      height: 52px;
      border-radius: 12px;
      background: #1e293b;
      border: 1px solid #334155;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .aux-btn:active {
      background: #334155;
      transform: scale(0.95);
    }
    .aux-btn svg {
      width: 24px;
      height: 24px;
      fill: #94a3b8;
    }
  </style>
</head>
<body>

  <div class="header">
    <div class="header-left">
      <span>🛡️ QALQON</span>
      <span class="status-badge" id="pingBadge">ONLINE</span>
    </div>
    <div class="header-right">
      <span id="connIcon">📶</span>
      <span>⚡ ESP32</span>
    </div>
  </div>

  <div class="main">
    <!-- Chap ustun: Oldinga va Orqaga -->
    <div class="left-col">
      <div class="ctrl-btn" id="btnU" data-cmd="F">
        <svg viewBox="0 0 24 24"><path d="M12 3L4 20l8-4 8 4z"/></svg>
      </div>
      <div class="ctrl-btn" id="btnD" data-cmd="B">
        <svg viewBox="0 0 24 24"><path d="M12 21L4 4l8 4 8-4z"/></svg>
      </div>
    </div>

    <!-- O'rta ustun: Tezlik, Stop, Qo'shimchalar -->
    <div class="center-col">
      <div class="speed-box">
        <div class="speed-title">Tezlik</div>
        <div class="speed-val"><span id="spdTxt">100</span>%</div>
        <input type="range" min="20" max="100" value="100" id="spdRange" oninput="changeSpeed(this.value)">
      </div>

      <div class="car-circle" onclick="sendCmd('S')">
        <svg viewBox="0 0 24 24">
          <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
        </svg>
        <span>STOP</span>
      </div>

      <div class="aux-row">
        <div class="aux-btn" onclick="sendCmd('HORN')">
          <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
        </div>
        <div class="aux-btn" onclick="sendCmd('LIGHT')">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.04-.42 1.99-1.07 2.75z"/></svg>
        </div>
      </div>
    </div>

    <!-- O'ng ustun: Chapga va O'ngga -->
    <div class="right-col">
      <div class="ctrl-btn" id="btnL" data-cmd="L">
        <svg viewBox="0 0 24 24" style="transform: rotate(-90deg);"><path d="M12 3L4 20l8-4 8 4z"/></svg>
      </div>
      <div class="ctrl-btn" id="btnR" data-cmd="R">
        <svg viewBox="0 0 24 24" style="transform: rotate(90deg);"><path d="M12 3L4 20l8-4 8 4z"/></svg>
      </div>
    </div>
  </div>

  <script>
    let heartbeatTimer = null;
    let currentCmd = 'S';

    function sendCmd(cmd) {
      currentCmd = cmd;
      fetch('/move?dir=' + cmd).catch(e => console.warn('Signal yuborishda xato:', e));
    }

    function changeSpeed(val) {
      document.getElementById('spdTxt').innerText = val;
      const pwm = Math.round((val / 100) * 255);
      fetch('/speed?val=' + pwm).catch(e => console.warn(e));
    }

    // Bosib turganda uzluksiz yuborish (Keep-alive)
    function startMovement(cmd, btnElem) {
      btnElem.classList.add('active');
      sendCmd(cmd);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (currentCmd !== 'S') {
          sendCmd(currentCmd);
        }
      }, 300);
    }

    function stopMovement(btnElem) {
      if (btnElem) btnElem.classList.remove('active');
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      sendCmd('S');
    }

    // Tugmalarga hodisalarni ulash
    document.querySelectorAll('.ctrl-btn').forEach(btn => {
      const cmd = btn.getAttribute('data-cmd');
      
      // Touch (Sensor ekranlar uchun)
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); startMovement(cmd, btn); }, {passive: false});
      btn.addEventListener('touchend', (e) => { e.preventDefault(); stopMovement(btn); }, {passive: false});
      btn.addEventListener('touchcancel', (e) => { e.preventDefault(); stopMovement(btn); }, {passive: false});
      
      // Sichqoncha (Kompyuter / Noutbuk uchun)
      btn.addEventListener('mousedown', (e) => { startMovement(cmd, btn); });
      btn.addEventListener('mouseup', (e) => { stopMovement(btn); });
      btn.addEventListener('mouseleave', (e) => { if (btn.classList.contains('active')) stopMovement(btn); });
    });

    // Klaviatura tugmalari (W, A, S, D, ArrowKeys)
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') startMovement('F', document.getElementById('btnU'));
      else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') startMovement('B', document.getElementById('btnD'));
      else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') startMovement('L', document.getElementById('btnL'));
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') startMovement('R', document.getElementById('btnR'));
      else if (e.key === ' ') stopMovement(null);
    });

    window.addEventListener('keyup', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'W', 's', 'S', 'a', 'A', 'd', 'D'].includes(e.key)) {
        stopMovement(document.getElementById('btnU'));
        stopMovement(document.getElementById('btnD'));
        stopMovement(document.getElementById('btnL'));
        stopMovement(document.getElementById('btnR'));
      }
    });
  </script>
</body>
</html>
)rawliteral";

// ==============================================================================
// 6. WEBSERVER ROUTE HANDLERLARI (HTTP SO'ROV QABUL QILISH)
// ==============================================================================

// Bosh sahifa
void handleRoot() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send_P(200, "text/html", index_html);
}

// Harakat buyrug'i: /move?dir=F yoki /cmd?c=F yoki /cmd?speed=3
void handleMove() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  
  // Agar /cmd orqali tezlik yuborilgan bo'lsa
  if (server.hasArg("speed")) {
    int v = server.arg("speed").toInt();
    if (v == 1) tezlik = 130;
    else if (v == 2) tezlik = 190;
    else if (v == 3) tezlik = 255;
    else tezlik = constrain(v, 0, 255);
    server.send(200, "application/json", "{\"status\":\"ok\",\"speed\":" + String(tezlik) + "}");
    return;
  }

  String cmdStr = "";
  if (server.hasArg("dir")) cmdStr = server.arg("dir");
  else if (server.hasArg("c")) cmdStr = server.arg("c");

  if (cmdStr.length() > 0) {
    char c = cmdStr.charAt(0);
    buyruqniBajar(c);
    server.send(200, "application/json", "{\"status\":\"ok\",\"cmd\":\"" + String(c) + "\"}");
  } else {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Missing 'dir' or 'c' argument\"}");
  }
}

// Tezlikni o'zgartirish: /speed?val=200 yoki /speed?speed=255
void handleSpeed() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  
  int v = -1;
  if (server.hasArg("val")) v = server.arg("val").toInt();
  else if (server.hasArg("speed")) v = server.arg("speed").toInt();

  if (v >= 0) {
    if (v == 1) tezlik = 130;
    else if (v == 2) tezlik = 190;
    else if (v == 3) tezlik = 255;
    else tezlik = constrain(v, 0, 255);
    server.send(200, "application/json", "{\"status\":\"ok\",\"speed\":" + String(tezlik) + "}");
  } else {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Missing 'val' or 'speed' argument\"}");
  }
}

// Robot holati: /status
void handleStatus() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String json = "{";
  json += "\"status\":\"online\",";
  json += "\"moving\":" + String(harakatda ? "true" : "false") + ",";
  json += "\"speed\":" + String(tezlik) + ",";
  json += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  json += "\"rssi\":" + String(WiFi.RSSI());
  json += "}";
  server.send(200, "application/json", json);
}

// Topilmagan sahifa (404)
void handleNotFound() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(404, "text/plain", "Not Found");
}

// ==============================================================================
// 7. MQTT CALLBACK VA RECONNECT (INTERNET ORQALI BOSHQARUV)
// ==============================================================================
#if ENABLE_MQTT
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) {
    msg += (char)payload[i];
  }
  msg.trim();

  // Agar tezlik bo'lsa (masalan: V:200)
  if (msg.startsWith("V:")) {
    int v = msg.substring(2).toInt();
    tezlik = constrain(v, 0, 255);
  } 
  // Agar oddiy buyruq bo'lsa (F, B, L, R, S)
  else if (msg.length() > 0) {
    char c = msg.charAt(0);
    buyruqniBajar(c);
  }
}

void reconnectMQTT() {
  static unsigned long lastMqttRetry = 0;
  if (millis() - lastMqttRetry > 5000) {
    lastMqttRetry = millis();
    String clientId = "QalqonRobot-" + String(random(0xffff), HEX);
    Serial.print("[MQTT] HiveMQ bulutiga ulanmoqda...");
    if (mqttClient.connect(clientId.c_str())) {
      Serial.println(" ULANDI!");
      mqttClient.subscribe(mqttTopic);
      Serial.print("[MQTT] Obuna bo'lingan mavzu: ");
      Serial.println(mqttTopic);
    } else {
      Serial.print(" Xatolik: ");
      Serial.println(mqttClient.state());
    }
  }
}
#endif

// ==============================================================================
// 8. SETUP VA LOOP
// ==============================================================================

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n==========================================");
  Serial.println("  QALQON ROBOT - ESP32 BTS7960 CONTROLLER ");
  Serial.println("==========================================");

  // Pinlarni chiqish (OUTPUT) holatiga o'tkazish
  pinMode(chapOldinga_RPWM, OUTPUT);
  pinMode(chapOrqaga_LPWM, OUTPUT);
  pinMode(ongOldinga_RPWM, OUTPUT);
  pinMode(ongOrqaga_LPWM, OUTPUT);

  // Dastlab motorlarni to'xtatish
  toxta();

  // Wi-Fi Station (STA) rejimini yoqish
  // ESP32 o'zi tarmoq tarqatmaydi, balki planshetning Hotspotiga ulanadi!
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  Serial.print("Planshet Hotspotiga ulanmoqda (SSID: ");
  Serial.print(ssid);
  Serial.print(")");

  int urinish = 0;
  while (WiFi.status() != WL_CONNECTED && urinish < 30) {
    delay(500);
    Serial.print(".");
    urinish++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[MUVAFFAQIN!] Planshet Hotspotiga ulandi!");
    Serial.print("ESP32 IP manzili: http://");
    Serial.println(WiFi.localIP());
    Serial.println("Boshqarish uchun brauzerda shu IP manzilni oching!");
  } else {
    Serial.println("\n[OGOHLANTIRISH] Wi-Fi ga ulanib bo'lmadi!");
    Serial.println("Planshetda 'Kirish nuqtasi' (Hotspot) yoqilgani va SSID/parol to'g'riligini tekshiring.");
  }

  // Web server marshrutlarini sozlash
  server.on("/", HTTP_GET, handleRoot);
  server.on("/move", HTTP_GET, handleMove);
  server.on("/cmd", HTTP_GET, handleMove);
  server.on("/speed", HTTP_GET, handleSpeed);
  server.on("/status", HTTP_GET, handleStatus);
  server.onNotFound(handleNotFound);

  // Serverni ishga tushirish
  server.begin();
  Serial.println("HTTP WebServer port 80 da ishga tushdi.");

#if ENABLE_MQTT
  mqttClient.setServer(mqttServer, mqttPort);
  mqttClient.setCallback(mqttCallback);
#endif
}

void loop() {
  // HTTP so'rovlarni qabul qilish
  server.handleClient();

#if ENABLE_MQTT
  if (WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected()) {
      reconnectMQTT();
    } else {
      mqttClient.loop();
    }
  }
#endif

  // Failsafe (Avtotormoz): agar 800 ms yangi signal kelmasa, motorlarni to'xtatish
  if (harakatda && (millis() - oxirgiBuyruqVaqti > TIMEOUT_MS)) {
    toxta();
  }

  // Wi-Fi aloqasi uzilib qolsa avtomatik qayta ulanish
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastReconnect = 0;
    if (millis() - lastReconnect > 5000) {
      lastReconnect = millis();
      Serial.println("Wi-Fi uzildi. Qayta ulanishga urinilmoqda...");
      WiFi.reconnect();
    }
  }
}
