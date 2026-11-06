#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QALQON - Kamera va Ko'p Kamerali Kompyuter Ko'rishi Moduli (OpenCV / Multi-Camera)
Platforma: Raspberry Pi 4 / Kompyuter / Telefon sinovlari.

- Barcha USB Web-kameralar (Oldi, 360 PTZ Gumbaz, Orqa) boshqaruvi.
- Yo'lak (Lane Follower) aniqlash: avtonom boshqaruv buyruqlari ('F', 'L', 'R', 'S').
- Yuz / Odam (Piyoda) deteksiyasi va taktik kadr overlay.
- Multi-klient MJPEG oqimi (/stream.mjpg, /video_feed va /video_feed/{cam_id}).
- Kamera yoki OpenCV bo'lmaganda xavfsiz Sintetik Patrul Simulyatsiyasi.
"""

import os
import sys
import time
import math
import glob
import threading

try:
    if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:
    cv2 = None
    np = None
    HAS_OPENCV = False


class CameraModule:
    """Yagona kamera manbasini (USB/V4L2/Sintetik) boshqarish klassi"""
    def __init__(self, source=0, width: int = 640, height: int = 480, name: str = "Kamera"):
        self.source = source
        self.name = name
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
        self.latest_alert = None
        self.face_cascade = None
        if HAS_OPENCV:
            self._init_face_detector()
        
        # Kamera drayverini ochish
        self.cap = None
        self.is_synthetic = False
        self._open_capture()
        
        # Oqimni fon siklida boshlash
        self.thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.thread.start()

    def _init_face_detector(self):
        if not HAS_OPENCV or cv2 is None:
            return
        try:
            cascade_path = os.path.join(cv2.data.haarcascades, 'haarcascade_frontalface_default.xml')
            if os.path.exists(cascade_path):
                self.face_cascade = cv2.CascadeClassifier(cascade_path)
            else:
                self.face_cascade = None
        except Exception:
            self.face_cascade = None

    def _open_capture(self):
        if not HAS_OPENCV or cv2 is None:
            self.is_synthetic = True
            print(f"[Kamera #{self.source}] [*] OpenCV yo'q - Sintetik Test Video generatori faollashtirildi.")
            return

        try:
            # DirectShow (Windows) yoki V4L2 (Linux) orqali ochish
            if sys.platform.startswith('win'):
                self.cap = cv2.VideoCapture(self.source, cv2.CAP_DSHOW)
                if not self.cap.isOpened():
                    self.cap = cv2.VideoCapture(self.source)
            else:
                self.cap = cv2.VideoCapture(self.source)

            if self.cap and self.cap.isOpened():
                self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
                self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
                self.cap.set(cv2.CAP_PROP_FPS, 30)
                ret, frame = self.cap.read()
                if ret and frame is not None:
                    self.is_synthetic = False
                    print(f"[Kamera #{self.source}] [OK] Apparat kamera ulandi: '{self.name}' ({self.width}x{self.height})")
                    return
        except Exception as e:
            print(f"[Kamera #{self.source}] [!] Ochishda xatolik: {e}")

        self.is_synthetic = True
        print(f"[Kamera #{self.source}] [*] '{self.name}' uchun Sintetik Test Video FAOL.")

    def _generate_synthetic_frame(self, t: float):
        """Kamera bo'lmaganda taktik patrul yo'lak simulyatsiyasini chizadi"""
        h, w = self.height, self.width
        if not HAS_OPENCV or np is None:
            return None

        frame = np.zeros((h, w, 3), dtype=np.uint8)
        for y in range(h):
            ratio = y / h
            frame[y, :] = (int(10 + ratio * 20), int(15 + ratio * 25), int(25 + ratio * 35))
            
        center_x = w // 2 + int(math.sin(t * 0.8) * 60)
        road_w_top = 40
        road_w_bot = 420
        
        pts = np.array([
            [center_x - road_w_top // 2, int(h * 0.55)],
            [center_x + road_w_top // 2, int(h * 0.55)],
            [w // 2 + road_w_bot // 2, h],
            [w // 2 - road_w_bot // 2, h]
        ], np.int32)
        cv2.fillPoly(frame, [pts], (35, 40, 50))
        
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
        if not HAS_OPENCV or cv2 is None or frame is None:
            return frame
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

            cv2.circle(frame, (cx, cy), 8, (0, 0, 255), -1)
            cv2.line(frame, (frame_center, h), (cx, cy), (0, 255, 0), 2)

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
        if not HAS_OPENCV or cv2 is None or self.face_cascade is None or frame is None:
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
            cv2.rectangle(frame, (x, y), (x + fw, y + fh), (0, 230, 118), 2)
            cv2.putText(frame, "ODAM (PIYODA) 92%", (x, max(20, y - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 230, 118), 2)

        self.detected_persons = detected
        return frame

    def _draw_hud_overlays(self, frame):
        if not HAS_OPENCV or cv2 is None or frame is None:
            return frame
        h, w = frame.shape[:2]
        cx, cy = w // 2, h // 2
        cv2.drawMarker(frame, (cx, cy), (0, 229, 255), cv2.MARKER_CROSS, 20, 1)
        
        mode_str = "AVTO-YO'L" if self.auto_lane else "QO'LDA"
        mode_color = (0, 255, 0) if self.auto_lane else (0, 229, 255)
        
        cam_label = f"[{self.source}] {self.name.upper()}"
        cv2.putText(frame, cam_label, (15, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 2)
        cv2.putText(frame, f"REJIM: {mode_str}", (15, 48), cv2.FONT_HERSHEY_SIMPLEX, 0.55, mode_color, 2)
        cv2.putText(frame, f"FPS: {self.fps:.1f}", (w - 110, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 229, 255), 1)
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

            if frame is not None and HAS_OPENCV:
                frame = self._process_lane(frame)
                if fps_counter % 3 == 0:
                    frame = self._process_faces(frame)
                else:
                    for p in self.detected_persons:
                        b = p["box"]
                        cv2.rectangle(frame, (b["x"], b["y"]), (b["x"] + b["w"], b["y"] + b["h"]), (0, 230, 118), 2)
                frame = self._draw_hud_overlays(frame)
                _, jpeg_buf = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
                jpeg_bytes = jpeg_buf.tobytes()
            else:
                jpeg_bytes = b""

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

    def get_quad_jpeg(self) -> bytes:
        """4 ta kameraning (Oldi, Orqa, Chap, O'ng) 2x2 shakldagi birlashgan 360° ko'rinishi"""
        if not HAS_OPENCV or cv2 is None or np is None:
            return self.get_jpeg()

        frames = []
        half_w, half_h = self.width // 2, self.height // 2

        with self.lock:
            for idx in range(4):
                if idx not in self.cameras:
                    name = self.CAMERA_NAMES.get(idx, f"Kamera #{idx}")
                    self.cameras[idx] = CameraModule(source=idx, width=self.width, height=self.height, name=name)
                
                f = self.cameras[idx].latest_frame
                if f is None:
                    f = self.cameras[idx]._generate_synthetic_frame(time.time())
                
                if f is not None:
                    small = cv2.resize(f, (half_w, half_h))
                else:
                    small = np.zeros((half_h, half_w, 3), dtype=np.uint8)
                
                # Sarlavha yozish
                title = self.CAMERA_NAMES.get(idx, f"CAM {idx}").split('(')[0].strip().upper()
                cv2.putText(small, title, (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
                frames.append(small)

        # 2x2 matrisa:
        # [0: Oldi] [1: Orqa]
        # [2: Chap] [3: O'ng]
        top_row = np.hstack([frames[0], frames[1]])
        bot_row = np.hstack([frames[2], frames[3]])
        quad = np.vstack([top_row, bot_row])

        # Taktik ajratuvchi chiziqlar
        cv2.line(quad, (half_w, 0), (half_w, self.height), (0, 200, 255), 1)
        cv2.line(quad, (0, half_h), (self.width, half_h), (0, 200, 255), 1)

        _, jpeg_buf = cv2.imencode('.jpg', quad, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
        return jpeg_buf.tobytes()

    def dispatch_alert_to_iib(self, reason: str = "Xavfli vaziyat aniqlandi"):
        if not HAS_OPENCV or cv2 is None:
            return None
        with self.lock:
            if self.latest_frame is None:
                return None
            alert_img = self.latest_frame.copy()

        h, w = alert_img.shape[:2]
        cv2.rectangle(alert_img, (0, 0), (w, 55), (0, 0, 180), -1)
        cv2.putText(alert_img, "NAVOIY VILOYATI IIB - TEZKOR XABAR", (15, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)
        cv2.putText(alert_img, f"SABAB: {reason} | VAQT: {time.strftime('%H:%M:%S')}", (15, 48), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)

        _, jpeg_buf = cv2.imencode('.jpg', alert_img, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        self.latest_alert = {
            "timestamp": time.time(),
            "time_str": time.strftime('%Y-%m-%d %H:%M:%S'),
            "reason": reason,
            "persons_count": len(self.detected_persons),
            "jpeg": jpeg_buf.tobytes()
        }
        return self.latest_alert

    def get_latest_alert_jpeg(self):
        if hasattr(self, 'latest_alert') and self.latest_alert:
            return self.latest_alert.get("jpeg")
        return self.get_jpeg()

    def get_status(self):
        return {
            "source": self.source,
            "name": self.name,
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


class MultiCameraManager:
    """
    QALQON - Ko'p kamerali tizim boshqaruvchisi.
    Robotdagi barcha USB web kameralar (0: Oldi, 1: 360 PTZ Gumbaz, 2: Orqa) ni boshqaradi.
    Kamera mavjud bo'lmaganda avtomatik sintetik test oqimini beradi.
    """
    CAMERA_NAMES = {
        0: "Oldi Kamera (Front)",
        1: "Orqa Kamera (Rear)",
        2: "Chap Yon Kamera (Left)",
        3: "O'ng Yon Kamera (Right)"
    }

    def __init__(self, default_source: int = 0, width: int = 640, height: int = 480):
        self.active_source = default_source
        self.width = width
        self.height = height
        self.running = True
        self.cameras: dict[int, CameraModule] = {}
        self.lock = threading.Lock()
        
        # Tizimda mavjud kameralarni aniqlash
        self.available_cams = self.scan_available_cameras()
        
        # Asosiy kamerani ishga tushirish
        main_name = self.CAMERA_NAMES.get(default_source, f"Kamera #{default_source}")
        self.main_camera = CameraModule(source=default_source, width=width, height=height, name=main_name)
        self.cameras[default_source] = self.main_camera

    @property
    def latest_frame(self):
        cam = self.cameras.get(self.active_source, self.main_camera)
        return cam.latest_frame

    @property
    def detected_persons(self):
        cam = self.cameras.get(self.active_source, self.main_camera)
        return cam.detected_persons

    @property
    def auto_lane(self):
        return self.main_camera.auto_lane

    @auto_lane.setter
    def auto_lane(self, val: bool):
        self.main_camera.auto_lane = val

    @property
    def is_synthetic(self):
        cam = self.cameras.get(self.active_source, self.main_camera)
        return cam.is_synthetic

    def scan_available_cameras(self) -> list:
        """Tizimdagi barcha apparat web kameralarni skanerlaydi"""
        found = []
        if not HAS_OPENCV or cv2 is None:
            found.append({
                "id": 0,
                "name": self.CAMERA_NAMES.get(0, "Asosiy Kamera"),
                "status": "SYNTHETIC",
                "is_synthetic": True,
                "resolution": f"{self.width}x{self.height}"
            })
            return found

        # 0 dan 3 gacha bo'lgan portlarni tekshirish
        for idx in range(4):
            try:
                if sys.platform.startswith('win'):
                    test_cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
                    if not test_cap.isOpened():
                        test_cap = cv2.VideoCapture(idx)
                else:
                    test_cap = cv2.VideoCapture(idx)

                if test_cap and test_cap.isOpened():
                    ret, frame = test_cap.read()
                    if ret and frame is not None:
                        w = int(test_cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or self.width
                        h = int(test_cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or self.height
                        found.append({
                            "id": idx,
                            "name": self.CAMERA_NAMES.get(idx, f"USB Kamera #{idx}"),
                            "status": "ONLINE",
                            "is_synthetic": False,
                            "resolution": f"{w}x{h}"
                        })
                    test_cap.release()
            except Exception:
                pass

        # Agar birorta ham apparat kamera topilmasa, virtual simulyatorni qo'shamiz
        if not found:
            found.append({
                "id": 0,
                "name": "Virtual Patrul Kamera (Sintetik Oqim)",
                "status": "SYNTHETIC",
                "is_synthetic": True,
                "resolution": f"{self.width}x{self.height}"
            })
            
        return found

    def get_cameras_list(self) -> list:
        """Frontend uchun kameralar ro'yxati va joriy faol holatini qaytaradi"""
        cams = []
        for info in self.available_cams:
            cam_id = info["id"]
            is_active = (cam_id == self.active_source)
            fps = 0.0
            if cam_id in self.cameras:
                fps = self.cameras[cam_id].fps
            elif is_active:
                fps = self.main_camera.fps

            cams.append({
                "id": cam_id,
                "name": info["name"],
                "active": is_active,
                "status": info["status"],
                "is_synthetic": info["is_synthetic"],
                "fps": round(fps, 1),
                "resolution": info.get("resolution", f"{self.width}x{self.height}")
            })
        return cams

    def select_camera(self, source: int) -> bool:
        """Asosiy video oqim manbasini almashtirish (0: Oldi, 1: Gumbaz, 2: Orqa)"""
        with self.lock:
            if source not in self.cameras:
                cam_name = self.CAMERA_NAMES.get(source, f"USB Kamera #{source}")
                new_cam = CameraModule(source=source, width=self.width, height=self.height, name=cam_name)
                self.cameras[source] = new_cam

            self.active_source = source
            print(f"[MultiCameraManager] Faol kamera manbasi o'zgartirildi: #{source}")
            return True

    def get_jpeg(self) -> bytes:
        """Joriy faol kameradan JPEG kadr olish"""
        with self.lock:
            cam = self.cameras.get(self.active_source, self.main_camera)
            return cam.get_jpeg()

    def get_jpeg_by_source(self, cam_id: int) -> bytes:
        """Muayyan kamera ID si bo'yicha JPEG olish"""
        with self.lock:
            if cam_id not in self.cameras:
                cam_name = self.CAMERA_NAMES.get(cam_id, f"USB Kamera #{cam_id}")
                self.cameras[cam_id] = CameraModule(source=cam_id, width=self.width, height=self.height, name=cam_name)
            return self.cameras[cam_id].get_jpeg()

    def get_quad_jpeg(self) -> bytes:
        """4 ta kameraning (Oldi, Orqa, Chap, O'ng) 2x2 shakldagi birlashgan 360° ko'rinishi"""
        if not HAS_OPENCV or cv2 is None or np is None:
            return self.get_jpeg()

        frames = []
        half_w, half_h = self.width // 2, self.height // 2

        with self.lock:
            for idx in range(4):
                if idx not in self.cameras:
                    name = self.CAMERA_NAMES.get(idx, f"Kamera #{idx}")
                    self.cameras[idx] = CameraModule(source=idx, width=self.width, height=self.height, name=name)
                
                f = self.cameras[idx].latest_frame
                if f is None:
                    f = self.cameras[idx]._generate_synthetic_frame(time.time())
                
                if f is not None:
                    small = cv2.resize(f, (half_w, half_h))
                else:
                    small = np.zeros((half_h, half_w, 3), dtype=np.uint8)
                
                # Sarlavha yozish
                title = self.CAMERA_NAMES.get(idx, f"CAM {idx}").split('(')[0].strip().upper()
                cv2.putText(small, title, (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
                frames.append(small)

        # 2x2 matrisa:
        # [0: Oldi] [1: Orqa]
        # [2: Chap] [3: O'ng]
        top_row = np.hstack([frames[0], frames[1]])
        bot_row = np.hstack([frames[2], frames[3]])
        quad = np.vstack([top_row, bot_row])

        # Taktik ajratuvchi chiziqlar
        cv2.line(quad, (half_w, 0), (half_w, self.height), (0, 200, 255), 1)
        cv2.line(quad, (0, half_h), (self.width, half_h), (0, 200, 255), 1)

        _, jpeg_buf = cv2.imencode('.jpg', quad, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
        return jpeg_buf.tobytes()

    def dispatch_alert_to_iib(self, reason: str = "Xavfli vaziyat aniqlandi"):
        with self.lock:
            cam = self.cameras.get(self.active_source, self.main_camera)
            return cam.dispatch_alert_to_iib(reason)

    def get_latest_alert_jpeg(self):
        with self.lock:
            cam = self.cameras.get(self.active_source, self.main_camera)
            return cam.get_latest_alert_jpeg()

    def get_status(self):
        with self.lock:
            cam = self.cameras.get(self.active_source, self.main_camera)
            status = cam.get_status()
            status["active_source"] = self.active_source
            status["total_cameras"] = len(self.available_cams)
            return status

    def close(self):
        self.running = False
        with self.lock:
            for cam in self.cameras.values():
                cam.close()


if __name__ == '__main__':
    print("Ko'p kamerali tizim sinovi...")
    mgr = MultiCameraManager()
    time.sleep(1.0)
    print("Mavjud kameralar:", mgr.get_cameras_list())
    jpeg = mgr.get_jpeg()
    print("JPEG o'lchami:", len(jpeg) if jpeg else 0, "bayt")
    mgr.close()
