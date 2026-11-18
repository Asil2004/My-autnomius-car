#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
🛡️ QALQON AMR v1.0 — AVTONOM RTK GNSS NAVIGATSIYA TIZIMI
=============================================================================
Platforma: Raspberry Pi 5 / Linux / ROS
Vazifasi:
  1. https://trackk-gl6l.onrender.com/api.php?action=robot serveridan real vaqtda
     santimetr aniqlikdagi RTK GNSS ma'lumotlarini (lat, lng, fix, is_online, target) olish.
  2. Haversine formulasi bo'yicha masofa va Azimut (Bearing) burchagini hisoblash.
  3. 0.8 metrgacha aniqlikda manzilga yetib borish va to'xtash.
  4. Qat'iy Failsafe (xavfsizlik): is_online=false yoki aloqa 3 soniyadan ortiq uzilsa
     motorlarni darhol to'xtatish.
  5. Serial (USB) yoki HTTP orqali ESP32 / Arduino motor drayverlariga buyruq yuborish.
=============================================================================
"""

import time
import math
import logging
import json
import os
import sys

# requests kutubxonasi bo'lmasa, standart urllib dan foydalanish (nol bog'liqlik)
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    import urllib.request
    import urllib.error

# Loglarni chiroyli formatlash
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger("RTK_NAVIGATOR")

# ---------------------------------------------------------------------------
# 1. SOZLAMALAR (KONFIGURATSIYA)
# ---------------------------------------------------------------------------
SERVER_URL = os.getenv("RTK_SERVER_URL", "https://trackk-gl6l.onrender.com/api.php?action=robot")
POLL_INTERVAL_SEC = 0.5       # So'rovlar oralig'i (0.5 - 1.0 soniya)
FAILSAFE_TIMEOUT_SEC = 3.0    # Aloqa uzilish xavfsizlik chegarasi (soniya)
ARRIVAL_THRESHOLD_METERS = 0.8 # Maqsadga yetgan deb hisoblash masofasi (metr)

# Motor aloqa kanali: "SERIAL" yoki "HTTP"
MOTOR_INTERFACE = os.getenv("MOTOR_INTERFACE", "HTTP") # yoki "SERIAL"
ESP32_IP = os.getenv("ESP32_IP", "192.168.43.50")
SERIAL_PORT = os.getenv("SERIAL_PORT", "/dev/ttyUSB0")
SERIAL_BAUD = int(os.getenv("SERIAL_BAUD", "115200"))

EARTH_RADIUS_METERS = 6371000.0  # Yer shari radiusi

# ---------------------------------------------------------------------------
# 2. MOTOR BOSHQARUV KLASSI (SERIAL / HTTP)
# ---------------------------------------------------------------------------
class MotorController:
    def __init__(self, interface: str = "HTTP"):
        self.interface = interface.upper()
        self.ser = None
        self.last_cmd = None
        self.session = requests.Session() if HAS_REQUESTS else None

        if self.interface == "SERIAL":
            try:
                import serial
                self.ser = serial.Serial(SERIAL_PORT, SERIAL_BAUD, timeout=0.5)
                log.info(f"✓ Serial port ochildi: {SERIAL_PORT} ({SERIAL_BAUD} baud)")
            except Exception as e:
                log.warning(f"Serial port ochilmadi ({e}). HTTP rejimiga o'tiladi.")
                self.interface = "HTTP"

    def send_command(self, cmd: str):
        if cmd == self.last_cmd and cmd != 'S':
            return # Bir xil buyruqni qayta-qayta yubormaslik

        self.last_cmd = cmd
        log.info(f"🕹️  Motor buyrug'i: [{cmd}]")

        if self.interface == "SERIAL" and self.ser and self.ser.is_open:
            try:
                self.ser.write(f"{cmd}\n".encode('ascii'))
            except Exception as e:
                log.error(f"Serial xatolik: {e}")
        else:
            # HTTP orqali ESP32 ga yuborish
            url = f"http://{ESP32_IP}/move?dir={cmd}"
            try:
                if HAS_REQUESTS:
                    self.session.get(url, timeout=0.8)
                else:
                    req = urllib.request.Request(url, headers={'User-Agent': 'Qalqon-AMR'})
                    with urllib.request.urlopen(req, timeout=0.8) as _:
                        pass
            except Exception:
                pass

    def stop(self):
        """Zudlik bilan to'xtash (Failsafe)"""
        self.send_command('S')


# ---------------------------------------------------------------------------
# 3. GEODEZIK MATEMATIKA: HAVERSINE & BEARING
# ---------------------------------------------------------------------------
def calculate_haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Ikki koordinata orasidagi to'g'ri chiziqli masofa (metrda).
    Santimetr darajadagi RTK GNSS o'lchovlariga mos.
    """
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    distance = EARTH_RADIUS_METERS * c
    return distance

def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    1-nuqtadan 2-nuqtaga yo'nalish azimut burchagi (0°..360°).
    0° = Shimol, 90° = Sharq, 180° = Janub, 270° = G'arb.
    """
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)

    y = math.sin(delta_lambda) * math.cos(phi2)
    x = (math.cos(phi1) * math.sin(phi2) -
         math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda))

    bearing_rad = math.atan2(y, x)
    bearing_deg = (math.degrees(bearing_rad) + 360.0) % 360.0
    return bearing_deg

def normalize_angle_diff(target_bearing: float, current_heading: float) -> float:
    """
    Maqsad azimuti va robot yo'nalishi orasidagi eng qisqa burchak xatosi (-180°..+180°).
    Musbat (+) = Robot o'ngga burilishi kerak.
    Manfiy (-) = Robot chapga burilishi kerak.
    """
    diff = (target_bearing - current_heading + 540.0) % 360.0 - 180.0
    return diff


# ---------------------------------------------------------------------------
# 4. AVTONOM NAVIGATSIYA BOSHQARUV TIZIMI
# ---------------------------------------------------------------------------
class RtkGpsNavigator:
    def __init__(self):
        self.motor = MotorController(MOTOR_INTERFACE)
        self.last_valid_rx_time = 0.0
        self.prev_lat = None
        self.prev_lng = None
        self.current_heading = 0.0 # Robotning harakat yo'nalishi
        if HAS_REQUESTS:
            self.session = requests.Session()
            self.session.headers.update({
                'User-Agent': 'Qalqon-AMR-Navigator/1.0',
                'Accept': 'application/json'
            })
        else:
            self.session = None

        log.info("🛡️  QALQON RTK GNSS Navigatsiya tizimi ishga tushirildi.")
        log.info(f"🌐 Server: {SERVER_URL}")

    def fetch_telemetry(self):
        """Serverdan GNSS telemetriyasini olish"""
        try:
            if HAS_REQUESTS:
                resp = self.session.get(SERVER_URL, timeout=2.5)
                if resp.status_code == 200:
                    return resp.json()
                else:
                    log.warning(f"Server xatoligi: HTTP {resp.status_code}")
                    return None
            else:
                req = urllib.request.Request(
                    SERVER_URL,
                    headers={'User-Agent': 'Qalqon-AMR-Navigator/1.0', 'Accept': 'application/json'}
                )
                with urllib.request.urlopen(req, timeout=2.5) as resp:
                    if resp.status == 200:
                        raw = resp.read().decode('utf-8')
                        return json.loads(raw)
                    else:
                        log.warning(f"Server xatoligi: HTTP {resp.status}")
                        return None
        except Exception as e:
            log.warning(f"Aloqa xatoligi: {e}")
            return None

    def update_heading_from_motion(self, current_lat: float, current_lng: float, speed_kmh: float):
        """
        Agar datchikda giroskop bo'lmasa, robot harakatlanayotganda (tezlik > 0.5 km/soat)
        oxirgi ikkita GNSS nuqtasi bo'yicha haqiqiy kursni (heading) hisoblash.
        """
        if self.prev_lat is not None and self.prev_lng is not None:
            dist = calculate_haversine_distance(self.prev_lat, self.prev_lng, current_lat, current_lng)
            if dist > 0.20: # Kamida 20 sm siljigan bo'lsa
                self.current_heading = calculate_bearing(self.prev_lat, self.prev_lng, current_lat, current_lng)
                self.prev_lat = current_lat
                self.prev_lng = current_lng
        else:
            self.prev_lat = current_lat
            self.prev_lng = current_lng

    def run(self):
        """Asosiy navigatsiya sikli"""
        while True:
            start_loop = time.time()
            data = self.fetch_telemetry()
            now = time.time()

            # -------------------------------------------------------------
            # 1. FAILSAFE (XAVFSIZLIK TEKSHIRUVI)
            # -------------------------------------------------------------
            if not data or data.get("status") != "ok":
                # Serverdan javob kelmadi
                if (now - self.last_valid_rx_time) > FAILSAFE_TIMEOUT_SEC:
                    log.error(f"⚠️ FAILSAFE: Server bilan aloqa {FAILSAFE_TIMEOUT_SEC} soniyadan ortiq uzildi! MOTORLAR TO'XTATILDI.")
                    self.motor.stop()
                time.sleep(POLL_INTERVAL_SEC)
                continue

            is_online = data.get("is_online", False)
            age_sec = data.get("age_sec", 999.0)

            # Agar GPS qurilmasi oflayn bo'lsa yoki ma'lumot eskirgan bo'lsa
            if not is_online or age_sec > FAILSAFE_TIMEOUT_SEC:
                log.warning(f"⚠️ FAILSAFE: GPS oflayn (is_online={is_online}, age={age_sec}s). MOTOR TO'XTATILDI.")
                self.motor.stop()
                time.sleep(POLL_INTERVAL_SEC)
                continue

            # Muvaffaqiyatli ma'lumot qabul qilindi
            self.last_valid_rx_time = now

            # -------------------------------------------------------------
            # 2. KOORDINATALAR VA MAQSADNI AJRATIB OLISH
            # -------------------------------------------------------------
            robot_lat = float(data.get("lat", 0.0))
            robot_lng = float(data.get("lng", 0.0))
            fix_str = data.get("fix_str", "Noma'lum")
            hdop = data.get("hdop", 99.0)
            speed = float(data.get("speed", 0.0))

            target = data.get("target")
            if not target or "target_lat" not in target or "target_lng" not in target:
                log.info(f"⏳ Maqsad belgilanmagan. Standby rejimida kutmoqda. Fix: [{fix_str}], Lat: {robot_lat:.7f}, Lng: {robot_lng:.7f}")
                self.motor.stop()
                time.sleep(POLL_INTERVAL_SEC)
                continue

            target_lat = float(target["target_lat"])
            target_lng = float(target["target_lng"])

            # -------------------------------------------------------------
            # 3. MASOFA VA AZIMUT BURCHAGINI HISOBLASH
            # -------------------------------------------------------------
            distance_meters = calculate_haversine_distance(robot_lat, robot_lng, target_lat, target_lng)
            target_bearing = calculate_bearing(robot_lat, robot_lng, target_lat, target_lng)

            # Robot kursini yangilash
            self.update_heading_from_motion(robot_lat, robot_lng, speed)

            # Yo'nalish xatosi (-180°..+180°)
            angle_error = normalize_angle_diff(target_bearing, self.current_heading)

            log.info(
                f"📍 Masofa: {distance_meters:.2f} m | "
                f"Maqsad azimuti: {target_bearing:.1f}° | Kurs: {self.current_heading:.1f}° | "
                f"Xatolik: {angle_error:+.1f}° | Fix: [{fix_str}, HDOP: {hdop}]"
            )

            # -------------------------------------------------------------
            # 4. MOTORLARNI BOSHQARISH MANTIG'I
            # -------------------------------------------------------------
            if distance_meters <= ARRIVAL_THRESHOLD_METERS:
                log.info(f"🎉 MAQSADGA YETIB KELDIK! Masofa: {distance_meters:.2f} m <= {ARRIVAL_THRESHOLD_METERS} m. Robot to'xtadi.")
                self.motor.stop()
            else:
                # Agar masofa 0.8 metrdan katta bo'lsa:
                # Burchak xatosiga qarab burilish yoki to'g'riga yurish:
                if abs(angle_error) > 40.0:
                    # Katta burchak farqi: Robot o'z o'qi atrofida joyida burilsin
                    if angle_error > 0:
                        self.motor.send_command('R') # O'ngga burilish
                    else:
                        self.motor.send_command('L') # Chapga burilish
                elif abs(angle_error) > 12.0:
                    # O'rtacha burchak farqi: Yumshoq egri burilib oldinga yurish
                    if angle_error > 0:
                        self.motor.send_command('I') # Oldinga-o'ngga
                    else:
                        self.motor.send_command('G') # Oldinga-chapga
                else:
                    # To'g'ri yo'nalishda: To'g'riga oldinga harakatlanish
                    self.motor.send_command('F')

            # Sikl vaqtini barqaror 0.5 soniyada ushlab turish
            elapsed = time.time() - start_loop
            sleep_time = max(0.05, POLL_INTERVAL_SEC - elapsed)
            time.sleep(sleep_time)


# ---------------------------------------------------------------------------
# ASOSIY KIRISH NUQTASI
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    try:
        navigator = RtkGpsNavigator()
        navigator.run()
    except KeyboardInterrupt:
        log.info("Dastur to'xtatildi (KeyboardInterrupt). Motorlar o'chirilmoqda.")
        MotorController().stop()
        sys.exit(0)
    except Exception as e:
        log.fatal(f"Kutilmagan xatolik: {e}")
        MotorController().stop()
        sys.exit(1)
