# 🛡️ QALQON — VPS & Domen Deploy Qo‘llanmasi (Meta Quest 2 VR + 4G Robot)

Ushbu qo‘llanma QALQON robot boshqaruv tizimini bitta maxsus **HTTPS domenga** (VPS) ko‘tarish uchun mo‘ljallangan.

## Arxitektura (1 ta HTTPS domen, faqat 80/443 portlar!)

```
[Meta Quest 2 VR / Operator (Istalgan Wi-Fi / 4G)]
             │  HTTPS + WSS (WebXR 100% ochiq, Mixed Content YO'Q!)
             ▼
   [VPS: https://SIZNING_DOMEN]  (Caddy/Nginx + vps/vps_hub.py)
             ▲
             │  Chiquvchi WSS (443-port) — Statik IP / port ochish kerak emas!
[Raspberry Pi 5 (Robot ichida — 4G SIM yoki istalgan Wi-Fi)]
   ├── raspberry_pi/vps_uplink.py  -> Frontal USB + PTZ 3-linza + LiDAR + ESP32
   ├── lidar_bridge_server.py      (:8000)
   └── camera_server/main.py       (:8090)
```

---

## 1-USUL: Docker + Caddy (Tavsiya etiladi — 3 daqiqada avto-SSL bilan)

**Talab:** VPS da `docker` va `docker compose` o‘rnatilgan bo‘lsin, domeningizning **A-record** i VPS IP siga qaratilgan bo‘lsin, `80` va `443` portlar ochiq bo‘lsin.

```bash
# 1. Repozitoriyni yuklab olish (yoki yangilash)
git clone https://github.com/Asil2004/My-autnomius-car.git
cd My-autnomius-car/vps

# 2. .env faylini yaratish
cp .env.example .env

# 3. Domen va maxfiy robot tokenini yozish
# Token generatsiya qilish: openssl rand -hex 24
nano .env

# 4. Ishga tushirish (Caddy avtomatik Let's Encrypt HTTPS sertifikat oladi!)
docker compose up -d --build
```

**Tekshirish:**
```bash
curl https://SIZNING_DOMEN/health
# Kutilgan javob: {"ok":true,"mode":"vps_cloud_relay","robots_online":[]}
```

**Keyinchalik kodni yangilash (git pull dan keyin):**
```bash
cd My-autnomius-car
git pull origin main
cd vps && docker compose up -d --build
```

---

## 2-USUL: Docker siz (Mavjud Nginx + Systemd orqali)

Agar VPS da Nginx allaqachon boshqa saytlar bilan ishlayotgan bo‘lsa:

```bash
cd My-autnomius-car
python3 -m venv vps/.venv
vps/.venv/bin/pip install -r vps/requirements.txt

# Systemd xizmati yaratish (TOKEN ni o'zgartiring!)
sudo tee /etc/systemd/system/qalqon-vps.service > /dev/null << EOF
[Unit]
Description=QALQON VPS Cloud Relay & VR Hub
After=network.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
Environment="QALQON_ROBOT_TOKEN=SIZNING_MAXFIY_TOKEN"
Environment="QALQON_DEFAULT_ROBOT_ID=QALQON-01"
ExecStart=$(pwd)/vps/.venv/bin/uvicorn vps.vps_hub:app --host 127.0.0.1 --port 8000 --ws-ping-interval 20 --ws-ping-timeout 20
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now qalqon-vps
```

Keyin `vps/nginx.conf.example` dagi konfiguratsiyani Nginx ga qo‘shib, `sudo certbot --nginx -d SIZNING_DOMEN` bilan HTTPS yoqing.

> ⚠️ **MUHIM (Nginx):** `proxy_buffering off;` va WebSocket (`Upgrade` / `Connection "upgrade"`) qatorlari albatta bo‘lishi shart — aks holda jonli video kechikadi va robot ulanmaydi!

---

## 3-QADAM: Raspberry Pi 5 ni VPS ga ulash (Robot tomoni)

VPS ko‘tarilgach, Raspberry Pi 5 terminalida faqat **1 ta buyruq** beriladi:

```bash
cd ~/My-autnomius-car
git pull origin main
sudo bash raspberry_pi/setup_vps_uplink.sh https://SIZNING_DOMEN SIZNING_MAXFIY_TOKEN
```

Tekshirish:
```bash
sudo systemctl status qalqon-uplink
```
Endi `https://SIZNING_DOMEN/api/robots` sahifasida `QALQON-01` **online: true** bo‘lib ko‘rinadi!

---

## 4-QADAM: Meta Quest 2 VR da ochish

1. Meta Quest 2 ni **istalgan Wi-Fi** ga ulang (robot bilan bitta Wi-Fi bo‘lishi SHART EMAS!).
2. **Meta Quest Browser** da oching:
   * 🥽 **VR Kokpit:** `https://SIZNING_DOMEN/#vr`
   * 🖥️ **To‘liq Operator HUD:** `https://SIZNING_DOMEN/#hud`
3. **`META QUEST 2 — VR REJIMGA KIRISH (WebXR)`** tugmasini bosing:
   * **Chap Touch Joystik:** Robotni 360° haydash
   * **O‘ng Touch Joystik:** PTZ kamerani burish
   * **`A` tugmasi:** Kameralarni almashtirish (3-Linza Panorama / Frontal USB / PTZ / O‘ng / Chap)
   * **`B` tugmasi:** Bosh harakati (Head-Tracking) bilan PTZ ni burishni yoqish/o‘chirish
   * **`X` tugmasi:** Tezlikni o‘zgartirish (50% / 75% / 100%)
   * **O‘ng Trigger:** Favqulodda **E-STOP**
