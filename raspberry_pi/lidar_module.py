#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QALQON - 360° LiDAR Moduli (STL-19P / LD19 / RPLiDAR va Smart Simulyator)
Platforma: Raspberry Pi 4 / Kompyuter / Telefon sinovlari.

- Haqiqiy LiDAR ulanganda: 230400 / 115200 baudda avtomatik o'qiydi.
- LiDAR yo'qligida: Smart Simulyator rejimida 360° to'lqinlarni hosil qiladi.
"""

import math
import sys
import time
import threading
import random

try:
    if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

try:
    import serial
    from serial.tools import list_ports
    HAS_SERIAL = True
except ImportError:
    serial = None
    list_ports = None
    HAS_SERIAL = False

# LD19 protokoli
PKT_LEN = 47
HEADER, VERLEN = 0x54, 0x2C

def _make_crc_table(poly=0x4D):
    tbl = []
    for i in range(256):
        c = i
        for _ in range(8):
            c = ((c << 1) ^ poly) & 0xFF if c & 0x80 else (c << 1) & 0xFF
        tbl.append(c)
    return tbl

CRC_TABLE = _make_crc_table()

def crc8(data: bytes) -> int:
    c = 0
    for b in data:
        c = CRC_TABLE[(c ^ b) & 0xFF]
    return c

def parse_ld19_packet(pkt: bytes):
    if len(pkt) != PKT_LEN or pkt[0] != HEADER or pkt[1] != VERLEN:
        return None
    if crc8(pkt[:-1]) != pkt[-1]:
        return None
    speed = int.from_bytes(pkt[2:4], "little")
    start = int.from_bytes(pkt[4:6], "little") / 100.0
    end = int.from_bytes(pkt[42:44], "little") / 100.0
    diff = (end - start) % 360.0
    step = diff / 11.0
    pts = []
    for i in range(12):
        o = 6 + i * 3
        dist = int.from_bytes(pkt[o:o + 2], "little") / 1000.0
        inten = pkt[o + 2]
        pts.append(((start + step * i) % 360.0, dist, inten))
    return speed, pts


class LidarModule:
    def __init__(self, port: str = None, baudrate: int = 230400):
        self.port = port
        self.baudrate = baudrate
        self.is_hardware = False
        self.running = True
        
        # 360 daraja ma'lumotlar
        self.scan_distances = [0.0] * 360
        self.scan_intensities = [0] * 360
        self.rate_hz = 0.0
        self.last_scan_time = 0.0
        self.crc_errors = 0
        self.packets_count = 0
        
        self.lock = threading.Lock()
        
        # Simulyatsiya parametrlari
        self.sim_obstacles = [
            {"angle": 0, "dist": 3.2, "width": 25},   # Old to'siq
            {"angle": 90, "dist": 2.1, "width": 20},  # O'ng devor
            {"angle": 270, "dist": 2.4, "width": 20}, # Chap devor
            {"angle": 180, "dist": 4.0, "width": 30}  # Orqa devor
        ]
        self.virtual_obstacle_dist = None
        
        # Drayverni ishga tushirish
        self._init_source()

    def _init_source(self):
        # 1. Portni qidirish
        cand_port = self.port or self._find_port()
        if cand_port and HAS_SERIAL:
            try:
                s = serial.Serial(cand_port, self.baudrate, timeout=0.1)
                s.close()
                self.port = cand_port
                self.is_hardware = True
                print(f"[LiDAR] [OK] Haqiqiy LiDAR aniqlandi: {self.port} ({self.baudrate} baud)")
                threading.Thread(target=self._hardware_loop, daemon=True).start()
                return
            except Exception as e:
                print(f"[LiDAR] [!] Haqiqiy port ochilmadi ({e}). Simulyatorga o'tilmoqda.")

        # 2. Agar apparat bo'lmasa, Smart Simulyatorni ishga tushiramiz
        self.is_hardware = False
        print("[LiDAR] [*] Smart LiDAR Simulyatori FAOL (360-gradus virtual radar)")
        threading.Thread(target=self._simulator_loop, daemon=True).start()

    def _find_port(self):
        if not HAS_SERIAL or list_ports is None:
            return None
        for p in list_ports.comports():
            desc = f"{p.description} {p.manufacturer or ''}".lower()
            if any(k in desc for k in ("cp210", "ch340", "ftdi", "silicon labs", "usb-serial", "lidar")):
                return p.device
        return None

    def _hardware_loop(self):
        buf = bytearray()
        acc = [0.0] * 360
        acc_i = [0] * 360
        last_start = None
        stamps = []

        try:
            ser = serial.Serial(self.port, self.baudrate, timeout=0.05)
        except Exception as e:
            print(f"[LiDAR Error] Serial ochilmadi: {e}. Simulyatorga o'tildi.")
            self.is_hardware = False
            self._simulator_loop()
            return

        while self.running:
            try:
                data = ser.read(ser.in_waiting or 128)
                if not data:
                    time.sleep(0.01)
                    continue
                buf.extend(data)

                # Paketlarni qidirish
                while len(buf) >= PKT_LEN:
                    i = 0
                    while i + 1 < len(buf) and not (buf[i] == HEADER and buf[i + 1] == VERLEN):
                        i += 1
                    if i > 0:
                        del buf[:i]
                    if len(buf) < PKT_LEN:
                        break

                    pkt = bytes(buf[:PKT_LEN])
                    del buf[:PKT_LEN]

                    res = parse_ld19_packet(pkt)
                    if res is None:
                        self.crc_errors += 1
                        continue

                    _, pts = res
                    self.packets_count += 1

                    for a, d, inten in pts:
                        deg = int(round(a)) % 360
                        acc[deg] = d if 0.05 < d < 12.0 else 0.0
                        acc_i[deg] = inten

                    cur_start = pts[0][0]
                    if last_start is not None and cur_start < last_start:
                        # 360 daraja to'liq aylanish tugadi
                        now = time.time()
                        stamps.append(now)
                        if len(stamps) > 10:
                            stamps.pop(0)
                        if len(stamps) >= 2:
                            self.rate_hz = round((len(stamps) - 1) / (stamps[-1] - stamps[0]), 1)

                        with self.lock:
                            self.scan_distances = list(acc)
                            self.scan_intensities = list(acc_i)
                            self.last_scan_time = now

                        acc = [0.0] * 360
                        acc_i = [0] * 360
                    last_start = cur_start

            except Exception as e:
                time.sleep(0.05)

    def _simulator_loop(self):
        """Haqiqiy LiDAR bo'lmaganda 360° to'lqinlarni 10 Hz da hosil qiladi"""
        t = 0.0
        while self.running and not self.is_hardware:
            now = time.time()
            t += 0.1
            temp_scan = [0.0] * 360
            temp_inten = [0] * 360

            # Virtual xona devorlari (5m x 4m koridor)
            room_w = 4.2
            room_l = 6.0
            
            for deg in range(360):
                rad = math.radians(deg)
                
                # To'g'ri burchakli devorlar kesishmasi
                dx = math.sin(rad)
                dy = math.cos(rad)
                
                dist_wall = 5.0
                if abs(dx) > 1e-3:
                    dist_x = abs((room_w / 2.0) / dx)
                    dist_wall = min(dist_wall, dist_x)
                if abs(dy) > 1e-3:
                    dist_y = abs((room_l / 2.0) / dy)
                    dist_wall = min(dist_wall, dist_y)

                # Shovqin (juda kichik realistik tebranish)
                dist_wall += (random.random() - 0.5) * 0.04
                
                # Dinamik to'siqlar
                for obs in self.sim_obstacles:
                    diff = abs((deg - obs["angle"] + 180) % 360 - 180)
                    if diff < obs["width"]:
                        dist_wall = min(dist_wall, obs["dist"] + math.sin(t + deg) * 0.05)

                # Qo'lda kiritilgan old to'siq
                if self.virtual_obstacle_dist is not None:
                    diff_front = abs((deg - 0 + 180) % 360 - 180)
                    if diff_front < 28:
                        dist_wall = min(dist_wall, self.virtual_obstacle_dist)

                temp_scan[deg] = round(max(0.1, dist_wall), 2)
                temp_inten[deg] = int(180 + (random.random() * 60))

            with self.lock:
                self.scan_distances = temp_scan
                self.scan_intensities = temp_inten
                self.last_scan_time = now
                self.rate_hz = 10.0

            time.sleep(0.09)

    def set_virtual_obstacle(self, distance_m: float = None):
        """Test uchun oldinga virtual to'siq qo'yish (masalan 0.4 m) yoki olib tashlash (None)"""
        self.virtual_obstacle_dist = distance_m
        if distance_m is not None:
            print(f"[LiDAR Sim] [!] Oldinda virtual to'siq paydo bo'ldi: {distance_m:.2f} m")
        else:
            print("[LiDAR Sim] Yo'l ochiq (to'siq olib tashlandi)")

    def get_points_list(self, max_distance: float = 8.0, step: int = 2):
        """Frontend (LidarRadarView) talab qiladigan formatdagi ro'yxat: [{angle, distance, intensity}]"""
        with self.lock:
            pts = []
            for angle in range(0, 360, step):
                d = self.scan_distances[angle]
                if 0.08 < d <= max_distance:
                    pts.append({
                        "angle": angle,
                        "distance": d,
                        "intensity": self.scan_intensities[angle]
                    })
            return pts

    def get_sectors(self):
        """4 ta asosiy yo'nalish bo'yicha eng yaqin masofalar (metrlarda)"""
        with self.lock:
            def min_in_range(start_deg, end_deg):
                vals = []
                for a in range(start_deg, end_deg):
                    idx = (a % 360 + 360) % 360
                    d = self.scan_distances[idx]
                    if d > 0.08:
                        vals.append(d)
                return min(vals) if vals else 9.9

            front = min_in_range(-30, 30)
            right = min_in_range(60, 120)
            rear = min_in_range(150, 210)
            left = min_in_range(240, 300)

            return {
                "front": round(front, 2),
                "rear": round(rear, 2),
                "left": round(left, 2),
                "right": round(right, 2)
            }

    def is_front_blocked(self, safe_distance: float = 0.45) -> bool:
        """Oldinda to'siq xavfi bormi?"""
        sectors = self.get_sectors()
        return sectors["front"] <= safe_distance

    def get_slam_grid(self, grid_size: int = 60, resolution_m: float = 0.1):
        """
        2D SLAM Occupancy Grid Map (60x60 panjara, har katak 10x10 sm).
        Robot markazda (30, 30).
        0 = Bo'sh joy, 100 = To'siq/Devor.
        """
        grid = [[0 for _ in range(grid_size)] for _ in range(grid_size)]
        center = grid_size // 2
        with self.lock:
            for deg in range(360):
                d = self.scan_distances[deg]
                if 0.1 < d < (grid_size * resolution_m / 2.0):
                    rad = math.radians(deg)
                    gx = int(center + (d * math.sin(rad)) / resolution_m)
                    gy = int(center - (d * math.cos(rad)) / resolution_m)
                    if 0 <= gx < grid_size and 0 <= gy < grid_size:
                        grid[gy][gx] = 100
        return {
            "size": grid_size,
            "resolution_m": resolution_m,
            "center": [center, center],
            "grid": grid
        }

    def status(self):
        return {
            "mode": "HARDWARE" if self.is_hardware else "SIMULATION",
            "is_hardware": self.is_hardware,
            "port": self.port or "VIRTUAL_LIDAR",
            "rate_hz": self.rate_hz,
            "crc_errors": self.crc_errors,
            "packets": self.packets_count,
            "age_ms": round((time.time() - self.last_scan_time) * 1000) if self.last_scan_time > 0 else -1
        }

    def close(self):
        self.running = False


# Oddiy tezkor test
if __name__ == '__main__':
    print("LiDAR moduli sinovi...")
    lidar = LidarModule()
    time.sleep(1.0)
    print("Status:", lidar.status())
    print("Sektorlar:", lidar.get_sectors())
    print("Nuqtalar soni:", len(lidar.get_points_list()))
    lidar.close()
