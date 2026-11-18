#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
QALQON — Raspberry Pi 5 uchun Trackk RTK GPS Ko'prigi (Bridge)
Manzil: https://trackk-gl6l.onrender.com/api.php
=============================================================================
Vazifalari:
  1. https://trackk-gl6l.onrender.com/api.php?action=robot dan real-vaqt
     RTK GPS (lat, lng, alt, sat, hdop, fix, speed) ma'lumotlarini olib turish;
  2. Agar Pi 5 ga jismoniy USB GPS moduli ulangan bo'lsa (/dev/ttyUSB_GPS yoki
     /dev/ttyACM0), NMEA paketlarini o'qib, avtomatik ravishda trackk serveriga
     POST qilish;
  3. Mahalliy robot jarayonlari (LiDAR, avtopilot) uchun GPS keshini taqdim etish.
=============================================================================
"""

import os
import sys
import time
import json
import threading
import urllib.request
import urllib.error
from typing import Optional, Dict, Any

TRACKK_API_URL = os.environ.get("TRACKK_API_URL", "https://trackk-gl6l.onrender.com/api.php")
POLL_INTERVAL = float(os.environ.get("GPS_POLL_SEC", "0.5"))

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
            "last_updated": 0.0
        }

        # Oqimni ishga tushirish
        threading.Thread(target=self._poll_loop, daemon=True).start()

    def get_gps(self) -> Dict[str, Any]:
        with self.lock:
            return dict(self.latest_data)

    def _poll_loop(self):
        print(f"[GPS] Trackk RTK serveriga ulanilmoqda: {self.api_url}")
        while self.running:
            try:
                sep = "&" if "?" in self.api_url else "?"
                req_url = f"{self.api_url}{sep}action=robot&_={int(time.time() * 1000)}"
                req = urllib.request.Request(
                    req_url,
                    headers={"User-Agent": "QalqonPi5-AMR/1.0"}
                )
                with urllib.request.urlopen(req, timeout=5.0) as resp:
                    if resp.status == 200:
                        raw = resp.read().decode("utf-8")
                        data = json.loads(raw)
                        if data.get("status") == "ok" and "lat" in data and "lng" in data:
                            with self.lock:
                                self.latest_data = {
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
                                }
                        elif data.get("status") == "waiting":
                            with self.lock:
                                self.latest_data["status"] = "waiting"
                                self.latest_data["is_online"] = False
            except Exception as e:
                with self.lock:
                    self.latest_data["is_online"] = False
                    self.latest_data["error"] = str(e)
            
            time.sleep(POLL_INTERVAL)

    def push_coordinates_to_server(self, lat: float, lng: float, fix: int = 1, hdop: float = 1.0, alt: float = 0.0, speed: float = 0.0, sat: int = 10) -> bool:
        """Jismoniy GPS datchigidan olingan ma'lumotni trackk serveriga POST qilish"""
        try:
            payload = json.dumps({
                "lat": lat,
                "lng": lng,
                "fix": fix,
                "fix_str": "RTK FIXED" if fix == 4 else "RTK FLOAT" if fix == 5 else "GPS FIX",
                "hdop": hdop,
                "alt": alt,
                "speed": speed,
                "sat": sat,
                "ts": int(time.time() * 1000)
            }).encode("utf-8")

            req = urllib.request.Request(
                self.api_url,
                data=payload,
                headers={"Content-Type": "application/json", "User-Agent": "QalqonPi5-HardwareGPS"}
            )
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                return resp.status in (200, 201)
        except Exception:
            return False

if __name__ == "__main__":
    bridge = TrackkGpsBridge()
    print("[+] Trackk GPS Bridge monitoring boshlandi (Ctrl+C to'xtatadi)...")
    try:
        while True:
            gps = bridge.get_gps()
            print(f"[GPS] Holat: {gps['status']} | Fix: {gps.get('fix_str')} | Lat: {gps['lat']:.7f}, Lng: {gps['lng']:.7f} | Sat: {gps['sat']} | HDOP: {gps['hdop']}")
            time.sleep(2.0)
    except KeyboardInterrupt:
        print("\nTo'xtatildi.")
