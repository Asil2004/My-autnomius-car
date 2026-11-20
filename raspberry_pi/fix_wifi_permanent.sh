#!/bin/bash
# =============================================================================
# 🛡️ QALQON AMR — RASPBERRY PI WI-FI NI DOIMIY VA UZILMAYDIGAN QILIB SOZLASH
# 1. Wi-Fi Power Management (Quvvat tejash/Uyqu) rejimini butunlay o'chirish
# 2. Avtomatik cheksiz qayta ulanish (Auto-reconnect infinity)
# 3. Doimiy Wi-Fi qo'riqchi xizmati (Qalqon Wi-Fi Keepalive Service)
# =============================================================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "\n${BLUE}==========================================================${NC}"
echo -e "${GREEN}   📶 QALQON AMR: DOIMIY WI-FI SOZLASH DASTURI${NC}"
echo -e "${BLUE}==========================================================${NC}\n"

# 1. Agar foydalanuvchi yangi Wi-Fi nomi va parolini argument sifatida bergan bo'lsa:
TARGET_SSID="$1"
TARGET_PASS="$2"

if [ -n "$TARGET_SSID" ] && [ -n "$TARGET_PASS" ]; then
    echo -e "${YELLOW}👉 Yangi Wi-Fi tarmog'iga ulanmoqda: ${GREEN}$TARGET_SSID${NC}..."
    if command -v nmcli &> /dev/null; then
        sudo nmcli device wifi connect "$TARGET_SSID" password "$TARGET_PASS" || true
    fi
fi

# 1. Wi-Fi mamlakat kodini o'rnatish (O'zbekiston - UZ)
echo -e "${YELLOW}[1/5] Wi-Fi mamlakat kodi sozlanmoqda (UZ)...${NC}"
sudo raspi-config nonint do_wifi_country UZ 2>/dev/null || true

# 2. Wi-Fi Quvvat tejash (Power Save) rejimini BUTUNLAY o'chirish
echo -e "${YELLOW}[2/5] Wi-Fi uyqu (Power Management) rejimi o'chirilmoqda...${NC}"

# A) Hozirgi sessiya uchun o'chirish
sudo iw wlan0 set power_save off 2>/dev/null || sudo iwconfig wlan0 power off 2>/dev/null || true

# B) NetworkManager sozlamasida doimiy o'chirish (Bookworm / Bullseye)
sudo mkdir -p /etc/NetworkManager/conf.d/
cat << 'EOF' | sudo tee /etc/NetworkManager/conf.d/default-wifi-powersave-off.conf > /dev/null
[connection]
wifi.powersave = 2
EOF

# C) rc.local orqali yuklanishda avtomatik quvvat tejashni o'chirish
if [ -f /etc/rc.local ]; then
    if ! grep -q "iw wlan0 set power_save off" /etc/rc.local; then
        sudo sed -i -e '$i \iw wlan0 set power_save off 2>/dev/null || true\n' /etc/rc.local
    fi
fi

echo -e "  ${GREEN}✓ Wi-Fi uyqu rejimi butunlay o'chirildi (aloqa uzilmaydi)!${NC}"

# 3. Hozirgi Wi-Fi profillarini avtomatik cheksiz ulanishga sozlash
echo -e "${YELLOW}[3/5] Wi-Fi avtomatik qayta ulanish ustuvorligi oshirilmoqda...${NC}"
if command -v nmcli &> /dev/null; then
    # Barcha mavjud Wi-Fi ulanishlariga cheksiz avto-ulanish berish
    CON_NAMES=$(nmcli -t -f NAME,TYPE con show | grep ":802-11-wireless" | cut -d: -f1 || true)
    if [ -n "$CON_NAMES" ]; then
        while IFS= read -r con; do
            [ -z "$con" ] && continue
            echo -e "  ⚙️ Sozlanmoqda: ${GREEN}$con${NC}"
            sudo nmcli con mod "$con" connection.autoconnect yes 2>/dev/null || true
            sudo nmcli con mod "$con" connection.autoconnect-priority 100 2>/dev/null || true
            sudo nmcli con mod "$con" connection.autoconnect-retries 0 2>/dev/null || true
        done <<< "$CON_NAMES"
    fi
fi

# 4. Doimiy Wi-Fi Qo'riqchi (Keep-Alive Watchdog) skriptini yaratish
echo -e "${YELLOW}[4/5] Wi-Fi Doimiy Qo'riqchi (Watchdog) o'rnatilmoqda...${NC}"
sudo tee /usr/local/bin/qalqon-wifi-keepalive.sh > /dev/null << 'EOF'
#!/bin/bash
# Har 15 soniyada routerni tekshirish, uzilsa qayta ulanish
while true; do
    # Router yoki tashqi tarmoqqa ping
    if ! ping -c 1 -W 2 8.8.8.8 > /dev/null 2>&1 && ! ping -c 1 -W 2 1.1.1.1 > /dev/null 2>&1; then
        # Router IP sini topish
        GATEWAY=$(ip route | grep default | awk '{print $3}' | head -n1)
        if [ -n "$GATEWAY" ] && ! ping -c 1 -W 2 "$GATEWAY" > /dev/null 2>&1; then
            echo "[WiFi Watchdog] Aloqa uzildi! Qayta ulanmoqda..."
            # NetworkManager orqali qayta yuklash
            if command -v nmcli &> /dev/null; then
                nmcli device wifi rescan > /dev/null 2>&1 || true
                nmcli connection up "$(nmcli -t -f NAME,TYPE con show --active | grep ':802-11-wireless' | cut -d: -f1 | head -n1)" > /dev/null 2>&1 || true
            else
                wpa_cli -i wlan0 reassociate > /dev/null 2>&1 || true
            fi
        fi
    fi
    sleep 15
done
EOF

sudo chmod +x /usr/local/bin/qalqon-wifi-keepalive.sh

# 5. Systemd xizmatini yaratish va yoqish
echo -e "${YELLOW}[5/5] Doimiy tizim xizmati (systemd) faollashtirilmoqda...${NC}"
sudo tee /etc/systemd/system/qalqon-wifi-keepalive.service > /dev/null << 'EOF'
[Unit]
Description=Qalqon AMR Permanent Wi-Fi Keepalive Watchdog
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/qalqon-wifi-keepalive.sh
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable qalqon-wifi-keepalive.service
sudo systemctl restart qalqon-wifi-keepalive.service

echo -e "\n${BLUE}==========================================================${NC}"
echo -e "${GREEN}✅ WI-FI TIZIMI DOIMIY VA UZILMAYDIGAN HOLATGA KELTIRILDI!${NC}"
echo -e "${BLUE}==========================================================${NC}"
echo -e "  1. Wi-Fi Power Save rejimi:     ${GREEN}O'CHIRILDI (Uyquga ketmaydi)${NC}"
echo -e "  2. Avtomatik qayta ulanish:     ${GREEN}CHEKSIZ (Retries: 0)${NC}"
echo -e "  3. Wi-Fi Watchdog Qo'riqchisi:  ${GREEN}ISHLAMOQDA (Har 15 sek tekshiradi)${NC}"
echo -e "  4. Faol IP manzil:              ${GREEN}$(hostname -I | awk '{print $1}')${NC}"
echo -e "${BLUE}==========================================================${NC}\n"
