#!/bin/bash
# =============================================================================
# 🛡️ QALQON v1.0 — Raspberry Pi 4 Ishga Tushirish Skripti
# =============================================================================

echo "=========================================================="
echo "🛡️ QALQON AMR — RASPBERRY PI 4 TIZIMI ISHGA TUSHMOQDA..."
echo "=========================================================="

# 1. Eski barcha jarayonlarni qat'iy to'xtatish (8000 va 8080 portlarni 100% bo'shatish)
echo "[1/3] Eski jarayonlar va portlar tozalanmoqda..."
pkill -9 -f "qalqon_brain" 2>/dev/null || true
pkill -9 -f "uvicorn" 2>/dev/null || true
pkill -9 -f "python3.*qalqon" 2>/dev/null || true
fuser -k -9 8000/tcp 8080/tcp 2>/dev/null || true
lsof -ti:8000 | xargs -r kill -9 2>/dev/null || true
lsof -ti:8080 | xargs -r kill -9 2>/dev/null || true
sleep 1

# 2. Qurilmalarga ruxsat berish (agar kerak bo'lsa)
chmod 666 /dev/ttyACM* /dev/ttyUSB* /dev/video* 2>/dev/null || true

# 3. IP manzilni aniqlash
IP_ADDR=$(hostname -I | awk '{print $1}')
echo ""
echo "----------------------------------------------------------"
echo "🌐 Raspberry Pi IP manzili: $IP_ADDR"
echo "📱 Telefonda ochish uchun:  http://$IP_ADDR:8000"
echo "                           yoki http://$IP_ADDR:8080"
echo "----------------------------------------------------------"
echo ""

# 4. Kerakli Python kutubxonalarini tekshirish va yetishmasa avtomatik o'rnatish
if ! python3 -c "import fastapi, uvicorn, serial, cv2, websockets" 2>/dev/null; then
    echo "[!] FastAPI va tizim kutubxonalari o'rnatilmoqda (bu bir marta bo'ladi)..."
    sudo apt-get update -y
    sudo apt-get install -y python3-pip python3-fastapi python3-uvicorn python3-serial python3-opencv python3-numpy python3-websockets 2>/dev/null || true
    pip3 install --break-system-packages fastapi uvicorn websockets pyserial opencv-python numpy 2>/dev/null || \
    pip3 install fastapi uvicorn websockets pyserial opencv-python numpy 2>/dev/null || true
fi

# 5. Asosiy dasturni ishga tushirish
cd "$(dirname "$0")"
python3 qalqon_brain.py
