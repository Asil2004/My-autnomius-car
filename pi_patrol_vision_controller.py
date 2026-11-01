#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QALQON - Raspberry Pi Web-Kamera va Arduino L293D Bog'lovchi Boshqaruv Dasturi
USB Web-Kamera orqali yo'lni ko'radi va Arduino Uno-ga buyruq uzatadi.

Qo'llab-quvvatlaydi:
 - Avtonom yo'lak bo'yicha harakat (Lane Follower)
 - Klaviaturadan qo'lda boshqarish (W/A/S/D/Q/E va bo'shliq - to'xtash)
 - Arduino-dagi to'siq datchiklari bilan xavfsiz integratsiya
"""

import os
import sys
import time
import glob
import threading

try:
    import cv2
    import numpy as np
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False

try:
    import serial
    HAS_SERIAL = True
except ImportError:
    HAS_SERIAL = False

# Serial portni avtomatik topish
def find_arduino_port():
    if not HAS_SERIAL:
        return None
    
    # Linux / Raspberry Pi portlari
    ports = glob.glob('/dev/ttyACM*') + glob.glob('/dev/ttyUSB*')
    if ports:
        return ports[0]
    
    # Windows portlari
    for i in range(1, 20):
        port_name = f"COM{i}"
        try:
            s = serial.Serial(port_name)
            s.close()
            return port_name
        except:
            pass
    return None

class RobotBridge:
    def __init__(self, port=None, baudrate=115200):
        self.ser = None
        self.port = port or find_arduino_port()
        self.baudrate = baudrate
        self.is_connected = False
        self.last_sent_cmd = None
        self.obstacle_warning = False

        if HAS_SERIAL and self.port:
            try:
                self.ser = serial.Serial(self.port, self.baudrate, timeout=0.1)
                time.sleep(2.0) # Arduino yuklanishini kutish
                self.is_connected = True
                print(f"[+] Arduino ulandi: {self.port} ({self.baudrate} baud)")
                
                # Arduino javoblarini o'qish oqimi
                self.read_thread = threading.Thread(target=self._listen_arduino, daemon=True)
                self.read_thread.start()
            except Exception as e:
                print(f"[-] Arduino ulanishda xatolik: {e}")
        else:
            print("[i] Test rejimi (Arduino ulanmagan, simulyatsiya ishlamoqda)")

    def _listen_arduino(self):
        while self.is_connected and self.ser:
            try:
                line = self.ser.readline().decode('utf-8', errors='ignore').strip()
                if line:
                    if "WARN:OBSTACLE" in line:
                        self.obstacle_warning = True
                        print(f"\n[⚠️ XAVF] Arduino to'siqni aniqladi va to'xtadi! ({line})")
                    else:
                        print(f" [Arduino] {line}", end='\r')
            except:
                break

    def send_command(self, cmd):
        if cmd == self.last_sent_cmd and cmd != 'S':
            return # Takroriy buyruqni qayta jo'natmaslik
        
        self.last_sent_cmd = cmd
        if self.is_connected and self.ser:
            try:
                self.ser.write(cmd.encode('utf-8'))
            except Exception as e:
                print(f"[-] Xatolik: {e}")
        else:
            print(f"[Simulyator Buyrug'i] -> {cmd}")

    def close(self):
        self.send_command('S')
        if self.ser:
            self.ser.close()


def process_lane_frame(frame):
    """
    Kamera kadrida yo'lak yoki chiziqni topib, burilish burchagini hisoblash
    """
    height, width = frame.shape[:2]
    # Pastki qismga e'tibor qaratish (yo'l yuzasi)
    roi_top = int(height * 0.55)
    roi = frame[roi_top:height, 0:width]

    # Kulrang tusga o'tkazish va xiralashtirish
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)

    # Ostonaviy filtrlash (Canny yoki Otsu)
    edges = cv2.Canny(blur, 50, 150)

    # Yo'l markazini aniqlash uchun massalar markazi (Moments)
    M = cv2.moments(edges)
    frame_center = width // 2

    steer_direction = 'F'
    deviation = 0

    if M["m00"] > 0:
        cx = int(M["m10"] / M["m00"])
        cy = int(M["m01"] / M["m00"]) + roi_top
        deviation = cx - frame_center

        # Vizual nuqta chizish
        cv2.circle(frame, (cx, cy), 8, (0, 0, 255), -1)
        cv2.line(frame, (frame_center, height), (cx, cy), (0, 255, 0), 2)

        # Cheklash ostonasi (deadzone: 40 piksel)
        if deviation < -45:
            steer_direction = 'L' # Chapga burilish kerak
        elif deviation > 45:
            steer_direction = 'R' # O'ngga burilish kerak
        else:
            steer_direction = 'F' # To'g'ri olg'a
    else:
        # Chiziq topilmasa ehtiyotkorlik bilan to'xtab turish
        steer_direction = 'S'

    # Ma'lumotlarni kadrga yozish
    cv2.line(frame, (frame_center, 0), (frame_center, height), (255, 0, 0), 1)
    status_text = f"BUYRUQ: {steer_direction} | Xatolik: {deviation}px"
    cv2.putText(frame, status_text, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)

    return frame, steer_direction


def main():
    print("=" * 60)
    print("  QALQON - RASPBERRY PI & ARDUINO L293D SINOV PLATFORMASI")
    print("=" * 60)
    print("Boshqaruv tugmalari:")
    print("  [W] Oldinga       [S] Orqaga       [A] Chapga     [D] O'ngga")
    print("  [Q] Chapga yon    [E] O'ngga yon   [SPACE] To'xtash")
    print("  [M] Avtonom kamera rejimiga o'tish")
    print("  [ESC] Dasturdan chiqish")
    print("-" * 60)

    robot = RobotBridge()

    if not HAS_CV2:
        print("[-] Diqqat: OpenCV (cv2) topilmadi. 'pip install opencv-python' o'rnating.")
        print("[+] Faqat klaviatura orqali test rejimida ishlaydi.")
        
        try:
            while True:
                key = input("Buyruq kiriting (w, a, s, d, q, e, space, exit): ").strip().lower()
                if key == 'w': robot.send_command('F')
                elif key == 's': robot.send_command('B')
                elif key == 'a': robot.send_command('L')
                elif key == 'd': robot.send_command('R')
                elif key == 'q': robot.send_command('Q')
                elif key == 'e': robot.send_command('E')
                elif key == ' ' or key == 'space': robot.send_command('S')
                elif key == 'exit': break
        except KeyboardInterrupt:
            pass
        finally:
            robot.close()
            return

    # Web-kamerani ochish (0 - asosiy USB kamera)
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    if not cap.isOpened():
        print("[-] Web-kamera ochilmadi! Iltimos, USB kamerani tekshiring.")
        return

    mode = "MANUAL" # MANUAL yoki AUTO_CAMERA
    print(f"\n[+] Kamera muvaffaqiyatli ishga tushdi. Joriy rejim: {mode}")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            cmd = 'S'
            if mode == "AUTO_CAMERA":
                processed_frame, cmd = process_lane_frame(frame)
                robot.send_command(cmd)
                display_frame = processed_frame
            else:
                display_frame = frame
                cv2.putText(display_frame, "QO'LDA BOSHQARISH (W,A,S,D,Q,E)", (20, 40), 
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

            cv2.imshow("QALQON - Web-Kamera Nazorati", display_frame)

            key = cv2.waitKey(20) & 0xFF
            if key == 27: # ESC
                break
            elif key == ord('m') or key == ord('M'):
                mode = "AUTO_CAMERA" if mode == "MANUAL" else "MANUAL"
                robot.send_command('S')
                print(f"\n[🔄 Rejim o'zgardi]: {mode}")
            elif mode == "MANUAL":
                if key == ord('w') or key == ord('W'):
                    robot.send_command('F')
                elif key == ord('s') or key == ord('S'):
                    robot.send_command('B')
                elif key == ord('a') or key == ord('A'):
                    robot.send_command('L')
                elif key == ord('d') or key == ord('D'):
                    robot.send_command('R')
                elif key == ord('q') or key == ord('Q'):
                    robot.send_command('Q')
                elif key == ord('e') or key == ord('E'):
                    robot.send_command('E')
                elif key == 32: # SPACE
                    robot.send_command('S')

    except KeyboardInterrupt:
        pass
    finally:
        robot.close()
        cap.release()
        cv2.destroyAllWindows()
        print("\n[+] Tizim xavfsiz to'xtatildi.")

if __name__ == '__main__':
    main()
