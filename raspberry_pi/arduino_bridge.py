#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QALQON - Arduino Uno + L293D Bog'lovchi Moduli (Serial Bridge)
Platforma: Raspberry Pi 4 / Kompyuter / Telefon sinovlari.

- Arduino ulanmaganda: Xavfsiz Simulyator / Emulyator rejimida ishlaydi.
- Arduino ulanganda: 115200 baudda buyruqlar yuboradi va to'siq signallarini qabul qiladi.
"""

import os
import sys
import time
import glob
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

class ArduinoBridge:
    def __init__(self, port: str = None, baudrate: int = 115200):
        self.port = port
        self.baudrate = baudrate
        self.ser = None
        self.is_hardware = False
        self.running = True
        
        # Holat
        self.last_cmd = 'S'
        self.current_speed = 2 # 1, 2, 3
        self.obstacle_warning = False
        self.last_rx_msg = ""
        self.logs = []
        self.lock = threading.Lock()
        
        # Sonar masofalari (santimetrda)
        self.sonars = {"front": 65, "rear": 120, "left": 80, "right": 85}
        self.battery = {"voltage": 12.8, "percentage": 90, "current": 1.5, "temp": 28.2, "isCharging": False}
        
        self._init_connection()

    def _init_connection(self):
        cand_port = self.port or self._find_arduino_port()
        if cand_port and HAS_SERIAL:
            try:
                self.ser = serial.Serial(cand_port, self.baudrate, timeout=0.1)
                time.sleep(2.0) # Arduino reset kutish
                self.port = cand_port
                self.is_hardware = True
                print(f"[Arduino] [OK] Arduino Uno ulandi: {self.port} ({self.baudrate} baud)")
                threading.Thread(target=self._hardware_listen_loop, daemon=True).start()
                return
            except Exception as e:
                print(f"[Arduino] [!] Port ochilmadi: {e}. Simulyator rejimiga o'tildi.")

        # Ulanmaganda Simulyator
        self.is_hardware = False
        print("[Arduino] [*] Arduino Simulyatori FAOL (test rejimi, apparat shart emas)")
        threading.Thread(target=self._simulator_loop, daemon=True).start()

    def _find_arduino_port(self):
        env_port = os.environ.get('ARDUINO_PORT')
        if env_port:
            return env_port
        if not HAS_SERIAL:
            return None
        lidar_port = os.environ.get('LIDAR_PORT', '')
        # Linux / RPi portlari (ACM avval tekshiriladi)
        acm_ports = glob.glob('/dev/ttyACM*')
        if acm_ports:
            return acm_ports[0]
        usb_ports = [p for p in glob.glob('/dev/ttyUSB*') if p != lidar_port]
        if usb_ports:
            return usb_ports[0]
        # Windows portlari
        if list_ports:
            for p in list_ports.comports():
                if lidar_port and p.device == lidar_port:
                    continue
                desc = f"{p.description} {p.manufacturer or ''} {getattr(p, 'hwid', '')}".lower()
                if any(k in desc for k in ("arduino", "ch340", "uno", "mega", "usb-serial", "usb serial", "ftdi")):
                    return p.device
        return None

    def test_uart(self):
        available = []
        if HAS_SERIAL and list_ports:
            for p in list_ports.comports():
                available.append({"device": p.device, "description": p.description, "hwid": getattr(p, "hwid", "")})
        return {
            "mode": "HARDWARE" if self.is_hardware else "SIMULATION",
            "is_hardware": self.is_hardware,
            "port": self.port or "VIRTUAL_ARDUINO_SERIAL",
            "baudrate": self.baudrate,
            "last_cmd": self.last_cmd,
            "speed_level": self.current_speed,
            "obstacle_warning": self.obstacle_warning,
            "last_rx": self.last_rx_msg,
            "sonars": dict(self.sonars),
            "battery": dict(self.battery),
            "available_ports": available,
            "status": "ONLINE (UART ULANDI)" if self.is_hardware else "SIMULATOR (DATCHIKLAR FAOL)"
        }

    def _hardware_listen_loop(self):
        while self.running and self.ser and self.ser.is_open:
            try:
                line = self.ser.readline().decode('utf-8', errors='ignore').strip()
                if line:
                    with self.lock:
                        self.last_rx_msg = line
                        self._add_log(f"Arduino: {line}")
                        if line.startswith("SONAR:"):
                            for part in line[6:].split(','):
                                if '=' in part:
                                    k, v = part.split('=', 1)
                                    try:
                                        if k == 'F': self.sonars["front"] = int(v)
                                        elif k == 'B': self.sonars["rear"] = int(v)
                                        elif k == 'L': self.sonars["left"] = int(v)
                                        elif k == 'R': self.sonars["right"] = int(v)
                                        elif k == 'BAT': self.battery["voltage"] = float(v)
                                    except ValueError:
                                        pass
                        elif "WARN:OBSTACLE" in line:
                            self.obstacle_warning = True
                            if "FRONT" in line: self.sonars["front"] = 18
                            elif "REAR" in line: self.sonars["rear"] = 18
                        elif "ACK:" in line:
                            self.obstacle_warning = False
            except Exception:
                break
            time.sleep(0.01)

    def set_sim_obstacle(self, is_blocked: bool):
        with self.lock:
            self.obstacle_warning = is_blocked
            if is_blocked:
                self.sonars["front"] = 18
                if self.last_cmd == 'F':
                    self.last_cmd = 'S'
            else:
                self.sonars["front"] = 65

    def _simulator_loop(self):
        """Arduino bo'lmaganda datchiklar va batareya holatini realistik simulyatsiya qiladi"""
        while self.running and not self.is_hardware:
            with self.lock:
                # Datchiklar tebranishi (normal xavfsiz masofa 40..160 sm)
                df = (random.random() - 0.5) * 3
                if self.obstacle_warning:
                    self.sonars["front"] = max(15, min(22, int(self.sonars["front"] + df)))
                else:
                    self.sonars["front"] = max(40, min(160, int(self.sonars["front"] + df)))

                self.sonars["rear"] = max(25, min(250, int(self.sonars["rear"] + (random.random() - 0.5) * 3)))
                self.sonars["left"] = max(25, min(200, int(self.sonars["left"] + (random.random() - 0.5) * 3)))
                self.sonars["right"] = max(25, min(200, int(self.sonars["right"] + (random.random() - 0.5) * 3)))

                # Batareya toki va harorati
                is_moving = self.last_cmd not in ('S', 'STOP')
                self.battery["current"] = 4.2 if is_moving else 1.3
                self.battery["voltage"] = round(12.8 - (0.3 if is_moving else 0.0) + (random.random() - 0.5) * 0.05, 2)
                self.battery["temp"] = round(28.0 + (0.5 if is_moving else 0.0) + (random.random() - 0.5) * 0.1, 1)
                self.battery["isCharging"] = False

            time.sleep(0.5)

    def send_command(self, cmd: str):
        cmd = cmd.upper().strip()
        with self.lock:
            # Oldinda to'siq bo'lsa oldinga yurishni bloklash (orqaga va burilishlar OCHIQ)
            if cmd in ('F', 'G', 'I') and (self.sonars["front"] <= 25 or self.obstacle_warning):
                print(f"[Arduino] [!] Oldinda to'siq bor ({self.sonars['front']} sm)! Harakat to'xtatildi.")
                self.last_cmd = 'S'
                self._add_log(f"BLOKLANDI: Oldinda to'siq ({self.sonars['front']} sm)!")
                return False

            self.last_cmd = cmd
            self._add_log(f"Buyruq: {cmd}")

            if self.is_hardware and self.ser and self.ser.is_open:
                try:
                    self.ser.write(cmd.encode('utf-8'))
                except Exception as e:
                    print(f"[Arduino Error] Write failed: {e}")
            else:
                # Simulyatsiyada konsolga chiqaramiz
                cmd_names = {
                    'F': "Oldinga (F)", 'B': "Orqaga (B)", 'L': "Chapga burilish (L)",
                    'R': "O'ngga burilish (R)", 'Q': "Chapga Strafe (Q)", 'E': "O'ngga Strafe (E)",
                    'G': "Oldinga-Chapga Yoy (G)", 'I': "Oldinga-O'ngga Yoy (I)",
                    'H': "Orqaga-Chapga Yoy (H)", 'J': "Orqaga-O'ngga Yoy (J)",
                    'S': "To'xtash (S)", 'U': "Minora Ko'tarish (U)", 'D': "Minora Tushirish (D)"
                }
                desc = cmd_names.get(cmd, f"Buyruq {cmd}")
                print(f"[Arduino Sim] -> {desc}")

            return True

    def set_speed(self, level: int):
        level = max(1, min(3, int(level)))
        with self.lock:
            self.current_speed = level
            cmd_char = str(level)
            self._add_log(f"Tezlik darajasi: {level}")
            if self.is_hardware and self.ser and self.ser.is_open:
                try:
                    self.ser.write(cmd_char.encode('utf-8'))
                except Exception:
                    pass
            else:
                pwm_map = {1: 130, 2: 190, 3: 250}
                print(f"[Arduino Sim] -> Tezlik: {level} ({pwm_map[level]} PWM)")

    def _add_log(self, text: str):
        t_str = time.strftime("%H:%M:%S")
        self.logs.append(f"[{t_str}] {text}")
        if len(self.logs) > 40:
            self.logs.pop(0)

    def get_sonars(self):
        with self.lock:
            return dict(self.sonars)

    def get_battery(self):
        with self.lock:
            return dict(self.battery)

    def get_status(self):
        with self.lock:
            return {
                "mode": "HARDWARE" if self.is_hardware else "SIMULATION",
                "is_hardware": self.is_hardware,
                "port": self.port or "VIRTUAL_ARDUINO",
                "last_cmd": self.last_cmd,
                "speed_level": self.current_speed,
                "obstacle_warning": self.obstacle_warning,
                "last_rx": self.last_rx_msg,
                "sonars": dict(self.sonars),
                "battery": dict(self.battery)
            }

    def close(self):
        self.running = False
        if self.ser and self.ser.is_open:
            try:
                self.ser.write(b'S')
                self.ser.close()
            except Exception:
                pass


if __name__ == '__main__':
    print("Arduino ko'prigi sinovi...")
    bridge = ArduinoBridge()
    time.sleep(0.5)
    bridge.send_command('F')
    bridge.set_speed(3)
    time.sleep(0.5)
    bridge.send_command('S')
    print("Status:", bridge.get_status())
    bridge.close()
