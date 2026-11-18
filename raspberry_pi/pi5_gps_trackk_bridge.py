#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
QALQON — Raspberry Pi 5: LG290P GNSS RTK -> Trackk Cloud Bridge
Manzil: https://trackk-gl6l.onrender.com/api.php
=============================================================================
Vazifalari:
  1. Pi 5 USB portiga ulangan jismoniy LG290P GNSS RTK modulidan (/dev/ttyUSB*,
     /dev/ttyACM*, /dev/gps) NMEA paketlarini (GNGGA, GNRMC) o'qish;
  2. Santimetr darajasidagi RTK koordinatalarini (lat, lng, fix, sat, hdop)
     to'g'ridan-to'g'ri https://trackk-gl6l.onrender.com ga POST qilish;
  3. Agar jismoniy modul ulanmagan bo'lsa, Trackk serveridan boshqa manba
     koordinatasini olib turish (Cloud fallback).
=============================================================================
"""

import os
import sys
import glob
import time
import json
import threading
import urllib.request
import urllib.error
from typing import Optional, Dict, Any

TRACKK_API_URL = os.environ.get("TRACKK_API_URL", "https://trackk-gl6l.onrender.com/api.php")
SERIAL_PORT = os.environ.get("GPS_PORT", "")  # Bo'sh bo'lsa, avtomatik topadi
BAUD_RATES = [115200, 9600, 460800, 38400]

def parse_nmea_lat_lng(raw_lat: str, lat_dir: str, raw_lng: str, lng_dir: str):
    """NMEA DDMM.MMMM formatini o'nlik gradusga (Decimal Degrees) o'girish"""
    try:
        # Kenglik: DDMM.MMMMM
        lat_deg = float(raw_lat[:2]) + float(raw_lat[2:]) / 60.0
        if lat_dir.upper() == 'S':
            lat_deg = -lat_deg
            
        # Uzunlik: DDDMM.MMMMM
        lng_deg = float(raw_lng[:3]) + float(raw_lng[3:]) / 60.0
        if lng_dir.upper() == 'W':
            lng_deg = -lng_deg
            
        return lat_deg, lng_deg
    except Exception:
        return None, None

class HardwareGpsReader(threading.Thread):
    """LG290P USB datchigini o'qib, Trackk ko'prigiga uzatuvchi oqim"""
    def __init__(self, bridge: 'TrackkGpsBridge'):
        super().__init__(daemon=True)
        self.bridge = bridge
        self.running = True
        self.serial_inst = None

    def find_gps_port(self) -> Optional[str]:
        if SERIAL_PORT and os.path.exists(SERIAL_PORT):
            return SERIAL_PORT
        # /dev/gps (udev qoidasi orqali), yoki USB/ACM portlari
        candidates = ['/dev/gps'] + glob.glob('/dev/ttyUSB*') + glob.glob('/dev/ttyACM*') + ['/dev/serial0']
        for p in candidates:
            if os.path.exists(p):
                return p
        return None

    def run(self):
        try:
            import serial
        except ImportError:
            print("[HardwareGPS] 'pyserial' kutubxonasi yo'q. Faqat bulut rejimi ishlaydi.")
            return

        while self.running:
            port = self.find_gps_port()
            if not port:
                time.sleep(3.0)
                continue

            # Baudrate qidirish (LG290P standart 115200)
            opened = False
            for baud in BAUD_RATES:
                try:
                    ser = serial.Serial(port, baudrate=baud, timeout=1.5)
                    # Bir necha qator o'qib ko'rish
                    for _ in range(5):
                        line = ser.readline().decode('ascii', errors='ignore')
                        if '$GN' in line or '$GP' in line:
                            print(f"[HardwareGPS] ✅ LG290P datchigi topildi: {port} ({baud} baud)")
                            self.serial_inst = ser
                            opened = True
                            break
                    if opened:
                        break
                    ser.close()
                except Exception:
                    continue

            if not opened or not self.serial_inst:
                time.sleep(3.0)
                continue

            last_push_t = 0.0
            cur_lat = 0.0
            cur_lng = 0.0
            cur_fix = 0
            cur_sat = 0
            cur_hdop = 99.0
            cur_alt = 0.0
            cur_speed = 0.0

            while self.running:
                try:
                    line = self.serial_inst.readline().decode('ascii', errors='ignore').strip()
                    if not line:
                        continue

                    # GNGGA yoki GPGGA: Koordinatalar va RTK Fix
                    if line.startswith('$GNGGA') or line.startswith('$GPGGA'):
                        parts = line.split(',')
                        if len(parts) >= 10 and parts[2] and parts[4]:
                            lat, lng = parse_nmea_lat_lng(parts[2], parts[3], parts[4], parts[5])
                            if lat is not None and lng is not None:
                                cur_lat = lat
                                cur_lng = lng
                                cur_fix = int(parts[6]) if parts[6].isdigit() else 0
                                cur_sat = int(parts[7]) if parts[7].isdigit() else 0
                                cur_hdop = float(parts[8]) if parts[8] else 99.0
                                cur_alt = float(parts[9]) if parts[9] else 0.0

                    # GNRMC yoki GPRMC: Tezlik va Sana/Vaqt
                    elif line.startswith('$GNRMC') or line.startswith('$GPRMC'):
                        parts = line.split(',')
                        if len(parts) >= 8 and parts[7]:
                            try:
                                cur_speed = float(parts[7]) * 1.852  # Knots to km/h
                            except Exception:
                                pass

                    # Har 400ms da serverga uzatish (agar koordinata mavjud bo'lsa)
                    now = time.time()
                    if cur_lat != 0.0 and (now - last_push_t) >= 0.4:
                        last_push_t = now
                        self.bridge.push_coordinates_to_server(
                            lat=cur_lat,
                            lng=cur_lng,
                            fix=cur_fix,
                            hdop=cur_hdop,
                            alt=cur_alt,
                            speed=cur_speed,
                            sat=cur_sat
                        )

                except Exception as e:
                    print(f"[HardwareGPS] Aloqa xatosi: {e}")
                    try:
                        self.serial_inst.close()
                    except Exception:
                        pass
                    self.serial_inst = None
                    time.sleep(2.0)
                    break

class TrackkGpsBridge:
    def __init__(self, api_url: str = TRACKK_API_URL):
        self.api_url = api_url.rstrip("/")
        self.running = True
        self.lock = threading.Lock()
        
        self.latest_data: Dict[str, Any] = {
            "status": "waiting",
            "is_online": False,
            "lat": 0.0,
            "lng": 0.0,
            "fix": 0,
            "fix_str": "Kutilmoqda...",
            "sat": 0,
            "hdop": 99.9,
            "alt": 0.0,
            "speed": 0.0,
            "server_time": "",
            "last_updated": 0.0,
            "has_hardware_gps": False
        }

        # 1. Jismoniy LG290P o'quvchini ishga tushirish
        self.hw_reader = HardwareGpsReader(self)
        self.hw_reader.start()

        # 2. Bulutdan o'qib turuvchi oqim (Cloud sync)
        threading.Thread(target=self._poll_loop, daemon=True).start()

    def get_gps(self) -> Dict[str, Any]:
        with self.lock:
            return dict(self.latest_data)

    def _poll_loop(self):
        print(f"[GPS] Trackk RTK serveri faol: {self.api_url}")
        while self.running:
            # Agar jismoniy GPS ulanmagan bo'lsa, serverdan olamiz
            if not self.latest_data.get("has_hardware_gps"):
                try:
                    sep = "&" if "?" in self.api_url else "?"
                    req_url = f"{self.api_url}{sep}action=robot&_={int(time.time() * 1000)}"
                    req = urllib.request.Request(
                        req_url,
                        headers={"User-Agent": "QalqonPi5-AMR/1.0"}
                    )
                    with urllib.request.urlopen(req, timeout=4.0) as resp:
                        if resp.status == 200:
                            raw = resp.read().decode("utf-8")
                            data = json.loads(raw)
                            if data.get("status") == "ok" and "lat" in data and "lng" in data:
                                with self.lock:
                                    self.latest_data.update({
                                        "status": "ok",
                                        "is_online": bool(data.get("is_online", True)),
                                        "lat": float(data["lat"]),
                                        "lng": float(data["lng"]),
                                        "fix": int(data.get("fix", 0)),
                                        "fix_str": str(data.get("fix_str", "GPS FIX")),
                                        "sat": int(data.get("sat", 0)),
                                        "hdop": float(data.get("hdop", 1.0)),
                                        "alt": float(data.get("alt", 0.0)),
                                        "speed": float(data.get("speed", 0.0)),
                                        "server_time": str(data.get("server_time", "")),
                                        "last_updated": time.time()
                                    })
                except Exception:
                    pass
            
            time.sleep(0.8)

    def push_coordinates_to_server(self, lat: float, lng: float, fix: int = 1, hdop: float = 1.0, alt: float = 0.0, speed: float = 0.0, sat: int = 10) -> bool:
        """LG290P datchigidan olingan RTK koordinatasini serverga va mahalliy xotiraga yozish"""
        fix_str = "RTK FIXED (2 sm)" if fix == 4 else "RTK FLOAT (20 sm)" if fix == 5 else "DGPS" if fix == 2 else "GPS 3D" if fix == 1 else "NO FIX"
        
        with self.lock:
            self.latest_data.update({
                "status": "ok",
                "is_online": True,
                "lat": lat,
                "lng": lng,
                "fix": fix,
                "fix_str": fix_str,
                "sat": sat,
                "hdop": hdop,
                "alt": alt,
                "speed": speed,
                "last_updated": time.time(),
                "has_hardware_gps": True
            })

        try:
            payload = json.dumps({
                "lat": lat,
                "lng": lng,
                "fix": fix,
                "fix_str": fix_str,
                "hdop": hdop,
                "alt": alt,
                "speed": speed,
                "sat": sat,
                "ts": int(time.time() * 1000)
            }).encode("utf-8")

            req = urllib.request.Request(
                self.api_url,
                data=payload,
                headers={"Content-Type": "application/json", "User-Agent": "QalqonPi5-LG290P"}
            )
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                return resp.status in (200, 201)
        except Exception:
            return False

if __name__ == "__main__":
    bridge = TrackkGpsBridge()
    print("[+] QALQON LG290P RTK GPS Bridge ishga tushdi...")
    print("    - USB ulanishi avtomatik qidirilmoqda (/dev/ttyUSB*, /dev/ttyACM*, /dev/gps)...")
    print("    - Trackk serveri: " + TRACKK_API_URL)
    try:
        while True:
            gps = bridge.get_gps()
            hw = " [HARDWARE USB]" if gps.get("has_hardware_gps") else " [CLOUD SYNC]"
            print(f"[GPS{hw}] Fix: {gps.get('fix_str')} | Lat: {gps['lat']:.7f}, Lng: {gps['lng']:.7f} | Sat: {gps['sat']} | HDOP: {gps['hdop']}")
            time.sleep(1.0)
    except KeyboardInterrupt:
        print("\nTo'xtatildi.")
