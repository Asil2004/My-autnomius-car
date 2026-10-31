#!/bin/bash
# =============================================================================
# 🛡️ QALQON v1.0 — Raspberry Pi 4 Ishga Tushirish Skripti
# =============================================================================

echo "=========================================================="
echo "🛡️ QALQON AMR — RASPBERRY PI 4 TIZIMI ISHGA TUSHMOQDA..."
echo "=========================================================="

# 1. Serial va Kamera qurilmalariga kirish huquqlarini ochish
sudo chmod 666 /dev/ttyACM* 2>/dev/null || true
sudo chmod 666 /dev/ttyUSB* 2>/dev/null || true
sudo chmod 666 /dev/video* 2>/dev/null || true

# 2. Python kutubxonalarini tekshirish
python3 -c "import fastapi, uvicorn, cv2, serial" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "[!] Kerakli kutubxonalar yetishmayapti. O'rnatilmoqda..."
    pip3 install --break-system-packages fastapi uvicorn opencv-python pyserial numpy websockets || \
    pip3 install fastapi uvicorn opencv-python pyserial numpy websockets
fi

# 3. IP manzilni aniqlash
IP_ADDR=$(hostname -I | awk '{print $1}')
echo ""
echo "----------------------------------------------------------"
echo "🌐 Raspberry Pi IP manzili: $IP_ADDR"
echo "📱 Telefonda ochish uchun:  http://$IP_ADDR:8000"
echo "                           yoki http://$IP_ADDR:8080"
echo "----------------------------------------------------------"
echo ""

# 4. Asosiy dasturni ishga tushirish
cd "$(dirname "$0")"
python3 qalqon_brain.py
