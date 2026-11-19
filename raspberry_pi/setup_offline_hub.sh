#!/bin/bash
# =============================================================================
# 🛡️ QALQON AMR — RASPBERRY PI LOKAL AVTONOM XAB SOZLAMASI (OFFLINE HUB)
# Internet yo'qolganda ham robot to'liq lokal tarmoqda 100% ishlashi uchun!
# =============================================================================

set -e

echo "=========================================================="
echo "🛡️ QALQON — OFFLINE LOKAL SERVERNI OPTIMALLASHTIRISH..."
echo "=========================================================="

# 1. SWAP XOTIRANI 2048 MB (2 GB) GA OSHIRISH (RAM tiqilishini oldini oladi)
echo "[1/5] SWAP virtual xotirasini 2GB ga sozlash..."
if [ -f /etc/dphys-swapfile ]; then
    sudo dphys-swapfile swapoff || true
    sudo sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile
    sudo dphys-swapfile setup
    sudo dphys-swapfile swapon
    echo "[OK] Swap 2048 MB ga oshirildi."
fi

# 2. LINUX XOTIRA VA KESH PARAMETRLARINI OPTIMALLASHTIRISH
echo "[2/5] RAM kesh yuvish va parametrlarini sozlash..."
sudo sysctl -w vm.vfs_cache_pressure=50
sudo sysctl -w vm.swappiness=20

# 3. APPARAT HUQUQLARI (LIDAR, ARDUINO/ESP32, KAMERA)
echo "[3/5] Serial va USB drayver huquqlarini berish..."
sudo usermod -a -G dialout,video,tty $USER || true
sudo chmod 666 /dev/ttyUSB* 2>/dev/null || true
sudo chmod 666 /dev/ttyACM* 2>/dev/null || true
sudo chmod 666 /dev/video* 2>/dev/null || true

# 4. STATIK ETHERNET (PTZ KAMERA UCHUN 192.168.1.10)
echo "[4/5] Ethernet portini PTZ kamera (192.168.1.100) bilan bog'lash..."
# eth0 interfeysiga 192.168.1.10/24 manzilini beramiz
ETH_IFACE=$(ip link | grep -E 'eth0|end0' | awk -F: '{print $2}' | tr -d ' ' || true)
if [ -n "$ETH_IFACE" ]; then
    sudo ip addr add 192.168.1.10/24 dev $ETH_IFACE 2>/dev/null || true
    echo "[OK] Ethernet ($ETH_IFACE) manziliga 192.168.1.10 berildi."
fi

# 5. KESH VA ESKI LOGLARNI TOZALASH
echo "[5/5] Eski tizim keshlarini tozalash..."
sudo apt-get clean || true
sudo rm -rf /tmp/* 2>/dev/null || true
sudo rm -rf ~/.cache/* 2>/dev/null || true

echo ""
echo "=========================================================="
echo "✅ OPTIMALLASHTIRISH YAKUNLANDI!"
echo "Qalqon lokal serverini ishga tushirish uchun:"
echo "   cd ~/My-autnomius-car/raspberry_pi"
echo "   python3 qalqon_brain.py"
echo "=========================================================="
