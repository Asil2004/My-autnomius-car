#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QALQON - Lokal Apparat va Datchiklar To'liq Diagnostika Skripti
(Hardware Diagnostic Test Suite)

Sinaladigan modullar:
1. Barcha USB Web-kameralar (Oldi, 360 PTZ Gumbaz, Orqa, Teleskopik).
2. 360° LiDAR datchigi (STL-19P / LD19 / RPLiDAR) - UART 230400 / 115200 bod.
3. Arduino Uno + L293D motor drayveri - UART 115200 bod (Sonar, Batareya, Machta).

Foydalanish:
  py -3 raspberry_pi/local_hardware_check.py
  py -3 raspberry_pi/local_hardware_check.py --full
"""

import os
import sys
import time
import argparse

try:
    if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from camera_module import MultiCameraManager, CameraModule, HAS_OPENCV
from lidar_module import LidarModule, HAS_SERIAL
from arduino_bridge import ArduinoBridge


def print_banner(title: str):
    print("\n" + "=" * 70)
    print(f"🔍 {title.center(64)}")
    print("=" * 70)


def test_cameras():
    print_banner("1. BARCHA WEB-KAMERALARNI TEKSHIRISH (OPENCV)")
    if not HAS_OPENCV:
        print("❌ OpenCV (cv2) moduli topilmadi! 'pip install opencv-python' o'rnating.")
        return False

    print("🔎 Tizimdagi video manbalar (Web-kameralar) skanerlanmoqda...")
    cam_mgr = MultiCameraManager(default_source=0)
    time.sleep(1.2)  # Kameralar ishga tushishini kutish

    cams_list = cam_mgr.get_cameras_list()
    hardware_cams_count = 0

    print(f"\n📋 Topilgan kameralar soni: {len(cams_list)}")
    for cam in cams_list:
        status_icon = "🟢" if not cam["is_synthetic"] else "🟡 (SIMULYATOR)"
        print(f"  • ID: {cam['id']} | Nomi: {cam['name']}")
        print(f"    Holat: {status_icon} {cam['status']} | O'lcham: {cam['resolution']} | FPS: {cam['fps']}")
        if not cam["is_synthetic"]:
            hardware_cams_count += 1

    # Kadr olish testi
    jpeg = cam_mgr.get_jpeg()
    if jpeg and len(jpeg) > 1000:
        print(f"\n✅ Asosiy kameradan JPEG oqimi muvaffaqiyatli olindi: {len(jpeg)} bayt")
    else:
        print("\n⚠️ Kamera oqimidan bo'sh kadr qaytdi.")

    status = cam_mgr.get_status()
    print(f"👁️ Yuz/Odam deteksiyasi: {status.get('persons_detected', 0)} ta aniqlandi")
    print(f"🛣️ Yo'lak kuzatish (Lane): {status.get('lane_status')} (Tavsiya: '{status.get('recommended_cmd')}')")

    cam_mgr.close()
    return hardware_cams_count > 0


def test_lidar():
    print_banner("2. 360° LIDAR DATCHIGINI TEKSHIRISH (UART 230400 BOD)")
    if not HAS_SERIAL:
        print("❌ PySerial moduli topilmadi! 'pip install pyserial' o'rnating.")
        return False

    print("🔎 LiDAR UART porti va paketlari tekshirilmoqda...")
    lidar = LidarModule()
    time.sleep(1.5)  # Paketlar to'planishini kutish

    diag = lidar.test_uart()
    print(f"  • Rejim: {diag['mode']}")
    print(f"  • UART Port: {diag['port']} ({diag['baudrate']} bod)")
    print(f"  • Paketlar soni: {diag['packets_count']} ta | Tezlik: {diag['rate_hz']} Hz")
    print(f"  • CRC Xatoliklar: {diag['crc_errors']}")

    # Sektorlar tahlili
    sectors = lidar.get_sectors()
    alert_txt = "🚨 TO'SIQ ANIQLANDI!" if sectors['front'] <= 0.45 else "✅ Ochiq"
    print("\n📐 Masofalar (Sektorlar bo'yicha):")
    print(f"  ⬆️ Oldi (Front):    {sectors['front']:.2f} m ({alert_txt})")
    print(f"  ⬅️ Chap (Left):     {sectors['left']:.2f} m")
    print(f"  ➡️ O'ng (Right):     {sectors['right']:.2f} m")
    print(f"  ⬇️ Orqa (Rear):     {sectors['rear']:.2f} m")

    is_blocked = lidar.is_front_blocked(safe_distance=0.45)
    print(f"🛡️ Oldinda xavfli to'siq bormi: {'HA (Favqulodda tormoz faol)' if is_blocked else 'YOQ (Yo\'l ochiq)'}")

    lidar.close()
    return diag["is_hardware"]


def test_arduino():
    print_banner("3. ARDUINO UNO + L293D MOTORS/SONARS (UART 115200 BOD)")
    if not HAS_SERIAL:
        print("❌ PySerial moduli topilmadi! 'pip install pyserial' o'rnating.")
        return False

    print("🔎 Arduino Uno COM/TTY porti tekshirilmoqda...")
    arduino = ArduinoBridge()
    time.sleep(1.0)

    diag = arduino.test_uart()
    print(f"  • Rejim: {diag['mode']}")
    print(f"  • Port: {diag['port']} ({diag['baudrate']} bod)")
    print(f"  • Oxirgi qabul qilingan xabar: '{diag.get('last_rx', '')}'")

    # Sonarlar
    sonars = diag.get("sonars", {})
    print("\n📡 Ultratovush (Sonar) Masofalari:")
    print(f"  • Old (F): {sonars.get('front', 0)} sm | Orqa (B): {sonars.get('rear', 0)} sm")
    print(f"  • Chap (L): {sonars.get('left', 0)} sm | O'ng (R): {sonars.get('right', 0)} sm")

    # Batareya
    bat = diag.get("battery", {})
    print(f"\n🔋 Batareya Holati: {bat.get('voltage', 0)}V ({bat.get('percentage', 0)}%) | Harorat: {bat.get('temp', 0)}°C")

    # Buyruq yuborish testi
    print("\n🕹️ UART Boshqaruv Buyruqlari Sinovi:")
    test_commands = [
        ('S', "Tormoz / To'xtash (S)"),
        ('F', "Oldinga yurish (F)"),
        ('L', "Chapga burilish (L)"),
        ('R', "O'ngga burilish (R)"),
        ('U', "Teleskopik Machtani Ko'tarish (U)"),
        ('D', "Teleskopik Machtani Tushirish (D)"),
        ('S', "Yakuniy tormoz (S)"),
    ]
    for cmd, desc in test_commands:
        ok = arduino.send_command(cmd)
        res_str = "✅ Qabul qilindi" if ok else "⚠️ Rad etildi (To'siq yoki blok)"
        print(f"  -> '{cmd}': {desc} -> {res_str}")
        time.sleep(0.15)

    arduino.close()
    return diag["is_hardware"]


def main():
    parser = argparse.ArgumentParser(description="QALQON AMR Hardware Test Runner")
    parser.add_argument("--full", action="store_true", help="Barcha chuqurlashtirilgan testlarni bajarish")
    args = parser.parse_args()

    print("\n" + "🛡️ " * 20)
    print("   QALQON AMR v1.0 — LOKAL APPARAT TEST DASTURI (RASPBERRY PI / PC)")
    print("   Vaqt:", time.strftime('%Y-%m-%d %H:%M:%S'))
    print("🛡️ " * 20)

    has_cam = test_cameras()
    has_lidar = test_lidar()
    has_arduino = test_arduino()

    print_banner("TEST XULOSASI VA TIZIM TAYYORLIGI")
    print(f"  📷 Web-kameralar:  {'🟢 APPARAT ULANDI' if has_cam else '🟡 SIMULYATOR REJIMI'}")
    print(f"  📡 360° LiDAR:     {'🟢 UART ULANDI (230400)' if has_lidar else '🟡 VIRTUAL RADAR REJIMI'}")
    print(f"  ⚡ Arduino Uno:    {'🟢 UART ULANDI (115200)' if has_arduino else '🟡 EMULYATOR REJIMI'}")

    print("\n💡 Ko'rsatma:")
    print("  • Agar haqiqiy datchiklar (USB-UART / Arduino / Kameralar) ulangan bo'lsa, ular avtomatik drayverga ulanadi.")
    print("  • Agar ulanmagan bo'lsa, xavfsiz Simulyatorlar faol bo'lib, Frontend to'liq test qilinishi mumkin.")
    print("  • Lokal serverni to'liq ishga tushirish uchun:")
    print("      py -3 raspberry_pi/qalqon_brain.py")
    print("=" * 70 + "\n")


if __name__ == '__main__':
    main()
