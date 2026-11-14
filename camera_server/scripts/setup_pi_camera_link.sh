#!/usr/bin/env bash
# QALQON: CP-159-1 PTZ kamerani Raspberry Pi'ning eth0 portiga to'g'ridan-to'g'ri
# LAN kabel bilan ulash (noutbuk uchun start.ps1 / kamera_dhcp.ps1 ning Linux muqobili).
#
#   - eth0 ga statik IP beradi: 192.168.1.10/24 (Pi)
#   - eth0 da mini-DHCP xizmati ishga tushiradi: kamera avtomatik 192.168.1.100 oladi
#   - camera_server uchun Python muhit (.venv) tayyorlaydi
#   - qalqon-cam-dhcp va qalqon-camera-server systemd xizmatlarini yaratib, avto-start qiladi
#
# Ishga tushirish:
#   sudo bash scripts/setup_pi_camera_link.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Bu skriptni sudo bilan ishga tushiring: sudo bash $0"
  exit 1
fi

REAL_USER="${SUDO_USER:-$(logname 2>/dev/null || echo pi)}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # .../camera_server

echo "[1/5] eth0 ga statik IP (192.168.1.10/24) beriladi..."
CONN="$(nmcli -t -f NAME,DEVICE connection show | awk -F: '$2=="eth0"{print $1; exit}')"
if [ -z "$CONN" ]; then
  CONN="$(nmcli -t -f NAME,TYPE connection show | awk -F: '$2=="802-3-ethernet"{print $1; exit}')"
fi
if [ -z "$CONN" ]; then
  echo "    eth0 uchun NetworkManager profili topilmadi, yangisi yaratilmoqda..."
  nmcli connection add type ethernet ifname eth0 con-name qalqon-cam-eth0
  CONN=qalqon-cam-eth0
fi
nmcli connection modify "$CONN" \
  ipv4.method manual ipv4.addresses 192.168.1.10/24 ipv4.gateway "" \
  ipv4.never-default yes ipv4.ignore-auto-dns yes
nmcli connection up "$CONN"
echo "    -> $CONN : 192.168.1.10/24"

echo "[2/5] Kamera uchun DHCP xizmati sozlanmoqda (192.168.1.100 beriladi)..."
cat > /etc/dnsmasq-qalqon-cam.conf <<'EOF'
interface=eth0
bind-interfaces
port=0
dhcp-range=192.168.1.100,192.168.1.100,255.255.255.0,12h
EOF

cat > /etc/systemd/system/qalqon-cam-dhcp.service <<EOF
[Unit]
Description=QALQON PTZ kamera uchun DHCP (faqat eth0)
After=NetworkManager.service
Wants=network-online.target

[Service]
ExecStart=/usr/sbin/dnsmasq --conf-file=/etc/dnsmasq-qalqon-cam.conf --no-daemon
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "[3/5] camera_server uchun Python muhiti tayyorlanmoqda..."
sudo -u "$REAL_USER" bash -c "cd '$DIR' && python3 -m venv .venv && .venv/bin/pip install --upgrade pip && .venv/bin/pip install -r requirements.txt"
[ -f "$DIR/.env" ] || sudo -u "$REAL_USER" cp "$DIR/.env.example" "$DIR/.env"

echo "[4/5] qalqon-camera-server xizmati yaratilmoqda (avto-start, port 8090)..."
cat > /etc/systemd/system/qalqon-camera-server.service <<EOF
[Unit]
Description=QALQON PTZ kamera serveri (ONVIF, port 8090)
After=qalqon-cam-dhcp.service
Wants=qalqon-cam-dhcp.service

[Service]
Type=simple
User=$REAL_USER
WorkingDirectory=$DIR
ExecStart=$DIR/.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8090
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

echo "[5/5] Xizmatlar yoqilmoqda va ishga tushirilmoqda..."
systemctl daemon-reload
systemctl enable --now qalqon-cam-dhcp.service
systemctl enable --now qalqon-camera-server.service

PI_IP="$(hostname -I | awk '{print $1}')"
echo ""
echo "================================================================="
echo " TAYYOR!"
echo " Kamera kabeli eth0 ga ulangan bo'lishi kerak (quvvat yoqilgan holda)."
echo " Bir necha soniyadan keyin kamera 192.168.1.100 manzilini oladi."
echo ""
echo " Tekshirish:"
echo "   systemctl status qalqon-cam-dhcp qalqon-camera-server"
echo "   journalctl -u qalqon-cam-dhcp -u qalqon-camera-server -f"
echo "   curl http://192.168.1.10:8090/camera/status"
echo ""
echo " Brauzerda:  http://${PI_IP}:8090/camera/"
echo " HUD sozlamasida kamera manzili: http://${PI_IP}:8090/camera"
echo "================================================================="
