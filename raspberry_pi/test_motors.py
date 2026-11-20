#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
🛡️ QALQON AMR — ESP32 BTS7960 MOTORLARNI JONLI AYLANISHINI TEKSHIRISH
Raspberry Pi dan USB orqali motorlarni 2 soniya oldinga, 2 soniya orqaga aylantirish
=============================================================================
"""

import sys
import time
import glob
import serial

GREEN = "\033[0;32m"
RED = "\033[0;31m"
YELLOW = "\033[1;33m"
CYAN = "\033[0;36m"
BOLD = "\033[1m"
NC = "\033[0m"

print(f"\n{BOLD}{CYAN}{'='*60}")
print("   🚗 QALQON MOTORLARNI TO'G'RIDAN-TO'G'RI SINASH DASTURI")
print(f"{'='*60}{NC}\n")

# 1. ESP32 portini topish (/dev/ttyUSB1 yoki /dev/ttyACM0)
ports = sorted(glob.glob("/dev/ttyUSB*") + glob.glob("/dev/ttyACM*"))
esp_port = None

for p in ports:
    try:
        s = serial.Serial(p, 115200, timeout=0.5)
        time.sleep(0.2)
        s.write(b"S\n")
        rx = s.read(64).decode('utf-8', errors='ignore')
        s.close()
        if "ACK" in rx or "ULANDI" in rx or "QALQON" in rx or p == "/dev/ttyUSB1":
            esp_port = p
            break
    except Exception:
        pass

if not esp_port:
    esp_port = "/dev/ttyUSB1" if "/dev/ttyUSB1" in ports else (ports[0] if ports else "/dev/ttyUSB1")

print(f"📡 ESP32 Porti: {BOLD}{GREEN}{esp_port}{NC}")

try:
    ser = serial.Serial(esp_port, 115200, timeout=0.5)
    time.sleep(1.0) # Reset kutish
except Exception as e:
    print(f"{RED}[XATO] Port ochilmadi: {e}{NC}")
    sys.exit(1)

def send_and_read(cmd, desc):
    print(f"\n👉 Buyruq: {BOLD}{CYAN}'{cmd}' ({desc}){NC} yuborilmoqda...")
    ser.write(cmd.encode('utf-8'))
    time.sleep(0.1)
    rx = ser.read(64).decode('utf-8', errors='ignore').strip()
    print(f"   ESP32 dan javob: {GREEN}{rx}{NC}")

try:
    # 1. Tezlikni 3 (Maksimal - 255 PWM) ga qo'yish
    send_and_read('3', '3-Tezlik (Maksimal 255 PWM)')
    time.sleep(0.5)

    # 2. Oldinga (F) 2 soniya
    print(f"\n{YELLOW}⚠️  G'ILDIRAKLAR OLDINGA AYLANISHI KERAK (2 soniya)...{NC}")
    send_and_read('F', 'OLDINGA HARAKAT')
    for i in range(20):
        ser.write(b'F') # Heartbeat keep-alive
        time.sleep(0.1)

    # 3. Tormoz
    print(f"\n{GREEN}🛑 TO'XTATISH (Tormoz)...{NC}")
    send_and_read('S', "TO'XTASH")
    time.sleep(1.0)

    # 4. Orqaga (B) 2 soniya
    print(f"\n{YELLOW}⚠️  G'ILDIRAKLAR ORQAGA AYLANISHI KERAK (2 soniya)...{NC}")
    send_and_read('B', 'ORQAGA HARAKAT')
    for i in range(20):
        ser.write(b'B') # Heartbeat keep-alive
        time.sleep(0.1)

    # 5. Yakuniy to'xtash
    send_and_read('S', "YAKUNIY TO'XTASH")

    print(f"\n{BOLD}{GREEN}{'='*60}")
    print("✅ TEST YAKUNLANDI!")
    print(f"{'='*60}{NC}")
    print("\n💡 AGAR MOTORLAR AYLANMAGAN BO'LSA, 3 TA APPARAT SABABINI TEKSHIRING:")
    print("  1. BTS7960 ga 12V AKKUMULYATOR quvvati ulanganmi? Kalit yoqilganmi?")
    print("  2. BTS7960 drayveridagi R_EN va L_EN pinlari ESP32 ning 3.3V yoki 5V ga ulanganmi?")
    print("     (Agar R_EN/L_EN ga 3.3V/5V berilmasa, drayver o'chiq turadi va tok o'tkazmaydi!)")
    print("  3. ESP32 GND pini va BTS7960 drayveri GND pini o'zaro tutashtirilganmi (Common GND)?")
    print(f"{'='*60}\n")

finally:
    ser.close()
