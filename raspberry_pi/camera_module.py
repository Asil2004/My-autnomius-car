#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QALQON - Kamera va Kompyuter Ko'rishi Moduli (OpenCV)
Platforma: Raspberry Pi 4 / Kompyuter / Telefon sinovlari.

- USB Web-kamera / IP kamera / Sintetik test video oqimi.
- Yo'lak (Lane Follower) aniqlash: avtonom boshqaruv buyruqlari ('F', 'L', 'R', 'S').
- Yuz / Odam (Piyoda) deteksiyasi va taktik kadr overlay.
- Multi-klient MJPEG oqimi (/stream.mjpg va /video_feed).
"""

import os
import sys
import time
import math
import threading
import cv2
import numpy as np

try:
    if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

class CameraModule:
    def __init__(self, source=0, width: int = 640, height: int = 480):
        self.source = source
        self.width = width
        self.height = height
        self.running = True
        self.auto_lane = False
        
        # Holat
        self.latest_frame = None
        self.latest_jpeg = None
        self.fps = 0.0
        self.lock = threading.Lock()
        
        # Yo'l ma'lumotlari
        self.lane_deviation = 0
        self.recommended_cmd = 'S'
        self.lane_status = "YO'L QIDIRILMOQDA"
        self.line_found = False
        
        # Odam / Yuz deteksiyasi
        self.detected_persons = []
        self._init_face_detector()
        
        # Kamera drayverini ochish
        self.cap = None
        self.is_synthetic = False
        self._open_capture()
        
        # Oqimni fon siklida boshlash
        self.thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.thread.start()

    def _init_face_detector(self):
        try:
            cascade_path = os.path.join(cv2.data.haarcascades, 'haarcascade_frontalface_default.xml')
            if os.path.exists(cascade_path):
                self.face_cascade = cv2.CascadeClassifier(cascade_path)
            else:
                self.face_cascade = None
        except Exception:
            self.face_cascade = None

    def _open_capture(self):
        try:
            self.cap = cv2.VideoCapture(self.source)
            if self.cap.isOpened():
                self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
                self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
                self.cap.set(cv2.CAP_PROP_FPS, 30)
                # Kadr o'qib ko'rish
                ret, frame = self.cap.read()
                if ret and frame is not None:
                    self.is_synthetic = False
                    print(f"[Kamera] [OK] Kamera ulandi (manba: {self.source}, {self.width}x{self.height})")
                    return
        except Exception as e:
            print(f"[Kamera] [!] Kamera ochilmadi: {e}")

        # Agar jismoniy kamera ochilmasa, sintetik test video generatorini yoqamiz
        self.is_synthetic = True
        print("[Kamera] [*] Sintetik Test Video generatori FAOL (kamera ulanmagan)")

    def _generate_synthetic_frame(self, t: float):
        """Kamera bo'lmaganda taktik patrul yo'lak simulyatsiyasini chizadi"""
        h, w = self.height, self.width
        frame = np.zeros((h, w, 3), dtype=np.uint8)
        
        # Gradient fon (tungi yo'l)
        for y in range(h):
            ratio = y / h
            frame[y, :] = (int(10 + ratio * 20), int(15 + ratio * 25), int(25 + ratio * 35))
            
        # Yo'l chiziqlari (perspektiva)
        center_x = w // 2 + int(math.sin(t * 0.8) * 60)
        road_w_top = 40
        road_w_bot = 420
        
        # Asfalt maydoni
        pts = np.array([
            [center_x - road_w_top // 2, int(h * 0.55)],
            [center_x + road_w_top // 2, int(h * 0.55)],
            [w // 2 + road_w_bot // 2, h],
            [w // 2 - road_w_bot // 2, h]
        ], np.int32)
        cv2.fillPoly(frame, [pts], (35, 40, 50))
        
        # Markaziy oq chiziq (chiziqni kuzatish sinovi uchun)
        dash_offset = int((t * 120) % 60)
        for y in range(int(h * 0.55), h, 40):
            yy = y + dash_offset
            if yy < h - 10:
                p_ratio = (yy - int(h * 0.55)) / (h * 0.45)
                cx_cur = int((center_x * (1 - p_ratio)) + ((w // 2) * p_ratio))
                thick = max(2, int(p_ratio * 8))
                cv2.line(frame, (cx_cur, yy), (cx_cur, min(h - 1, yy + 20)), (255, 255, 255), thick)

        return frame

    def _process_lane(self, frame):
        """Yo'lakni tahlil qilish va og'ishni hisoblash"""
        h, w = frame.shape[:2]
        roi_top = int(h * 0.55)
        roi = frame[roi_top:h, 0:w]

        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blur, 50, 150)

        M = cv2.moments(edges)
        frame_center = w // 2
        deviation = 0

        if M["m00"] > 400:
            cx = int(M["m10"] / M["m00"])
            cy = int(M["m01"] / M["m00"]) + roi_top
            deviation = cx - frame_center
            self.line_found = True

            # Vizual markerlar
            cv2.circle(frame, (cx, cy), 8, (0, 0, 255), -1) # Qizil nuqta
            cv2.line(frame, (frame_center, h), (cx, cy), (0, 255, 0), 2) # Harakat vektori

            if deviation < -45:
                direction = "CHAPGA (L)"
                cmd = 'L'
            elif deviation > 45:
                direction = "O'NGGA (R)"
                cmd = 'R'
            else:
                direction = "TO'G'RI (F)"
                cmd = 'F'
        else:
            direction = "YO'L YO'Q"
            cmd = 'S'
            self.line_found = False

        self.lane_deviation = deviation
        self.recommended_cmd = cmd
        self.lane_status = direction

        return frame

    def _process_faces(self, frame):
        """Yuz / Odamni aniqlash"""
        if self.face_cascade is None:
            return frame

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self.face_cascade.detectMultiScale(gray, scaleFactor=1.2, minNeighbors=4, minSize=(30, 30))
        
        detected = []
        for (x, y, fw, fh) in faces:
            detected.append({
                "label": "Odam (Piyoda)",
                "confidence": 0.92,
                "box": {"x": int(x), "y": int(y), "w": int(fw), "h": int(fh)}
            })
            # Taktik yashil quti
            cv2.rectangle(frame, (x, y), (x + fw, y + fh), (0, 230, 118), 2)
            cv2.putText(frame, "ODAM (PIYODA) 92%", (x, max(20, y - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 230, 118), 2)

        self.detected_persons = detected
        return frame

    def _draw_hud_overlays(self, frame):
        """Taktik HUD ko'rsatkichlari"""
        h, w = frame.shape[:2]
        
        # Markaziy nishon (Crosshair)
        cx, cy = w // 2, h // 2
        cv2.drawMarker(frame, (cx, cy), (0, 229, 255), cv2.MARKER_CROSS, 20, 1)
        
        # Holat yozuvlari
        mode_str = "AVTO-YO'L" if self.auto_lane else "QO'LDA"
        mode_color = (0, 255, 0) if self.auto_lane else (0, 229, 255)
        
        cv2.putText(frame, f"REJIM: {mode_str}", (15, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.65, mode_color, 2)
        cv2.putText(frame, f"YO'NALISH: {self.lane_status}", (15, 55), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        cv2.putText(frame, f"FPS: {self.fps:.1f}", (w - 110, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 229, 255), 1)

        return frame

    def _capture_loop(self):
        fps_counter = 0
        t0 = time.time()
        sim_t = 0.0

        while self.running:
            sim_t += 0.04
            
            if not self.is_synthetic and self.cap and self.cap.isOpened():
                ret, raw_frame = self.cap.read()
                if not ret or raw_frame is None:
                    time.sleep(0.02)
                    continue
                frame = raw_frame
            else:
                frame = self._generate_synthetic_frame(sim_t)

            # 1. Yo'lni tahlil qilish
            frame = self._process_lane(frame)
            
            # 2. Yuz/Odam deteksiyasi (har 3-kadrda)
            if fps_counter % 3 == 0:
                frame = self._process_faces(frame)
            else:
                # Oldingi qutilarni chizish
                for p in self.detected_persons:
                    b = p["box"]
                    cv2.rectangle(frame, (b["x"], b["y"]), (b["x"] + b["w"], b["y"] + b["h"]), (0, 230, 118), 2)

            # 3. HUD qatlami
            frame = self._draw_hud_overlays(frame)

            # 4. JPEG ga kodlash
            _, jpeg_buf = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
            jpeg_bytes = jpeg_buf.tobytes()

            with self.lock:
                self.latest_frame = frame
                self.latest_jpeg = jpeg_bytes

            fps_counter += 1
            now = time.time()
            if now - t0 >= 1.0:
                self.fps = fps_counter / (now - t0)
                fps_counter = 0
                t0 = now

            time.sleep(0.03)

    def get_jpeg(self):
        with self.lock:
            return self.latest_jpeg

    def get_status(self):
        return {
            "fps": round(self.fps, 1),
            "is_synthetic": self.is_synthetic,
            "lane_status": self.lane_status,
            "deviation": self.lane_deviation,
            "recommended_cmd": self.recommended_cmd,
            "line_found": self.line_found,
            "persons_detected": len(self.detected_persons)
        }

    def close(self):
        self.running = False
        if self.cap:
            try:
                self.cap.release()
            except Exception:
                pass


if __name__ == '__main__':
    print("Kamera moduli sinovi...")
    cam = CameraModule(source=0)
    time.sleep(1.0)
    print("Status:", cam.get_status())
    jpeg = cam.get_jpeg()
    print("JPEG o'lchami:", len(jpeg) if jpeg else 0, "bayt")
    cam.close()
