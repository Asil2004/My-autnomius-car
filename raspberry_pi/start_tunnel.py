#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🛡️ QALQON AMR — Bepul Cloudflare HTTPS Tunnel Runner
Bu skript:
1. cloudflared binary-sini yuklab oladi (agar yo'q bo'lsa).
2. 'cloudflared tunnel --url http://localhost:8000' ni ishga tushiradi.
3. Generatsiya qilingan 'https://*.trycloudflare.com' manzilini topadi.
4. Ushbu manzilni HiveMQ MQTT orqali 'qalqon/robot/gateway' mavzusiga e'lon qiladi!
5. GitHub Pages ga to'g'ridan-to'g'ri kirish havolasini terminalda ko'rsatadi!
"""

import os
import sys
import re
import time
import platform
import subprocess
import threading

BIN_PATH = "/tmp/cloudflared"

def get_binary():
    if os.path.exists(BIN_PATH) and os.access(BIN_PATH, os.X_OK):
        return BIN_PATH
    m = platform.machine().lower()
    if "aarch64" in m or "arm64" in m:
        url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
    elif "arm" in m:
        url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm"
    else:
        url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"

    print(f"📥 [Cloudflare] Binary yuklab olinmoqda ({m})...")
    res = subprocess.run(["curl", "-sSL", "-o", BIN_PATH, url])
    if res.returncode != 0:
        subprocess.run(["wget", "-q", "-O", BIN_PATH, url])
    os.chmod(BIN_PATH, 0o755)
    return BIN_PATH

def broadcast_mqtt(gw_url: str):
    try:
        import paho.mqtt.client as mqtt
        c = mqtt.Client(client_id=f"tunnel_pub_{int(time.time())}")
        c.connect("broker.hivemq.com", 1883, 60)
        c.loop_start()
        for _ in range(3):
            c.publish("qalqon/robot/gateway", gw_url, retain=True)
            time.sleep(0.5)
        c.loop_stop()
        c.disconnect()
        print(f"📡 [MQTT] HTTPS Gateway GitHub Pages ga avtomatik e'lon qilindi: {gw_url}")
    except Exception as e:
        print(f"⚠️ [MQTT Broadcast]: {e}")

def main():
    bin_file = get_binary()
    print("\n" + "="*68)
    print("🛡️  QALQON AMR — CLOUDFLARE HTTPS TUNNEL ISHGA TUSHMOQDA...")
    print("="*68)
    print("⏳ Tunnel ulanmoqda, iltimos kuting...\n")

    cmd = [bin_file, "tunnel", "--url", "http://localhost:8000"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)

    url_found = False
    for line in proc.stdout:
        sys.stdout.write(line)
        sys.stdout.flush()
        if not url_found:
            m = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
            if m:
                url_found = True
                tunnel_url = m.group(0)
                gh_pages_vr = f"https://asil2004.github.io/My-autnomius-car/?gw={tunnel_url}#vr"
                gh_pages_hud = f"https://asil2004.github.io/My-autnomius-car/?gw={tunnel_url}#hud"
                print("\n" + "🎉"*34)
                print("🌟  CLOUDFLARE BEPUL HTTPS TUNNEL MUVAFFAQIYATLI OCHILDI!  🌟")
                print("🎉"*34)
                print(f"\n🌐 Raspberry Pi HTTPS:   {tunnel_url}")
                print(f"🥽 GitHub Pages VR:      {gh_pages_vr}")
                print(f"📊 GitHub Pages HUD:     {gh_pages_hud}\n")
                print("="*68)
                print("💡 Ushbu havolani brauzerda yoki Meta Quest 2 ichida oching!")
                print("="*68 + "\n")
                threading.Thread(target=broadcast_mqtt, args=(tunnel_url,), daemon=True).start()

    proc.wait()

if __name__ == "__main__":
    main()
