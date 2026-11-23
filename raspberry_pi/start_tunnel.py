#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
🛡️ QALQON AMR — Bepul Cloudflare HTTPS Tunnel Runner (WebXR & GitHub Pages)
=============================================================================
Bu skript:
1. cloudflared binary-sini tekshiradi (to'liq yuklanganini).
2. 'cloudflared tunnel --url http://localhost:8000' ni ishga tushiradi.
3. Generatsiya qilingan 'https://*.trycloudflare.com' manzilini topadi.
4. Manzilni /tmp/cloudflared_url.txt ga yozadi.
5. HiveMQ MQTT orqali 'qalqon/robot/gateway' mavzusiga har 5 soniyada e'lon qiladi.
6. GitHub Pages uchun to'g'ridan-to'g'ri havolani terminalda ko'rsatadi!
=============================================================================
"""

import os
import sys
import re
import time
import platform
import subprocess
import threading

BIN_PATH = "/tmp/cloudflared"
URL_FILE = "/tmp/cloudflared_url.txt"

def get_binary():
    # Fayl mavjud va hajmi 20MB dan katta bo'lsa (chala yuklanmagan bo'lsa)
    if os.path.exists(BIN_PATH) and os.path.getsize(BIN_PATH) > 20 * 1024 * 1024 and os.access(BIN_PATH, os.X_OK):
        return BIN_PATH

    m = platform.machine().lower()
    if "aarch64" in m or "arm64" in m:
        url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
    elif "arm" in m:
        url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm"
    else:
        url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"

    print(f"\n📥 [Cloudflare] Binary yuklab olinmoqda ({m})...")
    if os.path.exists(BIN_PATH):
        try: os.remove(BIN_PATH)
        except Exception: pass

    # -# parametri bilan progress bar ko'rsatish
    res = subprocess.run(["curl", "-#", "-L", "-o", BIN_PATH, url])
    if res.returncode != 0 or not os.path.exists(BIN_PATH) or os.path.getsize(BIN_PATH) < 1024*1024:
        print("  [!] curl muvaffaqiyatsiz bo'ldi, wget bilan yuklanmoqda...")
        subprocess.run(["wget", "-q", "--show-progress", "-O", BIN_PATH, url])

    os.chmod(BIN_PATH, 0o755)
    return BIN_PATH

def broadcast_mqtt_loop(gw_url: str):
    """MQTT orqali har 5 soniyada yangilab turish (GitHub Pages ga yetib borishi uchun)"""
    try:
        import paho.mqtt.client as mqtt
        try:
            c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id=f"tunnel_pub_{int(time.time())}")
        except Exception:
            c = mqtt.Client(client_id=f"tunnel_pub_{int(time.time())}")
        c.connect("broker.hivemq.com", 1883, 60)
        c.loop_start()
        print(f"📡 [MQTT] HTTPS Gateway doimiy e'lon qilinmoqda: {gw_url}")
        while True:
            c.publish("qalqon/robot/gateway", gw_url, retain=True)
            time.sleep(5)
    except Exception as e:
        print(f"⚠️ [MQTT Broadcast]: {e}")

def main():
    bin_file = get_binary()
    print("\n" + "="*70)
    print("🛡️  QALQON AMR — CLOUDFLARE HTTPS TUNNEL ISHGA TUSHMOQDA...")
    print("="*70)
    print("⏳ Tunnel ulanmoqda, iltimos kuting...\n")

    cmd = [bin_file, "tunnel", "--url", "http://127.0.0.1:8000"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)

    url_found = False
    for line in proc.stdout:
        # Har bir satrni chiqaramiz
        if not url_found:
            m = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
            if m:
                url_found = True
                tunnel_url = m.group(0)
                try:
                    with open(URL_FILE, "w") as f:
                        f.write(tunnel_url)
                except Exception:
                    pass

                gh_pages_vr = f"https://asil2004.github.io/My-autnomius-car/?gw={tunnel_url}#vr"
                gh_pages_hud = f"https://asil2004.github.io/My-autnomius-car/?gw={tunnel_url}#hud"
                print("\n" + "🎉"*35)
                print("🌟  CLOUDFLARE BEPUL HTTPS TUNNEL MUVAFFAQIYATLI OCHILDI!  🌟")
                print("🎉"*35)
                print(f"\n🌐 Raspberry Pi HTTPS:   {tunnel_url}")
                print(f"🥽 GitHub Pages VR:      {gh_pages_vr}")
                print(f"📊 GitHub Pages HUD:     {gh_pages_hud}\n")
                print("="*70)
                print("💡 Meta Quest 2 yoki brauzerda ochish uchun yuqoridagi 'GitHub Pages VR' havolasini bosing!")
                print("="*70 + "\n")
                t = threading.Thread(target=broadcast_mqtt_loop, args=(tunnel_url,), daemon=True)
                t.start()
        else:
            # URL topilgach, faqat muhim loglarni qisqa chiqaramiz
            if "error" in line.lower() or "fail" in line.lower():
                sys.stdout.write(line)
                sys.stdout.flush()

    proc.wait()

if __name__ == "__main__":
    main()
