#!/usr/bin/env bash
# =============================================================================
# 🛡️ QALQON AMR — TO'LIQ BIR QATORLI AVTOMATIK O'RNATISH VA ISHGA TUSHIRISH
# Yangi o'rnatilgan Raspberry Pi OS uchun 100% to'liq tayyorlash skripti
# =============================================================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "\n${BLUE}=================================================================${NC}"
echo -e "${GREEN}   🛡️  QALQON AMR: AVTOMATIK TIZIM O'RNATUVCHISI (RASPBERRY PI)${NC}"
echo -e "${BLUE}=================================================================${NC}\n"

# 1. Tizim paketlarini yangilash va Git o'rnatish
echo -e "${YELLOW}[1/5] Git va tizim drayverlari o'rnatilmoqda...${NC}"
sudo apt-get update -y
sudo apt-get install -y git curl wget python3-pip python3-dev python3-serial python3-numpy python3-opencv python3-websockets python3-fastapi python3-uvicorn 2>/dev/null || true

# 2. Loyihani GitHub dan yuklab olish (yoki yangilash)
echo -e "${YELLOW}[2/5] Qalqon loyihasi yuklab olinmoqda (GitHub)...${NC}"
cd "$HOME"
if [ ! -d "$HOME/My-autnomius-car" ]; then
    git clone https://github.com/Asil2004/My-autnomius-car.git
else
    cd "$HOME/My-autnomius-car"
    git pull origin main || true
fi

cd "$HOME/My-autnomius-car"

# 3. Offlayn xab va kutubxonalarni sozlash
echo -e "${YELLOW}[3/5] Kutubxonalar, Swap (2GB) va USB ruxsatlari sozlanmoqda...${NC}"
bash "$HOME/My-autnomius-car/raspberry_pi/setup_offline_hub.sh"

# 4. Wi-Fi ni doimiy va uzilmaydigan qilish
echo -e "${YELLOW}[4/5] Wi-Fi doimiy uzilmaydigan qilib sozlanmoqda...${NC}"
bash "$HOME/My-autnomius-car/raspberry_pi/fix_wifi_permanent.sh" 2>/dev/null || true

# 5. Muvaffaqiyat xabari va ishga tushirish
IP_ADDR=$(hostname -I | awk '{print $1}')
echo -e "\n${BLUE}=================================================================${NC}"
echo -e "${GREEN}   🎉 TABRIKLAYMIZ! QALQON TIZIMI TO'LIQ O'RNATILDI!${NC}"
echo -e "${BLUE}=================================================================${NC}"
echo -e "  🌐 Raspberry Pi IP:     ${GREEN}http://$IP_ADDR:8000${NC}"
echo -e "  📱 Qo'lda ishga tushirish: ${YELLOW}bash ~/My-autnomius-car/raspberry_pi/start_brain.sh${NC}"
echo -e "${BLUE}=================================================================${NC}\n"

echo -e "${GREEN}🚀 Tizim ishga tushirilmoqda...${NC}"
sleep 2
bash "$HOME/My-autnomius-car/raspberry_pi/start_brain.sh"
