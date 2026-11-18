#!/usr/bin/env python3
"""
=============================================================================
🛡️ QALQON — WEBHOOK & FORWARDING PROXY (AVTOMATIK QAYTA YO'NALTIRISH)
=============================================================================
Vazifasi:
Trackk Cloud Hub (https://trackk-gl6l.onrender.com/api.php?action=robot)
orqali kelgan GPS koordinatasini soniyaning o'zida 10 ta boshqa server,
baza yoki tizimga Webhook orqali simsiz qayta tarqatish (forward qilish).

Natijada:
- ESP32 ga ortiqcha yuk tushmaydi, u bitta joyga yuboradi.
- Ushbu skript koordinatani istalgan boshqa backendga uzatadi.
=============================================================================
"""

import time
import requests

# 1. SOZLAMALAR
SOURCE_URL = "https://trackk-gl6l.onrender.com/api.php?action=robot"

# Qaysi boshqa serverlarga uzatilsin? (Istalgancha URL qo'shish mumkin)
FORWARD_ENDPOINTS = [
    # "https://sizning-asosiy-serveringiz.uz/api/robot-telemetry",
    # "http://localhost:8080/webhook/gps",
]

POLL_INTERVAL_SEC = 0.5  # Har 500 ms da tekshirish

def forward_data(payload):
    for ep in FORWARD_ENDPOINTS:
        try:
            requests.post(ep, json=payload, timeout=2.0)
        except Exception as e:
            print(f"[Webhook Xato] {ep} ga uzatishda: {e}")

def main():
    print("=" * 65)
    print("🔄 QALQON CLOUD HUB — WEBHOOK FORWARDER FAOL")
    print(f"   Manba: {SOURCE_URL}")
    print(f"   Tarqatiluvchi serverlar soni: {len(FORWARD_ENDPOINTS)}")
    print("=" * 65)

    last_ts = None

    while True:
        try:
            r = requests.get(SOURCE_URL, timeout=3.0)
            if r.status_code == 200:
                data = r.json()
                server_time = data.get("server_time")
                if data.get("is_online") and server_time != last_ts:
                    last_ts = server_time
                    lat = data.get("lat")
                    lng = data.get("lng")
                    fix = data.get("fix_str")
                    print(f"[Forwarding] Lat: {lat}, Lng: {lng} ({fix}) -> {len(FORWARD_ENDPOINTS)} serverga uzatildi")
                    forward_data(data)
        except Exception as err:
            print(f"[Kutish] Ulanish xatosi: {err}")

        time.sleep(POLL_INTERVAL_SEC)

if __name__ == "__main__":
    main()
