#!/bin/bash
# =============================================================================
# 🛡️ QALQON v1.0 — Raspberry Pi 4 Boshqaruv & Miya Tizimini Ishga Tushirish
# =============================================================================

echo "=========================================================="
echo "🛡️ QALQON AMR — RASPBERRY PI 4 TIZIMI ISHGA TUSHMOQDA..."
echo "=========================================================="

# 1. Eski barcha jarayonlarni to'xtatish va portlarni bo'shatish
echo "[1/4] Eski jarayonlar va portlar tozalanmoqda..."
pkill -9 -f "qalqon_brain" 2>/dev/null || true
pkill -9 -f "ptz_camera_launcher" 2>/dev/null || true
pkill -9 -f "camera_server" 2>/dev/null || true
pkill -9 -f "start_tunnel" 2>/dev/null || true
pkill -9 -f "cloudflared" 2>/dev/null || true
pkill -9 -f "uvicorn" 2>/dev/null || true
fuser -k -9 8000/tcp 8080/tcp 8090/tcp 67/udp 2>/dev/null || true
sleep 1

# 2. Qurilmalarga ruxsat berish
chmod 666 /dev/ttyACM* /dev/ttyUSB* /dev/video* 2>/dev/null || true

# 3. IP manzilni aniqlash
IP_ADDR=$(hostname -I | awk '{print $1}')
echo ""
echo "----------------------------------------------------------"
echo "🌐 Raspberry Pi Lokal IP:   http://$IP_ADDR:8000"
echo "----------------------------------------------------------"
echo ""

# 4. Kerakli Python kutubxonalarini tekshirish va yetishmasa avtomatik o'rnatish
if ! python3 -c "import fastapi, uvicorn, serial, cv2, websockets, paho.mqtt, httpx" 2>/dev/null; then
    echo "[!] FastAPI, MQTT va tizim kutubxonalari o'rnatilmoqda..."
    sudo apt-get update -y
    sudo apt-get install -y python3-pip python3-fastapi python3-uvicorn python3-serial python3-opencv python3-numpy python3-websockets python3-paho-mqtt python3-httpx 2>/dev/null || true
    pip3 install --break-system-packages fastapi uvicorn websockets pyserial opencv-python numpy paho-mqtt httpx 2>/dev/null || \
    pip3 install fastapi uvicorn websockets pyserial opencv-python numpy paho-mqtt httpx 2>/dev/null || true
fi

cd "$(dirname "$0")"

# 5. PTZ 3-Linzali Kamera Serverini (LAN eth0 -> 8090) orqa fonda ishga tushirish
if [ -f "ptz_camera_launcher.py" ]; then
    echo "[!] 3-Linzali PTZ Kamera serveri (LAN eth0 -> 8090) orqa fonda ishga tushirilmoqda..."
    python3 ptz_camera_launcher.py &
    sleep 1
fi

# 6. Cloudflare HTTPS Tunnelni orqa fonda ishga tushirish (WebXR va GitHub Pages uchun)
if [ -f "start_tunnel.sh" ]; then
    echo "[!] Cloudflare HTTPS Tunnel (WebXR uchun) orqa fonda ishga tushirilmoqda..."
    bash start_tunnel.sh &
    sleep 2
elif [ -f "start_tunnel.py" ]; then
    python3 start_tunnel.py &
    sleep 2
fi

# 7. Asosiy Robot Miya Dasturini ishga tushirish (8000)
python3 qalqon_brain.py
