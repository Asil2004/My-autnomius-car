#!/usr/bin/env python3
"""
=============================================================================
🛡️ QALQON ROBOT — TELEGRAM BOT JONLI LOKATSIYA SKRIPTI
=============================================================================
Ushbu skript https://trackk-gl6l.onrender.com/api.php?action=robot serveridan
har 5 soniyada robot koordinatasini oladi va Telegram orqali jonli (Live Location)
yoki xabar ko'rinishida yuborib turadi.

TALABLAR:
  pip install pyTelegramBotAPI requests
=============================================================================
"""

import time
import requests

# 1. SOZLAMALAR
BOT_TOKEN = "SIZNING_BOT_TOKENINGIZ"       # @BotFather dan olingan token
CHAT_ID   = 123456789                      # Foydalanuvchi yoki guruh Chat ID
TRACKK_API = "https://trackk-gl6l.onrender.com/api.php?action=robot"

def get_robot_data():
    try:
        r = requests.get(TRACKK_API, timeout=5)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print(f"[Xato] Serverdan ma'lumot olishda: {e}")
    return None

def main():
    print("=" * 60)
    print("🤖 QALQON TELEGRAM JONLI LOKATSIYA BOTI ISHGA TUSHDI")
    print(f"   API: {TRACKK_API}")
    print("=" * 60)

    last_lat = None
    last_lng = None

    while True:
        data = get_robot_data()
        if data and data.get("status") == "ok" and data.get("is_online"):
            lat = float(data["lat"])
            lng = float(data["lng"])
            fix_str = data.get("fix_str", "GPS FIX")
            sat = data.get("sat", 0)
            speed = data.get("speed", 0.0)

            # Faqat robot siljiganda yoki har 15 soniyada
            if lat != last_lat or lng != last_lng:
                last_lat = lat
                last_lng = lng
                msg = (
                    f"🛡️ *QALQON ROBOT JONLI LOKATSIYASI*\n"
                    f"📍 Kenglik (Lat): `{lat:.7f}`\n"
                    f"📍 Uzunlik (Lng): `{lng:.7f}`\n"
                    f"🛰️ Fix Holati: *{fix_str}* ({sat} sun'iy yo'ldosh)\n"
                    f"⚡ Tezlik: `{speed:.1f} km/h`\n"
                    f"🗺️ [Google Maps'da ko'rish](https://maps.google.com/?q={lat},{lng})"
                )
                print(f"[GPS] {lat:.6f}, {lng:.6f} | Fix: {fix_str} | Sat: {sat}")

                # Telegram API orqali xabar yuborish (sendMessage)
                if BOT_TOKEN != "SIZNING_BOT_TOKENINGIZ":
                    try:
                        url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
                        payload = {
                            "chat_id": CHAT_ID,
                            "text": msg,
                            "parse_mode": "Markdown",
                            "disable_web_page_preview": False
                        }
                        requests.post(url, json=payload, timeout=5)
                    except Exception as err:
                        print(f"[Telegram Error] {err}")
        else:
            print("[Kutish] Serverda robot oflayn yoki ma'lumot kutilmoqda...")

        time.sleep(5.0)

if __name__ == "__main__":
    main()
