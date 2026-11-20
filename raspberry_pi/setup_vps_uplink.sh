#!/usr/bin/env bash
# ==============================================================================
# QALQON — Raspberry Pi 5 ni VPS Cloud Hub ga 1 buyruq bilan ulash
# Ishlatish:
#   sudo bash raspberry_pi/setup_vps_uplink.sh https://sizning-domeningiz.uz MAXFIY_TOKEN [QALQON-01]
# ==============================================================================
set -e

VPS_URL="$1"
ROBOT_TOKEN="$2"
ROBOT_ID="${3:-QALQON-01}"

if [ -z "$VPS_URL" ] || [ -z "$ROBOT_TOKEN" ]; then
    echo "Foydalanish:"
    echo "  sudo bash raspberry_pi/setup_vps_uplink.sh <HTTPS_DOMEN> <MAXFIY_TOKEN> [ROBOT_ID]"
    echo "Misol:"
    echo "  sudo bash raspberry_pi/setup_vps_uplink.sh https://qalqon.uz abc123secret QALQON-01"
    exit 1
fi

ACTUAL_USER="${SUDO_USER:-$USER}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🛡️  [1/4] Sozlamalar saqlanmoqda (/etc/qalqon/vps.env)..."
mkdir -p /etc/qalqon
cat > /etc/qalqon/vps.env << EOF
QALQON_VPS_URL=$VPS_URL
QALQON_ROBOT_TOKEN=$ROBOT_TOKEN
QALQON_ROBOT_ID=$ROBOT_ID
WEBCAM_UPLINK_FPS=12
PTZ_UPLINK_FPS=10
PTZ_UPLINK_MAX_WIDTH=960
PTZ_UPLINK_QUALITY=58
EOF
chmod 600 /etc/qalqon/vps.env
chown "$ACTUAL_USER:$ACTUAL_USER" /etc/qalqon/vps.env || true

echo "🐍 [2/4] Kerakli kutubxonalar tekshirilmoqda (httpx, websockets, paho-mqtt)..."
if [ -x "$REPO_DIR/venv/bin/pip" ]; then
    sudo -u "$ACTUAL_USER" "$REPO_DIR/venv/bin/pip" install -q httpx websockets paho-mqtt
    PYTHON_BIN="$REPO_DIR/venv/bin/python3"
else
    PYTHON_BIN="$(which python3)"
fi

echo "⚙️  [3/4] Systemd servisi yaratilmoqda (qalqon-uplink.service)..."
cat > /etc/systemd/system/qalqon-uplink.service << EOF
[Unit]
Description=QALQON Pi 5 -> VPS Cloud Uplink (4G/Wi-Fi VR & Telemetry Bridge)
After=network-online.target qalqon-hub.service
Wants=network-online.target

[Service]
Type=simple
User=$ACTUAL_USER
WorkingDirectory=$REPO_DIR
EnvironmentFile=/etc/qalqon/vps.env
ExecStart=$PYTHON_BIN $REPO_DIR/raspberry_pi/vps_uplink.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

echo "🚀 [4/4] qalqon-uplink servisi ishga tushirilmoqda..."
systemctl daemon-reload
systemctl enable qalqon-uplink
systemctl restart qalqon-uplink

echo ""
echo "======================================================================"
echo "✅ RASPBERRY PI 5 VPS GA ULANDI!"
echo "🌐 Sayt (HUD):     $VPS_URL/#hud"
echo "🥽 Meta Quest VR:  $VPS_URL/#vr"
echo "📊 Tekshirish:     sudo systemctl status qalqon-uplink"
echo "======================================================================"
