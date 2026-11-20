#!/usr/bin/env bash
# ==============================================================================
# QALQON - RASPBERRY PI 5 BARCHA TIZIMLARNI O'RNATISH VA ISHGA TUSHIRISH
# 1. LiDAR STL-19P & Frontal USB Vebkamera Hub (Port 8000)
# 2. CP-159-1 PTZ Kamera Serveri (Port 8090)
# 3. LG290P GNSS RTK -> Trackk Cloud Bridge
# ==============================================================================
set -e

# Joriy foydalanuvchi va repozitoriy katalogini avtomatik aniqlash
ACTUAL_USER="${SUDO_USER:-$USER}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "👤 Foydalanuvchi: $ACTUAL_USER"
echo "📁 Loyiha manzili: $REPO_DIR"

echo "🚀 [1/5] Tizim paketlari yangilanmoqda va zarur kutubxonalar o'rnatilmoqda..."
apt-get update
apt-get install -y python3 python3-pip python3-venv git v4l-utils libgl1-mesa-glx libglib2.0-0 udev dnsmasq

# Ruxsatlarni berish
usermod -aG dialout,video "$ACTUAL_USER" || true

cd "$REPO_DIR"

echo "🐍 [2/5] Python Virtual Muhiti (venv) sozlanmoqda..."
if [ ! -d "$REPO_DIR/venv" ]; then
    sudo -u "$ACTUAL_USER" python3 -m venv "$REPO_DIR/venv"
fi

sudo -u "$ACTUAL_USER" "$REPO_DIR/venv/bin/pip" install --upgrade pip
sudo -u "$ACTUAL_USER" "$REPO_DIR/venv/bin/pip" install fastapi uvicorn websockets pyserial requests opencv-python-headless python-dotenv httpx paho-mqtt

echo "🔌 [3/5] Udev qoidalari o'rnatilmoqda (LiDAR va GPS portlari adashmasligi uchun)..."
tee /etc/udev/rules.d/99-qalqon-devices.rules > /dev/null << 'EOF'
# LiDAR CP2102 / CH340 / Silicon Labs
SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", SYMLINK+="lidar", MODE="0666"
# Waveshare LG290P GNSS RTK Module
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7523", SYMLINK+="gps", MODE="0666"
SUBSYSTEM=="tty", ATTRS{idVendor}=="2e8a", SYMLINK+="gps", MODE="0666"
EOF
udevadm control --reload-rules && udevadm trigger

echo "⚙️ [4/5] Systemd servislarini o'rnatish..."

# 1. QALQON HUB & LIDAR & WEBCAM SERVICE (Port 8000)
tee /etc/systemd/system/qalqon-hub.service > /dev/null << EOF
[Unit]
Description=QALQON Brain, LiDAR STL-19P & USB Webcam Server
After=network.target

[Service]
Type=simple
User=$ACTUAL_USER
WorkingDirectory=$REPO_DIR
Environment="PATH=$REPO_DIR/venv/bin:/usr/local/bin:/usr/bin"
ExecStart=$REPO_DIR/venv/bin/python3 $REPO_DIR/lidar_bridge_server.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# 2. QALQON PTZ CAMERA SERVICE (Port 8090)
tee /etc/systemd/system/qalqon-camera.service > /dev/null << EOF
[Unit]
Description=QALQON CP-159-1 PTZ Camera Server
After=network.target

[Service]
Type=simple
User=$ACTUAL_USER
WorkingDirectory=$REPO_DIR/camera_server
Environment="PATH=$REPO_DIR/venv/bin:/usr/local/bin:/usr/bin"
ExecStart=$REPO_DIR/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8090
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# 3. QALQON LG290P RTK GPS BRIDGE SERVICE
tee /etc/systemd/system/qalqon-gps.service > /dev/null << EOF
[Unit]
Description=QALQON LG290P RTK GNSS to Trackk Cloud Bridge
After=network.target

[Service]
Type=simple
User=$ACTUAL_USER
WorkingDirectory=$REPO_DIR
Environment="PATH=$REPO_DIR/venv/bin:/usr/local/bin:/usr/bin"
ExecStart=$REPO_DIR/venv/bin/python3 $REPO_DIR/raspberry_pi/pi5_gps_trackk_bridge.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "🔥 [5/5] Servislarni faollashtirish va ishga tushirish..."
systemctl daemon-reload
systemctl enable qalqon-hub qalqon-camera qalqon-gps
systemctl restart qalqon-hub qalqon-camera qalqon-gps

echo "======================================================================"
echo "✅ BARCHA SERVISLAR RASPBERRY PI 5 DA ISHGA TUSHIRILDI!"
echo "📡 1. LiDAR & Webcam & HUD: http://10.180.187.132:8000/#hud"
echo "📹 2. PTZ Kamera:           http://10.180.187.132:8090/camera"
echo "🛰️ 3. LG290P RTK GPS:       Trackk Serveriga avto-sinxronlanmoqda"
echo "======================================================================"
