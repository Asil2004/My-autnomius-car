#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
QALQON ROBOT — LDROBOT STL-19P 360° LAZER LIDAR RUNNER
Model: LDROBOT STL-19P (LD19 / D300 DToF Lidar)
Protokol: UART 230400 Baud, 47 baytli paketlar, 4500 nuqta/sek, 10 Hz
=============================================================================
"""

import sys
import time
import math
import os

try:
    if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

from lidar_module import LidarModule, HAS_SERIAL

def main():
    print("=" * 70)
    print("      QALQON ROBOT — LDROBOT STL-19P LAZER SKANER MODULI")
    print("=" * 70)
    print("Model:       LDROBOT STL-19P (360° DToF Laser Range Finder)")
    print("Protokol:    UART Serial @ 230400 baud (CP2102 USB Bridge)")
    print("Chastota:    10.0 Hz (600 RPM) | 4500 nuqta/sek")
    print("Masofa:      0.05m - 12.00m (Aniqlik: +/-15 mm)")
    print("-" * 70)

    # 1. Serial kutubxonasini tekshirish
    if not HAS_SERIAL:
        print("[!] Xatolik: 'pyserial' kutubxonasi o'rnatilmagan.")
        print("    O'rnatish uchun: pip install pyserial")
        sys.exit(1)

    # 2. LiDAR drayverini ishga tushirish
    print("[*] LiDAR ulanishi tekshirilmoqda...")
    lidar = LidarModule(baudrate=230400)

    time.sleep(1.0)
    status = lidar.status()

    if status["is_hardware"]:
        print(f"[OK] Haqiqiy LDROBOT STL-19P topildi va ochildi: {status['port']} ({status['baudrate']} baud)")
    else:
        print(f"[!] Haqiqiy port ochilmadi. Simulyator rejimida ishlamoqda.")
        print("    Eslatma: Agar Windows'da CP2102 drayveri o'rnatilmagan bo'lsa,")
        print("    loyihadagi 'CP210x_driver/CP210x_VCP_Windows/CP210xVCPInstaller_x64_v6.7.0.0.exe'")
        print("    faylini ishga tushirib drayverni o'rnating.")

    print("\nJonli telemetriya boshlanmoqda (To'xtatish uchun: Ctrl+C):\n")
    try:
        while True:
            sectors = lidar.get_sectors()
            st = lidar.status()
            blocked_flag = " [!] XAVF: TO'SIQ < 0.45m" if lidar.is_front_blocked(0.45) else " [OK]"
            
            sys.stdout.write(
                f"\rRejim: {st['mode']} | Port: {st['port']} | Tezlik: {st['rate_hz']} Hz | "
                f"OLD: {sectors['front']:.2f}m | O'NG: {sectors['right']:.2f}m | "
                f"ORQA: {sectors['rear']:.2f}m | CHAP: {sectors['left']:.2f}m{blocked_flag}   "
            )
            sys.stdout.flush()
            time.sleep(0.1)
    except KeyboardInterrupt:
        print("\n\n[*] Dastur to'xtatildi.")
    finally:
        lidar.close()

if __name__ == '__main__':
    main()
