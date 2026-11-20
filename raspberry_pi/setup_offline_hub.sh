#!/bin/bash
# =============================================================================
# 🛡️ QALQON AMR — RASPBERRY PI TO'LIQ O'RNATISH VA SOZLASH SKRIPTI
# FastAPI, Uvicorn, OpenCV, LiDAR va Lokal Xabni 100% tayyorlash
# =============================================================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}==========================================================${NC}"
echo -e "${GREEN}🛡️ QALQON AMR — RASPBERRY PI TIZIMINI TO'LIQ SOZLASH...${NC}"
echo -e "${BLUE}==========================================================${NC}"

REAL_USER=${SUDO_USER:-$USER}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 1. LINUX APT PAKETLARINI O'RNATISH (Tez va ishonchli ARM paketlari)
echo -e "${YELLOW}[1/6] Kerakli Python va tizim kutubxonalari o'rnatilmoqda (APT)...${NC}"
sudo apt-get update -y
sudo apt-get install -y \
    python3-pip \
    python3-dev \
    python3-venv \
    python3-serial \
    python3-numpy \
    python3-opencv \
    python3-requests \
    python3-websockets || true

# 2. FASTAPI VA UVICORN NI O'RNATISH
echo -e "${YELLOW}[2/6] FastAPI, Uvicorn va veb-server kutubxonalarini o'rnatish...${NC}"
# Avval apt orqali harakat qilamiz (Debian Bookworm uchun)
sudo apt-get install -y python3-fastapi python3-uvicorn 2>/dev/null || true

# Agar pip orqali o'rnatish kerak bo'lsa (--break-system-packages Debian 12 Bookworm uchun)
python3 -c "import fastapi, uvicorn" 2>/dev/null || {
    echo "pip orqali qo'shimcha paketlar o'rnatilmoqda..."
    pip3 install --break-system-packages fastapi uvicorn websockets pyserial opencv-python numpy || \
    pip3 install fastapi uvicorn websockets pyserial numpy || true
}

# 3. KUTUBXONALARNI TEKSHIRISH (DIAGNOSTIKA)
echo -e "${YELLOW}[3/6] Python muhiti tekshirilmoqda...${NC}"
python3 - << 'EOF'
import sys
modules = ["fastapi", "uvicorn", "serial", "cv2", "numpy"]
errors = []
for m in modules:
    try:
        __import__(m)
        print(f"  [OK] {m} muvaffaqiyatli yuklandi.")
    except ImportError as e:
        errors.append(f"  [XATO] {m} topilmadi: {e}")

if errors:
    print("\nYetishmayotgan kutubxonalar:")
    for err in errors:
        print(err)
    sys.exit(1)
else:
    print("\n>>> BARCHA ASOSIY KUTUBXONALAR TAYYOR! <<<")
EOF

# 4. SWAP VIRTUAL XOTIRASINI 2048 MB (2 GB) GA OSHIRISH (Qotib qolishni oldini oladi)
echo -e "${YELLOW}[4/6] SWAP xotirasini 2048 MB ga sozlash...${NC}"
if [ -f /etc/dphys-swapfile ]; then
    sudo dphys-swapfile swapoff 2>/dev/null || true
    sudo sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile
    sudo dphys-swapfile setup 2>/dev/null || true
    sudo dphys-swapfile swapon 2>/dev/null || true
    echo "  [OK] Swap 2GB ga sozlandi."
fi
sudo sysctl -w vm.vfs_cache_pressure=50 2>/dev/null || true
sudo sysctl -w vm.swappiness=20 2>/dev/null || true

# 5. APPARAT VA PORT HUQUQLARI (USB, LIDAR, KAMERA)
echo -e "${YELLOW}[5/6] Port va foydalanuvchi huquqlarini sozlash...${NC}"
sudo usermod -a -G dialout,video,tty,i2c "$REAL_USER" 2>/dev/null || true
sudo chmod 666 /dev/ttyUSB* 2>/dev/null || true
sudo chmod 666 /dev/ttyACM* 2>/dev/null || true
sudo chmod 666 /dev/video* 2>/dev/null || true

# 6. ETHERNET INTERFEYSINI STATIK IP (192.168.1.10) GA SOZLASH (PTZ Kamera uchun)
echo -e "${YELLOW}[6/6] PTZ Kamera (192.168.1.100) uchun Ethernet portini sozlash...${NC}"
ETH_IFACE=$(ip link | grep -E 'eth0|end0' | awk -F: '{print $2}' | tr -d ' ' || true)
if [ -n "$ETH_IFACE" ]; then
    sudo ip addr add 192.168.1.10/24 dev $ETH_IFACE 2>/dev/null || true
    echo "  [OK] Ethernet ($ETH_IFACE) ga 192.168.1.10 berildi."
fi

# Keshni tozalash
sudo apt-get clean 2>/dev/null || true

IP_ADDR=$(hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}==========================================================${NC}"
echo -e "${GREEN}✅ SOZLASH MUVAFFAQIYATLI YAKUNLANDI!${NC}"
echo -e "${GREEN}==========================================================${NC}"
echo "🌐 Raspberry Pi IP manzili: $IP_ADDR"
echo "📱 Planshet brauzerida:      http://$IP_ADDR:8000"
echo ""
echo "Robotni ishga tushirish uchun:"
echo "   cd ~/My-autnomius-car/raspberry_pi"
echo "   python3 qalqon_brain.py"
echo "=========================================================="
