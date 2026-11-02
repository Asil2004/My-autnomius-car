#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
QALQON ROBOT "KO'ZI" — WEBCAM AVTONOM TO'SIQ DETEKTORI VA XAVFSIZLIK NAZORATCHISI
=============================================================================
Ushbu dastur kompyuterga ulangan USB Web-Kamerani robotning asosiy "Ko'zi"
sifatida ishlatadi. Prototiplash va sinov davrida (hali apparat LiDAR/Sonarlar
tayyor bo'lmaganda) kamera orqali:
  1. Oldinda turgan to'siqlarni (odam, stul, quti, devor, qo'l va barcha jismlarni) sezadi;
  2. To'siqqacha bo'lgan masofani (sm va metrda) hisoblaydi;
  3. Xavfli masofa (< 35 sm) bo'lganda darhol AVTOTORMOZ ('S') beradi va ovozli signal chaladi;
  4. Qaysi tomondan aylanib o'tish (Chap/O'ng/Orqaga) tavsiyasini ko'rsatadi;
  5. Agar Arduino ulangan bo'lsa, avtomatik ravishda COM port orqali buyruq uzatadi.
=============================================================================
Boshqaruv tugmalari (OpenCV oynasida):
  [W] - Oldinga harakat (agar to'siq bo'lsa, qulflanadi!)
  [S] - Orqaga chekinish
  [A] - Chapga burilish
  [D] - O'ngga burilish
  [BO'SHLIQ] - To'xtash (Stop)
  [Q] yoki [ESC] - Dasturdan chiqish
=============================================================================
"""

import sys
import os
import time
import math
import glob
import threading

try:
    import cv2
    import numpy as np
except ImportError:
    print("[-] Xatolik: opencv-python yoki numpy o'rnatilmagan! (pip install opencv-python numpy)")
    sys.exit(1)

# Windows ovozli signal kutubxonasi
try:
    import winsound
    HAS_SOUND = True
except ImportError:
    HAS_SOUND = False

# Serial (Arduino) bilan ishlash
try:
    import serial
    HAS_SERIAL = True
except ImportError:
    HAS_SERIAL = False


def find_serial_port():
    if not HAS_SERIAL:
        return None
    # Linux portlari
    ports = glob.glob('/dev/ttyACM*') + glob.glob('/dev/ttyUSB*')
    if ports:
        return ports[0]
    # Windows COM portlari
    for i in range(1, 20):
        p = f"COM{i}"
        try:
            s = serial.Serial(p)
            s.close()
            return p
        except Exception:
            pass
    return None


class RobotEyeDetector:
    def __init__(self, camera_index=0):
        self.camera_index = camera_index
        self.cap = None
        self.ser = None
        self.is_connected = False
        self.last_beep_time = 0
        self.current_cmd = "S"
        self.auto_brake = False
        
        # Arduino ulanishini tekshirish
        port = find_serial_port()
        if HAS_SERIAL and port:
            try:
                self.ser = serial.Serial(port, 115200, timeout=0.1)
                time.sleep(1.5)
                self.is_connected = True
                print(f"[+] Arduino ulandi: {port} (115200 baud)")
            except Exception as e:
                print(f"[i] Arduino ulanmadi ({e}), simulyatsiya rejimida ishlaydi.")
        else:
            print("[i] Standalone Kamera Sinov Rejimi (Arduino ulanmagan, vizual boshqaruv faol).")

    def play_alert_sound(self):
        if not HAS_SOUND:
            return
        now = time.time()
        if now - self.last_beep_time > 0.35:
            self.last_beep_time = now
            threading.Thread(target=lambda: winsound.Beep(1200, 180), daemon=True).start()

    def send_robot_command(self, cmd):
        self.current_cmd = cmd
        if self.is_connected and self.ser:
            try:
                self.ser.write(cmd.encode('utf-8'))
            except Exception:
                pass
        print(f"[ROBOT BUYRUQ] -> {cmd}", end='\r')

    def start(self):
        print(f"[*] Web-Kamera ochilmoqda (Index {self.camera_index})...")
        self.cap = cv2.VideoCapture(self.camera_index, cv2.CAP_DSHOW if os.name == 'nt' else cv2.CAP_ANY)
        
        if not self.cap.isOpened():
            print(f"[-] Kamera index {self.camera_index} ochilmadi, index 1 tekshirilmoqda...")
            self.cap = cv2.VideoCapture(1)
            if not self.cap.isOpened():
                print("[-] Xatolik: Hech qanday veb-kamera topilmadi!")
                return

        # Kamera kadr o'lchamini belgilash (640x480 - optimal va tezkor)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        self.cap.set(cv2.CAP_PROP_FPS, 30)

        print("\n=======================================================")
        print("  QALQON ROBOT 'KO'ZI' ISHGA TUSHDI!")
        print("  Kamerani to'siqqa qarating yoki oldiga qo'lingizni tuting.")
        print("  Boshqarish: W (Oldinga), S (Orqaga), A (Chap), D (O'ng)")
        print("  Chiqish: [Q] yoki [ESC]")
        print("=======================================================\n")

        fps_start = time.time()
        frame_count = 0
        fps = 30.0

        bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=120, varThreshold=36, detectShadows=False)

        while True:
            ret, frame = self.cap.read()
            if not ret or frame is None:
                print("[-] Kadr o'qishda xatolik!")
                break

            frame_count += 1
            if frame_count % 15 == 0:
                now = time.time()
                fps = 15.0 / max(0.001, now - fps_start)
                fps_start = now

            h, w = frame.shape[:2]

            # -------------------------------------------------------------
            # 1. MARKAZIY XAVFSIZLIK YO'LAGI (Central Collision Corridor)
            # -------------------------------------------------------------
            # Robotning oldi x: 22% dan 78% gacha, y: 35% dan 95% gacha
            roi_x1, roi_x2 = int(w * 0.22), int(w * 0.78)
            roi_y1, roi_y2 = int(h * 0.35), int(h * 0.95)
            roi = frame[roi_y1:roi_y2, roi_x1:roi_x2]

            # Tasvirni tahlil qilish (Kulrang tus, Blur, Canny qirralar)
            gray_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
            blur_roi = cv2.GaussianBlur(gray_roi, (7, 7), 0)
            edges_roi = cv2.Canny(blur_roi, 40, 120)

            # Morfologik birlashtirish
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
            closed_edges = cv2.morphologyEx(edges_roi, cv2.MORPH_CLOSE, kernel)

            # Konturlarni topish
            contours, _ = cv2.findContours(closed_edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            detected_obstacles = []
            roi_area = (roi_x2 - roi_x1) * (roi_y2 - roi_y1)

            for cnt in contours:
                area = cv2.contourArea(cnt)
                if area > 1200:  # Faqat yetarli kattalikdagi to'siqlar
                    x, y, bw, bh = cv2.boundingRect(cnt)
                    
                    # Butun kadr koordinatasiga o'girish
                    gx = roi_x1 + x
                    gy = roi_y1 + y
                    
                    # Masofani hisoblash (fokal proporsiya bo'yicha)
                    # Bounding box balandligi qancha katta bo'lsa, to'siq shuncha yaqin
                    height_ratio = bh / float(h)
                    
                    # Masofa modeli: 15% balandlik ~= 1.5m; 50% balandlik ~= 0.40m; 80% ~= 0.20m
                    estimated_dist_m = max(0.15, min(2.5, 0.22 / max(0.08, height_ratio)))
                    dist_cm = int(estimated_dist_m * 100)

                    detected_obstacles.append({
                        'box': (gx, gy, bw, bh),
                        'dist_cm': dist_cm,
                        'dist_m': estimated_dist_m,
                        'center_x': gx + bw // 2,
                        'area': area
                    })

            # -------------------------------------------------------------
            # 2. ENG YAQIN TO'SIQ VA AVTOTORMOZ HOLATINI ANIQLASH
            # -------------------------------------------------------------
            min_dist_cm = 200  # Standart ochiq yo'l
            closest_obs = None

            if detected_obstacles:
                closest_obs = min(detected_obstacles, key=lambda o: o['dist_cm'])
                min_dist_cm = closest_obs['dist_cm']

            # Agar kamera oldiga qo'l yoki devor juda yaqin keltirilsa (kontur bo'lmasligi mumkin, lekin o'rtacha yorqinlik o'zgaradi)
            lum_mean = np.mean(gray_roi)
            lum_std = np.std(gray_roi)
            if lum_std < 18 and (lum_mean < 40 or lum_mean > 220):
                # Optik to'siq sezildi (< 20 sm)
                min_dist_cm = min(min_dist_cm, 18)
                if not closest_obs:
                    closest_obs = {
                        'box': (roi_x1, roi_y1, roi_x2 - roi_x1, roi_y2 - roi_y1),
                        'dist_cm': 18,
                        'dist_m': 0.18,
                        'center_x': w // 2,
                        'area': roi_area
                    }

            # Xavfsizlik chegaralari:
            # <= 35 sm: XAVF (Avtotormoz, oldinga harakat qulflanadi)
            # 36 - 80 sm: DIQQAT (To'siq yaqinlashmoqda)
            # > 80 sm: OCHIQ YO'L
            is_blocked = min_dist_cm <= 35
            is_warning = 35 < min_dist_cm <= 80

            if is_blocked:
                self.auto_brake = True
                self.play_alert_sound()
                if self.current_cmd == 'F':
                    self.send_robot_command('S')
            else:
                self.auto_brake = False

            # Aylanib o'tish yo'nalishi
            evasion_str = "YO'L OCHIQ"
            if is_blocked or is_warning:
                if closest_obs:
                    c_x = closest_obs['center_x']
                    if c_x < w * 0.48:
                        evasion_str = "O'NGDAN aylanib o'ting [D]"
                    elif c_x > w * 0.52:
                        evasion_str = "CHAPDAN aylanib o'ting [A]"
                    else:
                        evasion_str = "ORQAGA chekining [S]"
                else:
                    evasion_str = "ORQAGA chekining [S]"

            # -------------------------------------------------------------
            # 3. TAKTIK AR OVERLAY VA HUD GRAFIKASI
            # -------------------------------------------------------------
            overlay = frame.copy()

            # Xavfsizlik yo'lagini chizish (Trapezoid)
            pt1 = (int(w * 0.18), h)
            pt2 = (int(w * 0.82), h)
            pt3 = (int(w * 0.62), int(h * 0.50))
            pt4 = (int(w * 0.38), int(h * 0.50))
            pts = np.array([pt1, pt2, pt3, pt4], np.int32)

            if is_blocked:
                corridor_color = (0, 0, 220)  # Qizil
            elif is_warning:
                corridor_color = (0, 180, 240)  # Sariq
            else:
                corridor_color = (0, 220, 100)  # Yashil

            cv2.fillPoly(overlay, [pts], corridor_color)
            cv2.addWeighted(overlay, 0.28, frame, 0.72, 0, frame)

            # Yo'lak qirralarini chizish
            cv2.polylines(frame, [pts], True, corridor_color, 2)

            # Agar to'siq xavfli bo'lsa, oldiga qizil chiziq tortish
            if is_blocked:
                barr_y = int(h * 0.72)
                cv2.line(frame, (int(w * 0.25), barr_y), (int(w * 0.75), barr_y), (0, 0, 255), 4)

            # Aniqlangan to'siqlarga ramkalar chizish
            for obs in detected_obstacles:
                bx, by, bw, bh = obs['box']
                d_cm = obs['dist_cm']
                
                b_col = (0, 0, 255) if d_cm <= 35 else ((0, 180, 240) if d_cm <= 80 else (0, 255, 120))
                cv2.rectangle(frame, (bx, by), (bx + bw, by + bh), b_col, 2)
                
                # To'siq yorlig'i
                tag = f"TO'SIQ: {d_cm} sm"
                cv2.rectangle(frame, (bx, by - 24), (bx + len(tag) * 11, by), b_col, -1)
                cv2.putText(frame, tag, (bx + 4, by - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 2)

            # -------------------------------------------------------------
            # 4. YUQORI VA PASTKI STATUS MA'LUMOTLARI
            # -------------------------------------------------------------
            # Yuqori panel foni
            cv2.rectangle(frame, (0, 0), (w, 65), (10, 15, 25), -1)
            cv2.line(frame, (0, 65), (w, 65), (50, 70, 90), 1)

            # Masofa va Holat Matni
            if is_blocked:
                status_title = f"XAVF: OLD TO'SIQ! ({min_dist_cm} sm) — AVTOTORMOZ!"
                title_col = (0, 50, 255)
            elif is_warning:
                status_title = f"DIQQAT: TO'SIQ YAQINLASHMOQDA ({min_dist_cm} sm)"
                title_col = (0, 200, 255)
            else:
                status_title = f"YO'L OCHIQ ({min_dist_cm} sm)"
                title_col = (0, 255, 120)

            cv2.putText(frame, "👁️ ROBOT 'KO'ZI' (WEBCAM)", (16, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 230, 255), 2)
            cv2.putText(frame, status_title, (16, 52), cv2.FONT_HERSHEY_SIMPLEX, 0.72, title_col, 2)

            # FPS va Buyruq
            cmd_info = f"BUYRUQ: {self.current_cmd} | FPS: {fps:.1f}"
            cv2.putText(frame, cmd_info, (w - 220, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1)
            
            # Tavsiya
            cv2.putText(frame, f"Tavsiya: {evasion_str}", (w - 320, 52), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 1)

            # Pastki boshqaruv yordamchisi
            cv2.rectangle(frame, (0, h - 30), (w, h), (10, 15, 25), -1)
            ctrl_help = "Boshqaruv: [W]-Oldinga | [S]-Orqaga | [A]-Chap | [D]-O'ng | [SPACE]-Stop | [Q]-Chiqish"
            cv2.putText(frame, ctrl_help, (15, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180, 180, 180), 1)

            # OpenCV oynasida ko'rsatish
            cv2.imshow("QALQON ROBOT 'KO'ZI' — AVTONOM TO'SIQ DETEKTORI", frame)

            # Tugmalarni tinglash
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q') or key == 27:  # Q yoki ESC
                print("\n[*] Dastur to'xtatildi.")
                break
            elif key == ord('w') or key == ord('W'):
                if is_blocked:
                    print(f"\n[🔒 BLOK] Oldinda to'siq bor ({min_dist_cm} sm)! Oldinga harakat qulflangan!")
                    self.send_robot_command('S')
                else:
                    self.send_robot_command('F')
            elif key == ord('s') or key == ord('S'):
                self.send_robot_command('B')
            elif key == ord('a') or key == ord('A'):
                self.send_robot_command('L')
            elif key == ord('d') or key == ord('D'):
                self.send_robot_command('R')
            elif key == 32:  # Space
                self.send_robot_command('S')

        self.cap.release()
        cv2.destroyAllWindows()
        if self.ser:
            self.send_robot_command('S')
            self.ser.close()


if __name__ == '__main__':
    detector = RobotEyeDetector(camera_index=0)
    detector.start()
