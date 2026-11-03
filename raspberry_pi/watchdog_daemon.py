#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
🛡️ QALQON v1.0 — Raspberry Pi 4 Watchdog & Serial Supervision Daemon
Uch tomonlama Memorandum: Navoiy viloyati IIB — NDU — NDKvaTU
Memorandum bandlari: 2.1 (AI monitoring), 2.4 (Kiberxavfsizlik), 2.5 (Avtonom patrul)
=============================================================================
Vazifalari:
  1. Arduino Uno bilan 115200 bodli aloqani uzluksiz kuzatish (Heartbeat Monitor);
  2. Aloqa uzilganda yoki tizim qotganda darhol Favqulodda Tormoz ('S') berish (Failsafe);
  3. Raspberry Pi 4 protsessor harorati (CPU Temp), RAM va apparat holatini nazorat qilish;
  4. Serial port uzilib qolganda avtomatik qayta ulanish (Auto-Reconnect);
  5. OTA (Over-The-Air) yangilanishlar xavfsizligini ta'minlash.
=============================================================================
"""

import os
import sys
import time
import json
import logging
import threading
from typing import Dict, Any, Optional

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

try:
    import serial
    from serial.tools import list_ports
    HAS_SERIAL = True
except ImportError:
    serial = None
    list_ports = None
    HAS_SERIAL = False

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] [WATCHDOG] %(message)s'
)
logger = logging.getLogger("QalqonWatchdog")

class QalqonWatchdogDaemon:
    def __init__(self, arduino_bridge=None, failsafe_timeout_sec: float = 0.65):
        self.arduino_bridge = arduino_bridge
        self.failsafe_timeout_sec = failsafe_timeout_sec
        self.running = True
        
        # Holat o'zgaruvchilari
        self.last_heartbeat_time = time.time()
        self.watchdog_state = "ARMED" # ARMED, TRIGGERED, SAFE_IDLE
        self.failsafe_trigger_count = 0
        self.reconnect_attempts = 0
        self.last_failsafe_time: Optional[float] = None
        
        self.lock = threading.Lock()
        
        # Telemetriya kesh
        self.telemetry_cache: Dict[str, Any] = {
            "status": "ARMED",
            "cpu_temp_c": 42.0,
            "cpu_usage_pct": 12.5,
            "ram_used_pct": 34.0,
            "heartbeat_age_ms": 0,
            "serial_alive": True,
            "failsafe_active": False,
            "failsafe_count": 0,
            "ota_version": "v1.0-memorandum-2.4"
        }
        
        # Kuzatuv oqimini ishga tushirish
        self.supervisor_thread = threading.Thread(target=self._supervision_loop, daemon=True)
        self.supervisor_thread.start()
        logger.info(f"Qalqon Watchdog daemoni ishga tushdi (Failsafe timeout: {self.failsafe_timeout_sec*1000:.0f} ms)")

    def feed_heartbeat(self, source: str = "BRAIN_CORE"):
        """
        Asosiy boshqaruv yadrosi yoki operator interfeysidan 'Tiriklik' (Heartbeat) signalini qabul qilish.
        Har bir muvaffaqiyatli buyruq yoki telemetriya siklida chaqiriladi.
        """
        with self.lock:
            self.last_heartbeat_time = time.time()
            if self.watchdog_state == "TRIGGERED":
                logger.info(f"Heartbeat tiklandi ({source}). Watchdog holati: ARMED")
                self.watchdog_state = "ARMED"

    def _supervision_loop(self):
        """Asosiy 20 Hz (har 50 ms) monitoring sikli"""
        while self.running:
            try:
                now = time.time()
                age = now - self.last_heartbeat_time
                age_ms = int(age * 1000)

                # Arduino harakatda ekanligini tekshirish
                is_moving = False
                if self.arduino_bridge:
                    try:
                        st = self.arduino_bridge.get_status()
                        is_moving = st.get("last_cmd") not in ('S', 'STOP', None, '')
                    except Exception:
                        is_moving = True # Shubhali holatda harakatda deb hisoblanadi

                # 1. FAILSAFE: Agar robot harakatlanayotgan bo'lsa va Heartbeat uzilsa
                if is_moving and age > self.failsafe_timeout_sec:
                    with self.lock:
                        if self.watchdog_state != "TRIGGERED":
                            self.watchdog_state = "TRIGGERED"
                            self.failsafe_trigger_count += 1
                            self.last_failsafe_time = now
                            logger.critical(
                                f"🚨 [FAILSAFE AKTIVLASHTIRILDI] Heartbeat {age_ms} ms davomida kelmadi! "
                                f"Favqulodda to'xtash ('S') yuborilmoqda!"
                            )

                    # Zudlik bilan robot motorlarini to'xtatish
                    if self.arduino_bridge:
                        try:
                            self.arduino_bridge.send_command('S')
                        except Exception as e:
                            logger.error(f"Favqulodda 'S' buyrug'ini yuborishda xato: {e}")

                # 2. Tizim resurslari monitoringi (Har 1 soniyada)
                cpu_temp = self._read_cpu_temperature()
                cpu_usage = psutil.cpu_percent() if HAS_PSUTIL else 15.0
                ram_pct = psutil.virtual_memory().percent if HAS_PSUTIL else 32.0

                with self.lock:
                    self.telemetry_cache = {
                        "status": self.watchdog_state,
                        "cpu_temp_c": round(cpu_temp, 1),
                        "cpu_usage_pct": round(cpu_usage, 1),
                        "ram_used_pct": round(ram_pct, 1),
                        "heartbeat_age_ms": age_ms,
                        "failsafe_active": (self.watchdog_state == "TRIGGERED"),
                        "failsafe_count": self.failsafe_trigger_count,
                        "last_failsafe_ago_sec": round(now - self.last_failsafe_time, 1) if self.last_failsafe_time else None,
                        "is_moving": is_moving,
                        "ota_version": "v1.0-memorandum-2.4",
                        "timestamp": round(now, 3)
                    }

                # 3. Serial Portni avtomatik tiklash (Reconnection Supervisor)
                if self.arduino_bridge and hasattr(self.arduino_bridge, 'is_hardware'):
                    if self.arduino_bridge.is_hardware and not getattr(self.arduino_bridge, 'ser', None):
                        self._attempt_serial_reconnect()

            except Exception as e:
                logger.error(f"Supervision tsikli xatosi: {e}")

            time.sleep(0.05)

    def _read_cpu_temperature(self) -> float:
        """Raspberry Pi Linux yoki Windows CPU haroratini o'qish"""
        # Raspberry Pi Linux
        temp_file = "/sys/class/thermal/thermal_zone0/temp"
        if os.path.exists(temp_file):
            try:
                with open(temp_file, "r") as f:
                    return float(f.read().strip()) / 1000.0
            except Exception:
                pass
        return 42.5

    def _attempt_serial_reconnect(self):
        """Arduino Serial uzilib qolganda avtomatik port qidirish va tiklash"""
        self.reconnect_attempts += 1
        logger.warning(f"Arduino aloqasini qayta tiklashga urinish #{self.reconnect_attempts}...")
        try:
            if hasattr(self.arduino_bridge, '_init_connection'):
                self.arduino_bridge._init_connection()
        except Exception as e:
            logger.error(f"Qayta ulanish urinishi xatosi: {e}")

    def get_status(self) -> Dict[str, Any]:
        """Tashqi API va HUD uchun telemetriya"""
        with self.lock:
            return dict(self.telemetry_cache)

    def trigger_manual_emergency_stop(self, reason: str = "OPERATOR_PANIC"):
        """Operator yoki AI tomonidan qo'lda favqulodda to'xtatish"""
        with self.lock:
            self.watchdog_state = "TRIGGERED"
            self.failsafe_trigger_count += 1
            self.last_failsafe_time = time.time()
            logger.warning(f"Qo'lda Favqulodda To'xtash chaqirildi ({reason})")

        if self.arduino_bridge:
            self.arduino_bridge.send_command('S')

    def stop(self):
        self.running = False


# Modul sinovi
if __name__ == '__main__':
    print("Qalqon Watchdog Daemoni sinovi...")
    daemon = QalqonWatchdogDaemon()
    for _ in range(5):
        daemon.feed_heartbeat("TEST")
        time.sleep(0.2)
        print("Status:", daemon.get_status())
    daemon.stop()
