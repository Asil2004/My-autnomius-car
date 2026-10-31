#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
🛡️ QALQON v1.0 — Raspberry Pi 4 Avtonom Patrul Roboti "Miya" (Brain Core)
Modul: pi_patrol.py (Navoiy viloyati IIB TT 1-bandi bo'yicha rasmiy modul)
Mas'ul muhandis: Boburjon Bozorov (Software & Brain Engineer)
Platforma: Raspberry Pi 4 (Linux) / Arduino Mega / Uno (UART 115200 baud)

Navoiy viloyati IIB Texnik topshirig'i (TT) 1-bandi:
  "pi_patrol.py moduli: Raspberry Pi 4 dagi WebSocket serverni Arduino Mega / Uno
   bilan UART (115200 baud) orqali to'liq sinxronlashtirish."

Ushbu modul:
  1. Arduino Mega / Uno bilan 115200 baudda avtomatik port topib bog'lanadi;
  2. Sarvarning planshet frontendiga real-vaqtli WebSocket (/ws) telemetriyasini uzatadi;
  3. Jonli video oqimini (/stream.mjpg) taqdim etadi;
  4. 360° LD19 LiDAR skanerini xavfsizlik nazorati bilan integratsiya qiladi.
=============================================================================
"""

import sys
import os

# Ushbu papkani import qidiruv yo'liga kiritish
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

# Qalqon Brain serverini import qilish
from qalqon_brain import (
    app,
    arduino,
    lidar,
    camera,
    run_server_on_port,
    LOCAL_IPS,
    PRIMARY_IP,
    safety_supervisor_loop
)
import threading

if __name__ == '__main__':
    print("\n" + "="*68)
    print("🛡️  QALQON v1.0 — pi_patrol.py (Navoiy viloyati IIB TT 1-bandi)")
    print("="*68)
    print(f"📡 UART Aloqa:      Arduino Mega/Uno ({arduino.baudrate} baud)")
    print(f"🔌 Serial Port:     {arduino.port or 'SIMULATSIYA (Avto-ulanish kutilmoqda)'}")
    print(f"🌐 WebSocket:       ws://{PRIMARY_IP}:8000/ws (va ws://{PRIMARY_IP}:8080/ws)")
    print(f"📹 Jonli Video:     http://{PRIMARY_IP}:8000/stream.mjpg")
    print(f"💻 Kompyuterda:     http://localhost:8000")
    print("="*68 + "\n")

    # 8080 portni ikkinchi torda ochish (muqobil kirish uchun)
    t8080 = threading.Thread(target=run_server_on_port, args=(8080,), daemon=True)
    t8080.start()

    # Asosiy 8000 portda ishga tushirish
    run_server_on_port(8000)
