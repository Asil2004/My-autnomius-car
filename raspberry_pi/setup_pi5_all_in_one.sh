#!/usr/bin/env bash
# ==============================================================================
# QALQON - RASPBERRY PI 5 BARCHA TIZIMLARNI O'RNATISH VA ISHGA TUSHIRISH
# 1. LiDAR STL-19P Hub (Port 8000)
# 2. CP-159-1 PTZ Kamera Serveri (Port 8090)
# 3. LG290P GNSS RTK -> Trackk Cloud Bridge
# ==============================================================================
set -e

echo "🚀 [1/5] Tizim paketlari yangilanmoqda va zarur kutubxonalar o'rnatilmoqda..."
sudo apt-get update
sudo apt-get install -y python3 python3-pip python3-venv git v4l-utils libgl1-mesa-glx libglib2.0-0 udev

REPO_DIR="/home/pi/repo_autnomius_car"
if [ ! -d "$REPO_DIR" ]; then
    echo "📁 Repozitoriy klonlanmoqda..."
    git clone https://github.com/Asil2004/My-autnomius-car.git "$REPO_DIR"
fi
cd "$REPO_DIR"
git pull origin main

echo "🐍 [2/5] Python Virtual Muhiti (venv) yaratilmoqda..."
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install fastapi uvicorn websockets pyserial requests opencv-python-headless python-dotenv

echo "🔌 [3/5] Udev qoidalari o'rnatilmoqda (LiDAR va GPS portlari adashmasligi uchun)..."
sudo tee /etc/udev/rules.d/99-qalqon-devices.rules > /dev/null << 'EOF'
# LiDAR CP2102 / CH340 / Silicon Labs
SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", SYMLINK+="lidar", MODE="0666"
# Waveshare LG290P GNSS RTK Module
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7523", SYMLINK+="gps", MODE="0666"
SUBSYSTEM=="tty", ATTRS{idVendor}=="2e8a", SYMLINK+="gps", MODE="0666"
EOF
sudo udevadm control --reload-rules && sudo udevadm trigger

echo "⚙️ [4/5] Systemd servislarini o'rnatish..."

# 1. QALQON HUB & LIDAR SERVICE (Port 8000)
sudo tee /etc/systemd/system/qalqon-hub.service > /dev/null << EOF
[Unit]
Description=QALQON Brain & LiDAR STL-19P Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=$REPO_DIR
Environment="PATH=$REPO_DIR/venv/bin:/usr/local/bin:/usr/bin"
ExecStart=$REPO_DIR/venv/bin/python3 $REPO_DIR/lidar_bridge_server.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# 2. QALQON PTZ CAMERA SERVICE (Port 8090)
sudo tee /etc/systemd/system/qalqon-camera.service > /dev/null << EOF
[Unit]
Description=QALQON CP-159-1 PTZ Camera Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=$REPO_DIR/camera_server
Environment="PATH=$REPO_DIR/venv/bin:/usr/local/bin:/usr/bin"
ExecStart=$REPO_DIR/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8090
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# 3. QALQON LG290P RTK GPS BRIDGE SERVICE
sudo tee /etc/systemd/system/qalqon-gps.service > /dev/null << EOF
[Unit]
Description=QALQON LG290P RTK GNSS to Trackk Cloud Bridge
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=$REPO_DIR
Environment="PATH=$REPO_DIR/venv/bin:/usr/local/bin:/usr/bin"
ExecStart=$REPO_DIR/venv/bin/python3 $REPO_DIR/raspberry_pi/pi5_gps_trackk_bridge.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "🔥 [5/5] Servislarni faollashtirish va ishga tushirish..."
sudo systemctl daemon-reload
sudo systemctl enable qalqon-hub qalqon-camera qalqon-gps
sudo systemctl restart qalqon-hub qalqon-camera qalqon-gps

echo "======================================================================"
echo "✅ BARCHA SERVISLAR RASPBERRY PI 5 DA ISHGA TUSHIRILDI!"
echo "📡 1. LiDAR & Brain:   http://localhost:8000 (yoki ws://PI_IP:8000/ws)"
echo "📹 2. PTZ Kamera:      http://localhost:8090/camera"
echo "🛰️ 3. LG290P RTK GPS:  Trackk Serveriga avto-sinxronlanmoqda"
echo "======================================================================"
