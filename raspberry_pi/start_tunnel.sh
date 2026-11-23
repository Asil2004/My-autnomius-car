#!/bin/bash
# =============================================================================
# 🛡️ QALQON AMR — Bepul Cloudflare HTTPS Tunnel (WebXR va Internet Aloqasi)
# Ushbu skript Raspberry Pi-ga bepul HTTPS domen beradi.
# Natijada GitHub Pages (https://...) va Meta Quest 2 WebXR Mixed Content
# to'siqlarisiz video va buyruqlarni to'g'ridan-to'g'ri qabul qiladi!
# =============================================================================

echo "=========================================================="
echo "🛡️ QALQON CLOUDFLARE HTTPS TUNNEL ISHGA TUSHMOQDA..."
echo "=========================================================="

ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
elif [ "$ARCH" = "armv7l" ]; then
    URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm"
else
    URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
fi

BIN="/tmp/cloudflared"
if [ ! -f "$BIN" ]; then
    echo "📥 Cloudflare binary yuklab olinmoqda ($ARCH)..."
    curl -sSL -o "$BIN" "$URL" 2>/dev/null || wget -q -O "$BIN" "$URL"
    chmod +x "$BIN"
fi

echo ""
echo "----------------------------------------------------------"
echo "🌐 Bepul HTTPS tunnel ulanmoqda..."
echo "👉 Terminalda chiqadigan 'https://...trycloudflare.com' manzilini oling!"
echo "----------------------------------------------------------"
echo ""

$BIN tunnel --url http://localhost:8000
