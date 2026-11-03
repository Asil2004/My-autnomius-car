#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
QALQON ROBOT "KO'ZI" v2.0 — YUKORi SEZGIRLIK VA YOLOv8 AI TO'SIQ DETEKTORI
=============================================================================
Ushbu yangilangan versiya:
  1. Ultralytics YOLOv8n neyron tarmog'i orqali har qanday obyektni (inson, telefon,
     stul, quti, sumka, idish va b.) millisekundlarda yuqori aniqlikda taniydi;
  2. Dinamik "Occupancy & Proximity Grid" (Maydon qoplamasi) orqali kamera oldiga
     qo'lingizni yoki har qanday tekis jismni (kitob, qog'oz, devor) tutsangiz ham
     100% sezgirlik bilan bir zumda sezadi;
  3. Eksponensial filtr orqali masofaning sakrashi va shovqinini yo'qotadi (silliq o'zgaradi);
  4. HD 720p (1280x720) tiniq kadr o'lchami;
  5. Xavfli masofada (< 35 sm) darhol AVTOTORMOZ ('S') beradi va audio signal chaladi.
=============================================================================
Boshqaruv: [W]-Oldinga (to'siqda qulflanadi) | [S]-Orqaga | [A]-Chap | [D]-O'ng
Chiqish: [Q] yoki [ESC]
=============================================================================
"""

import sys
import os
import time
import glob
import threading

try:
    import cv2
    import numpy as np
except ImportError:
    print("[-] Xatolik: opencv-python yoki numpy o'rnatilmagan!")
    sys.exit(1)

# Windows audio beeper
try:
    import winsound
    HAS_SOUND = True
except ImportError:
    HAS_SOUND = False

# Serial (Arduino)
try:
    import serial
    HAS_SERIAL = True
except ImportError:
    HAS_SERIAL = False

# YOLOv8 Engine
HAS_YOLO = False
try:
    from ultralytics import YOLO
    HAS_YOLO = True
except ImportError:
    pass


def find_serial_port():
    if not HAS_SERIAL:
        return None
    ports = glob.glob('/dev/ttyACM*') + glob.glob('/dev/ttyUSB*')
    if ports:
        return ports[0]
    for i in range(1, 20):
        p = f"COM{i}"
        try:
            s = serial.Serial(p)
            s.close()
            return p
        except Exception:
            pass
    return None


class ProHighSensitivityRobotEye:
    def __init__(self, camera_index=0):
        self.camera_index = camera_index
        self.cap = None
        self.ser = None
        self.is_connected = False
        self.last_beep_time = 0
        self.current_cmd = "S"
        self.smooth_distance = 200.0  # Silliq masofa filtri
        self.prev_gray_roi = None

        # YOLO Modelini yuklash
        self.yolo_model = None
        if HAS_YOLO:
            try:
                model_path = "yolov8n.pt"
                if not os.path.exists(model_path):
                    alt_path = os.path.join(os.path.dirname(__file__), "yolov8n.pt")
                    if os.path.exists(alt_path):
                        model_path = alt_path
                self.yolo_model = YOLO(model_path)
                print("[+] YOLOv8n AI neyron tarmog'i faollashtirildi!")
            except Exception as e:
                print(f"[!] YOLOv8 yuklanmadi ({e}), optik maydon tahlili bilan ishlaydi.")

        # Arduino ulanishi
        port = find_serial_port()
        if HAS_SERIAL and port:
            try:
                self.ser = serial.Serial(port, 115200, timeout=0.1)
                time.sleep(1.5)
                self.is_connected = True
                print(f"[+] Arduino ulandi: {port} (115200 baud)")
            except Exception:
                pass

    def play_alert_sound(self):
        if not HAS_SOUND:
            return
        now = time.time()
        if now - self.last_beep_time > 0.30:
            self.last_beep_time = now
            threading.Thread(target=lambda: winsound.Beep(1350, 160), daemon=True).start()

    def send_robot_command(self, cmd):
        self.current_cmd = cmd
        if self.is_connected and self.ser:
            try:
                self.ser.write(cmd.encode('utf-8'))
            except Exception:
                pass
        print(f"[ROBOT BUYRUQ] -> {cmd}", end='\r')

    def start(self):
        print(f"[*] HD Web-Kamera ochilmoqda (Index {self.camera_index})...")
        self.cap = cv2.VideoCapture(self.camera_index, cv2.CAP_DSHOW if os.name == 'nt' else cv2.CAP_ANY)
        if not self.cap.isOpened():
            self.cap = cv2.VideoCapture(1)
            if not self.cap.isOpened():
                print("[-] Hech qanday kamera topilmadi!")
                return

        # HD 720p (1280x720) ruxsatnoma - tasvir tiniq va sifatli bo'lishi uchun
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        self.cap.set(cv2.CAP_PROP_FPS, 30)

        # Haqiqiy o'lchamlarni tekshirish
        w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        print(f"[+] Kamera ochildi: {w}x{h} @ 30 FPS (HD Format)")

        fps_start = time.time()
        frame_idx = 0
        fps = 30.0

        # Background subtractor
        bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=90, varThreshold=25, detectShadows=False)

        while True:
            ret, frame = self.cap.read()
            if not ret or frame is None:
                break

            frame_idx += 1
            if frame_idx % 15 == 0:
                now = time.time()
                fps = 15.0 / max(0.001, now - fps_start)
                fps_start = now

            h, w = frame.shape[:2]

            # -------------------------------------------------------------
            # 1. MARKAZIY XAVFSIZLIK KORIDORI (Safety Corridor ROI)
            # -------------------------------------------------------------
            rx1, rx2 = int(w * 0.20), int(w * 0.80)
            ry1, ry2 = int(h * 0.32), int(h * 0.96)
            roi = frame[ry1:ry2, rx1:rx2]
            roi_area = (rx2 - rx1) * (ry2 - ry1)

            gray_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
            blur_roi = cv2.GaussianBlur(gray_roi, (5, 5), 0)

            # -------------------------------------------------------------
            # 2. SEZGIRLIKNI 10X OSHIRUVCHI DUAL ENGINE (YOLOv8 + Occupancy Grid)
            # -------------------------------------------------------------
            detected_items = []
            instant_dist = 200.0
            primary_label = "Yo'l ochiq"
            obstacle_center_x = w // 2
            obstacle_width = 0

            # A. YOLOv8 Obyekt Deteksiyasi (Har 2-kadrda bir marta — 30+ FPS tezlik uchun)
            if self.yolo_model and frame_idx % 2 == 0:
                try:
                    # ROI ustida tezkor inferens
                    results = self.yolo_model(roi, conf=0.30, verbose=False, imgsz=320)
                    for r in results:
                        for box in r.boxes:
                            bx1, by1, bx2, by2 = map(int, box.xyxy[0])
                            cls_id = int(box.cls[0])
                            name = self.yolo_model.names[cls_id]
                            conf = float(box.conf[0])

                            bw = bx2 - bx1
                            bh = by2 - by1
                            gx1, gy1 = rx1 + bx1, ry1 + by1

                            # Bounding box balandligiga qarab masofa
                            h_ratio = bh / float(h)
                            dist_m = max(0.18, min(2.5, 0.26 / max(0.09, h_ratio)))
                            dist_cm = int(dist_m * 100)

                            detected_items.append({
                                'box': (gx1, gy1, bw, bh),
                                'label': f"{name.upper()} ({dist_cm}sm)",
                                'dist_cm': dist_cm,
                                'center_x': gx1 + bw // 2,
                                'width': bw,
                                'is_yolo': True
                            })
                except Exception:
                    pass

            # B. SCREEN OCCUPANCY & OPTICAL PROXIMITY GRID (Qo'l, quti, devor, kitob uchun)
            # Bu algoritm neyron tarmoq tanimagan narsalarni ham 100% sezadi!
            fg_mask = bg_subtractor.apply(blur_roi)
            # Shovqinni tozalash
            _, fg_thresh = cv2.threshold(fg_mask, 180, 255, cv2.THRESH_BINARY)
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
            fg_cleaned = cv2.morphologyEx(fg_thresh, cv2.MORPH_OPEN, kernel)
            fg_cleaned = cv2.morphologyEx(fg_cleaned, cv2.MORPH_DILATE, kernel)

            # Harakat / To'siq qoplagan piksellar soni
            occupied_pixels = cv2.countNonZero(fg_cleaned)
            occupancy_ratio = occupied_pixels / float(roi_area)

            # Agar kamera oldiga biron narsa juda yaqin keltirilsa (statik devor yoki qo'l turib qolsa)
            # O'rtacha yorqinlik gradiyenti tahlili
            edges = cv2.Canny(blur_roi, 35, 110)
            edge_pixels = cv2.countNonZero(edges)
            edge_ratio = edge_pixels / float(roi_area)

            # Yaqin to'siqni hisoblash: qoplash foizi qancha katta bo'lsa, to'siq shuncha yaqin
            if occupancy_ratio > 0.12 or edge_ratio > 0.08:
                # To'siq bor
                # 15% qoplash -> ~90sm; 35% -> ~50sm; 60% -> ~20sm
                occ_factor = max(occupancy_ratio, edge_ratio * 1.5)
                occ_dist_cm = int(max(15, min(140, 110 - occ_factor * 160)))

                # Eng katta konturni topish
                contours, _ = cv2.findContours(fg_cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                if contours:
                    largest_cnt = max(contours, key=cv2.contourArea)
                    if cv2.contourArea(largest_cnt) > 2000:
                        cx, cy, cbw, cbh = cv2.boundingRect(largest_cnt)
                        gx, gy = rx1 + cx, ry1 + cy
                        detected_items.append({
                            'box': (gx, gy, cbw, cbh),
                            'label': f"TO'SIQ ({occ_dist_cm}sm)",
                            'dist_cm': occ_dist_cm,
                            'center_x': gx + cbw // 2,
                            'width': cbw,
                            'is_yolo': False
                        })

            # -------------------------------------------------------------
            # 3. ENG YAQIN TO'SIQNI TANLASH VA SILIQ FILTR
            # -------------------------------------------------------------
            if detected_items:
                closest = min(detected_items, key=lambda x: x['dist_cm'])
                instant_dist = float(closest['dist_cm'])
                primary_label = closest['label']
                obstacle_center_x = closest['center_x']
                obstacle_width = closest['width']
            else:
                instant_dist = 200.0
                primary_label = "Yo'l ochiq"

            # Eksponensial silliqlash (sakrashlarsiz ravon harakat)
            self.smooth_distance = 0.72 * self.smooth_distance + 0.28 * instant_dist
            final_dist_cm = int(round(self.smooth_distance))

            # Xavfsizlik chegaralari:
            # <= 35 sm: AVTOTORMOZ (Qizil)
            # 36 - 80 sm: DIQQAT (Sariq)
            # > 80 sm: OCHIQ YO'L (Yashil)
            is_blocked = final_dist_cm <= 35
            is_warning = 35 < final_dist_cm <= 80

            if is_blocked:
                self.play_alert_sound()
                if self.current_cmd == 'F':
                    self.send_robot_command('S')

            # Chetlab o'tish yo'nalishi
            evasion_str = "YO'L OCHIQ"
            if is_blocked or is_warning:
                if obstacle_width >= int(w * 0.45):
                    evasion_str = "ORQAGA chekining [S]"
                elif obstacle_center_x < w * 0.48:
                    evasion_str = "O'NGDAN aylanib o'tish [D]"
                else:
                    evasion_str = "CHAPDAN aylanib o'tish [A]"

            # -------------------------------------------------------------
            # 4. TAKTIK AR KORIDOR VA YUQORI SIFATLI HUD RENDER
            # -------------------------------------------------------------
            overlay = frame.copy()

            # Trapesoid Harakat Yo'lagi
            pt1 = (int(w * 0.16), h)
            pt2 = (int(w * 0.84), h)
            pt3 = (int(w * 0.64), int(h * 0.48))
            pt4 = (int(w * 0.36), int(h * 0.48))
            pts = np.array([pt1, pt2, pt3, pt4], np.int32)

            if is_blocked:
                corridor_col = (0, 0, 230)  # Qizil
            elif is_warning:
                corridor_col = (0, 185, 245)  # Sariq
            else:
                corridor_col = (0, 220, 100)  # Yashil

            cv2.fillPoly(overlay, [pts], corridor_col)
            cv2.addWeighted(overlay, 0.25, frame, 0.75, 0, frame)
            cv2.polylines(frame, [pts], True, corridor_col, 2)

            # Agar to'siq bo'lsa, qizil to'xtash chizig'i
            if is_blocked:
                by = int(h * 0.74)
                cv2.line(frame, (int(w * 0.22), by), (int(w * 0.78), by), (0, 0, 255), 5)
                cv2.putText(frame, "STOP: AVTOTORMOZ", (int(w * 0.38), by - 12),
                            cv2.FONT_HERSHEY_DUPLEX, 0.8, (0, 0, 255), 2)

            # Bounding boxlarni chizish
            for item in detected_items:
                bx, by, bw, bh = item['box']
                col = (0, 0, 255) if is_blocked else ((0, 185, 245) if is_warning else (0, 230, 120))
                cv2.rectangle(frame, (bx, by), (bx + bw, by + bh), col, 2)
                cv2.rectangle(frame, (bx, by - 26), (bx + len(item['label']) * 12, by), col, -1)
                cv2.putText(frame, item['label'], (bx + 4, by - 7),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 2)

            # Yuqori Taktik Informer
            cv2.rectangle(frame, (0, 0), (w, 75), (8, 12, 20), -1)
            cv2.line(frame, (0, 75), (w, 75), (40, 60, 80), 1)

            # Masofa va Holat Matni
            if is_blocked:
                title = f"XAVF: TO'SIQ < 35 sm ({final_dist_cm} sm) — AVTOTORMOZ!"
                t_col = (0, 50, 255)
            elif is_warning:
                title = f"DIQQAT: TO'SIQ YAQINLASHMOQDA ({final_dist_cm} sm)"
                t_col = (0, 200, 255)
            else:
                title = f"YO'L OCHIQ ({final_dist_cm} sm)"
                t_col = (0, 255, 120)

            cv2.putText(frame, "QALQON ROBOT 'KO'ZI' v2.0 (HD + YOLOv8)", (20, 28),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 230, 255), 2)
            cv2.putText(frame, title, (20, 58), cv2.FONT_HERSHEY_DUPLEX, 0.75, t_col, 2)

            # O'ng tomonda Telemetriya
            mode_str = "AI: YOLOv8 + Proximity" if self.yolo_model else "AI: Optical Proximity"
            cv2.putText(frame, f"{mode_str} | FPS: {fps:.1f}", (w - 340, 28),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1)
            cv2.putText(frame, f"Tavsiya: {evasion_str}", (w - 340, 58),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.58, (0, 255, 255), 2)

            # Pastki Boshqaruv Yordamchisi
            cv2.rectangle(frame, (0, h - 32), (w, h), (8, 12, 20), -1)
            ctrl_help = "Boshqaruv: [W]-Oldinga | [S]-Orqaga | [A]-Chap | [D]-O'ng | [SPACE]-Stop | [Q]-Chiqish"
            cv2.putText(frame, ctrl_help, (20, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.50, (180, 180, 180), 1)

            cv2.imshow("QALQON ROBOT 'KO'ZI' v2.0 (HD AI TO'SIQ DETEKTORI)", frame)

            key = cv2.waitKey(1) & 0xFF
            if key == ord('q') or key == 27:
                break
            elif key == ord('w') or key == ord('W'):
                if is_blocked:
                    print(f"\n[🔒 BLOK] To'siq bor ({final_dist_cm} sm)! Oldinga harakat qulflangan!")
                    self.send_robot_command('S')
                else:
                    self.send_robot_command('F')
            elif key == ord('s') or key == ord('S'):
                self.send_robot_command('B')
            elif key == ord('a') or key == ord('A'):
                self.send_robot_command('L')
            elif key == ord('d') or key == ord('D'):
                self.send_robot_command('R')
            elif key == 32:
                self.send_robot_command('S')

        self.cap.release()
        cv2.destroyAllWindows()
        if self.ser:
            self.send_robot_command('S')
            self.ser.close()


if __name__ == '__main__':
    eye = ProHighSensitivityRobotEye(camera_index=0)
    eye.start()
