#!/bin/bash
# =============================================================================
# QALQON - Raspberry Pi 3 Model B uchun Kamera Serverini O'rnatish Skripti
# =============================================================================

set -e

echo "================================================================="
echo "   QALQON - Raspberry Pi 3 Model B Kamera Tizimini O'rnatish    "
echo "================================================================="

CURRENT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SERVICE_NAME="qalqon-camera"

echo "[1/4] Tizim paketlarini yangilash va OpenCV o'rnatish..."
sudo apt-get update
sudo apt-get install -y python3 python3-pip python3-opencv ffmpeg

echo "[2/4] Skript ruxsatlarini sozlash..."
chmod +x "$CURRENT_DIR/pi3_camera_server.py"

echo "[3/4] Systemd avto-yuklanish xizmatini (Service) yaratish..."
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

sudo bash -c "cat > ${SERVICE_FILE}" <<EOL
[Unit]
Description=Qalqon Pi3 Camera Hub Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${CURRENT_DIR}
ExecStart=/usr/bin/python3 ${CURRENT_DIR}/pi3_camera_server.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOL

echo "[4/4] Xizmatni yoqish va ishga tushirish..."
sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE_NAME}.service
sudo systemctl restart ${SERVICE_NAME}.service

LOCAL_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "================================================================="
echo "🎉 O'RNATISH TUGADI VA KAMERA TIZIMI ISHGA TUSHIRILDI!"
echo "================================================================="
echo "Endi Raspberry Pi 3 yonganda tizim avtomatik ishga tushadi."
echo ""
echo "Brauzeringiz orqali videoni ko'rish uchun manzillar:"
echo "  ➡️  http://${LOCAL_IP}:8080"
echo "  ➡️  yoki http://localhost:8080"
echo ""
echo "Holatni tekshirish uchun: sudo systemctl status ${SERVICE_NAME}"
echo "Loglarni ko'rish uchun:   sudo journalctl -u ${SERVICE_NAME} -f"
echo "================================================================="
