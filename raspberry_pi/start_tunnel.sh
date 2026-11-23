#!/bin/bash
# =============================================================================
# 🛡️ QALQON AMR — Bepul Cloudflare HTTPS Tunnel (WebXR & Masofaviy Boshqaruv)
# =============================================================================

echo "=================================================================="
echo "🛡️ QALQON AMR — CLOUDFLARE HTTPS TUNNEL ISHGA TUSHIRILMOQDA..."
echo "=================================================================="

# 1. Eski jarayonlar va loglarni tozalash
pkill -9 -f "cloudflared tunnel" 2>/dev/null || true
rm -f /tmp/tunnel.log /tmp/cloudflared_url.txt

# 2. cloudflared dasturi mavjudligini tekshirish
CLOUDFLARED_BIN=""
if command -v cloudflared &>/dev/null; then
    CLOUDFLARED_BIN="cloudflared"
elif [ -x "/tmp/cloudflared" ] && [ $(stat -c%s "/tmp/cloudflared" 2>/dev/null || echo 0) -gt 20000000 ]; then
    CLOUDFLARED_BIN="/tmp/cloudflared"
else
    echo "📥 [1/3] cloudflared dasturi yuklab olinmoqda (bu bir marta bo'ladi)..."
    ARCH=$(dpkg --print-architecture 2>/dev/null || echo "arm64")
    if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
        DEB_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb"
        BIN_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
    else
        DEB_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm.deb"
        BIN_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm"
    fi

    # Avval deb paket orqali urinib ko'rish
    if wget -q --show-progress -O /tmp/cloudflared.deb "$DEB_URL"; then
        sudo dpkg -i /tmp/cloudflared.deb 2>/dev/null || true
        CLOUDFLARED_BIN="cloudflared"
    fi

    # Agar deb ishlamasa, to'g'ridan-to'g'ri binary yuklash
    if ! command -v cloudflared &>/dev/null; then
        wget -q --show-progress -O /tmp/cloudflared "$BIN_URL"
        chmod +x /tmp/cloudflared
        CLOUDFLARED_BIN="/tmp/cloudflared"
    fi
fi

if [ -z "$CLOUDFLARED_BIN" ]; then
    CLOUDFLARED_BIN="cloudflared"
fi

# 3. Tunnelni orqa fonda ishga tushirish
echo "🚀 [2/3] HTTPS Tunnel ochilmoqda (localhost:8000 -> https://*.trycloudflare.com)..."
$CLOUDFLARED_BIN tunnel --url http://localhost:8000 --logfile /tmp/tunnel.log &
TUNNEL_PID=$!

# 4. trycloudflare.com manzilini tutib olish (kutish maksimum 20 soniya)
echo "⏳ [3/3] Tashqi xavfsiz HTTPS havola kutilmoqda..."
TUNNEL_URL=""
for i in {1..25}; do
    if [ -f /tmp/tunnel.log ]; then
        TUNNEL_URL=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' /tmp/tunnel.log | head -n 1)
        if [ -n "$TUNNEL_URL" ]; then
            break
        fi
    fi
    sleep 1
done

if [ -n "$TUNNEL_URL" ]; then
    echo "$TUNNEL_URL" > /tmp/cloudflared_url.txt
    VR_LINK="https://asil2004.github.io/My-autnomius-car/?gw=${TUNNEL_URL}#vr"
    HUD_LINK="https://asil2004.github.io/My-autnomius-car/?gw=${TUNNEL_URL}#hud"

    echo ""
    echo "=================================================================="
    echo "🎉🎉🎉 CLOUDFLARE BEPUL HTTPS TUNNEL MUVAFFAQIYATLI OCHILDI! 🎉🎉🎉"
    echo "=================================================================="
    echo ""
    echo "🌐 Raspberry Pi HTTPS:   $TUNNEL_URL"
    echo ""
    echo "🥽 Meta Quest 2 VR:      $VR_LINK"
    echo ""
    echo "📊 Boshqaruv HUD:        $HUD_LINK"
    echo ""
    echo "=================================================================="
    echo "💡 Ushbu 'Meta Quest 2 VR' havolasini oching — dunyoning istalgan"
    echo "   burchagidan turib barcha kameralar va VR rejim 100% ochiladi!"
    echo "=================================================================="
    echo ""

    # HiveMQ MQTT orqali uzluksiz e'lon qilish (GitHub Pages ga avtomatik uzatish uchun)
    python3 -c "
import paho.mqtt.client as mqtt, time
try:
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id='tunnel_pub')
except Exception:
    c = mqtt.Client(client_id='tunnel_pub')
try:
    c.connect('broker.hivemq.com', 1883, 60)
    c.loop_start()
    while True:
        c.publish('qalqon/robot/gateway', '$TUNNEL_URL', retain=True)
        time.sleep(5)
except Exception:
    pass
" &
else
    echo "⚠️ Tunnel manzilini aniqlashda kechikish bo'ldi. Loglar: /tmp/tunnel.log"
fi

# Tunnel jarayonini ushlab turish
wait $TUNNEL_PID 2>/dev/null || true
