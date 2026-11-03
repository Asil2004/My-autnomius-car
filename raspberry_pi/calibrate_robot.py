#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
QALQON v1.0 — Robot Motorlari va Ultratovush Datchiklarini Kalibrovka Qilish
Interaktiv Terminal Utilitasi (Python CLI Wizard)

Ishga tushirish:
    python raspberry_pi/calibrate_robot.py
=============================================================================
"""

import sys
import time
import glob

try:
    import serial
    from serial.tools import list_ports
    HAS_SERIAL = True
except ImportError:
    HAS_SERIAL = False
    print("Ogohlantirish: 'pyserial' kutubxonasi topilmadi (pip install pyserial).")

def find_serial_port():
    if not HAS_SERIAL:
        return None
    # Linux / Raspberry Pi
    ports = glob.glob('/dev/ttyACM*') + glob.glob('/dev/ttyUSB*')
    if ports:
        return ports[0]
    # Windows
    for p in list_ports.comports():
        desc = f"{p.description} {p.manufacturer or ''}".lower()
        if any(k in desc for k in ("arduino", "ch340", "uno", "mega", "usb serial", "ftdi")):
            return p.device
    # Agar maxsus nom topilmasa mavjud birinchi COM port
    all_ports = list(list_ports.comports())
    if all_ports:
        return all_ports[0].device
    return None

def main():
    print("=" * 65)
    print("   🤖 QALQON v1.0: MOTOR VA ULTRATAVUSH KALIBROVKA DASTURI")
    print("=" * 65)

    if not HAS_SERIAL:
        print("\n[XATO] Serial ulanish uchun 'pyserial' kutubxonasi kerak.")
        print("Iltimos, terminalda: pip install pyserial")
        return

    port = find_serial_port()
    if not port:
        print("\n[!] Arduino porti avtomatik topilmadi.")
        manual_port = input("Iltimos, Arduino ulangan port nomini kiriting (masalan COM3 yoki /dev/ttyACM0): ").strip()
        port = manual_port if manual_port else None

    if not port:
        print("[!] Port kiritilmadi. Dastur to'xtatildi.")
        return

    print(f"\n[+] Arduino'ga ulanmoqda: {port} (115200 baud)...")
    try:
        ser = serial.Serial(port, 115200, timeout=1.0)
        time.sleep(2.0) # Arduino yuklanishini kutish
        print("[OK] Ulanish muvaffaqiyatli o'rnatildi!")
    except Exception as e:
        print(f"[XATO] Portni ochishda xatolik: {e}")
        return

    # Kiruvchi xabarlarni o'qish
    def read_all():
        lines = []
        while ser.in_waiting:
            line = ser.readline().decode('utf-8', errors='replace').strip()
            if line:
                lines.append(line)
        return lines

    for line in read_all():
        print(line)

    try:
        while True:
            cmd = input("\n[Buyruq (1-9, 0, P, chiqish uchun 'q')]: ").strip()
            if not cmd:
                continue
            if cmd.lower() in ('q', 'exit', 'quit'):
                ser.write(b'0\n')
                print("\n[+] Dastur yakunlandi. Xavfsiz chiqildi.")
                break

            ser.write((cmd + '\n').encode('utf-8'))
            time.sleep(0.3)

            # Agar sonarni doimiy kuzatish tanlangan bo'lsa
            if cmd == '1':
                print("[+] Datchik oqimi faol. To'xtatish uchun Enter bosing...")
                ser.timeout = 0.2
                try:
                    while True:
                        line = ser.readline().decode('utf-8', errors='replace').strip()
                        if line:
                            print(line)
                except KeyboardInterrupt:
                    ser.write(b'1\n')
                    print("\n[+] Datchik oqimi to'xtatildi.")
            else:
                time.sleep(0.5)
                for line in read_all():
                    print(line)

    except KeyboardInterrupt:
        ser.write(b'0\n')
        print("\n[+] To'xtatildi.")
    finally:
        ser.close()

if __name__ == '__main__':
    main()
