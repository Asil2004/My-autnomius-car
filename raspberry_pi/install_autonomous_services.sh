#!/bin/bash
# =============================================================================
# 🛡️ QALQON v1.0 — Raspberry Pi 4 Avtonom Tizim & OTA O'rnatish Skripti
# =============================================================================
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}===================================================================${NC}"
echo -e "${GREEN}🛡️  QALQON v1.0 — AVTONOM TIZIM VA OTA AUTO-UPDATERNI SOZLASH${NC}"
echo -e "${BLUE}===================================================================${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[Xatolik] Ushbu skriptni 'sudo' huquqi bilan ishga tushiring!${NC}"
  echo "Misol: sudo bash install_autonomous_services.sh"
  exit 1
fi

# 1. Haqiqiy foydalanuvchi va repozitoriya yo'lini aniqlash
REAL_USER=${SUDO_USER:-$USER}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${YELLOW}[1/6] Muhit aniqlandi:${NC}"
echo "  - Foydalanuvchi: $REAL_USER"
echo "  - Repozitoriya:  $REPO_DIR"
echo "  - Skript papka:   $SCRIPT_DIR"

# 2. Log papkalarini yaratish
echo -e "${YELLOW}[2/6] Log tizimi sozlanmoqda (/var/log/qalqon)...${NC}"
mkdir -p /var/log/qalqon
chown -R "$REAL_USER:$REAL_USER" /var/log/qalqon
chmod 755 /var/log/qalqon

# 3. Serial / USB portlar uchun udev va sudoers ruxsatlarini berish
echo -e "${YELLOW}[3/6] Udev va Sudoers xavfsizlik ruxsatlari sozlanmoqda...${NC}"
usermod -a -G dialout,video,i2c,gpio "$REAL_USER" || true

SUDOERS_FILE="/etc/sudoers.d/qalqon_permissions"
cat << EOF > "$SUDOERS_FILE"
# QALQON avtonom xizmatlari uchun parolsiz ruxsatlar
$REAL_USER ALL=(ALL) NOPASSWD: /bin/systemctl restart qalqon-core.service
$REAL_USER ALL=(ALL) NOPASSWD: /bin/systemctl restart qalqon-core
$REAL_USER ALL=(ALL) NOPASSWD: /bin/systemctl status qalqon-core
$REAL_USER ALL=(ALL) NOPASSWD: /bin/chmod 666 /dev/ttyACM*
$REAL_USER ALL=(ALL) NOPASSWD: /bin/chmod 666 /dev/ttyUSB*
$REAL_USER ALL=(ALL) NOPASSWD: /bin/chmod 666 /dev/video*
EOF
chmod 440 "$SUDOERS_FILE"

# 4. Systemd service fayllarini tayyorlash va o'rnatish
echo -e "${YELLOW}[4/6] Systemd xizmatlari moslashtirilmoqda va o'rnatilmoqda...${NC}"

# qalqon-core.service
cat << EOF > /etc/systemd/system/qalqon-core.service
[Unit]
Description=QALQON v1.0 — Autonomous Patrol Robot Core Brain Service
After=network-online.target time-sync.target
Wants=network-online.target

[Service]
Type=simple
User=$REAL_USER
WorkingDirectory=$SCRIPT_DIR
ExecStartPre=/bin/bash -c "chmod 666 /dev/ttyACM* /dev/ttyUSB* /dev/video* 2>/dev/null || true"
ExecStart=/usr/bin/python3 $SCRIPT_DIR/qalqon_brain.py
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

# qalqon-updater.service
cat << EOF > /etc/systemd/system/qalqon-updater.service
[Unit]
Description=QALQON v1.0 — Autonomous OTA Git Auto-Updater & Watchdog
After=network-online.target qalqon-core.service
Wants=network-online.target

[Service]
Type=simple
User=$REAL_USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/bin/python3 $SCRIPT_DIR/qalqon_ota_updater.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

# 5. Xizmatlarni tizimga yuklash va avtostartni yoqish
echo -e "${YELLOW}[5/6] Systemd yangilanmoqda va xizmatlar avtomatik ishga tushirilmoqda...${NC}"
systemctl daemon-reload
systemctl enable qalqon-core.service
systemctl enable qalqon-updater.service

systemctl restart qalqon-core.service
systemctl restart qalqon-updater.service

# 6. Holatni tekshirish
echo -e "${YELLOW}[6/6] Xizmatlar holati tekshirilmoqda...${NC}"
sleep 2

echo ""
echo -e "${GREEN}===================================================================${NC}"
echo -e "${GREEN}🎉 QALQON AVTONOM TIZIMI MUVAFFAQIYATLI O'RNATILDI VA ISHGA TUSHDI!${NC}"
echo -e "${GREEN}===================================================================${NC}"
echo ""
echo -e "🔹 ${BLUE}Asosiy boshqaruv:${NC}    sudo systemctl status qalqon-core"
echo -e "🔹 ${BLUE}Avto-yangilanish:${NC}    sudo systemctl status qalqon-updater"
echo -e "🔹 ${BLUE}Jonli loglar:${NC}        journalctl -u qalqon-core -f"
echo -e "🔹 ${BLUE}OTA yangilanish log:${NC} tail -f /var/log/qalqon/ota_updater.log"
echo ""
echo -e "${YELLOW}Endi Raspberry Pi har safar yoqilganda (boot):${NC}"
echo " 1. QALQON miyasi (qalqon_brain.py) avtomatik o'zi ishga tushadi."
echo " 2. OTA Auto-Updater GitHub'dagi (main) barcha yangilanishlarni doimiy kuzatib boradi."
echo " 3. GitHub'ga kod push qilinganda robot o'zini yangilab, avtonom qayta yuklanadi!"
echo ""
