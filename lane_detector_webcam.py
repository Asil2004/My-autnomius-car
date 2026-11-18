"""
=============================================================================
RASPBERRY PI & USB WEBCAM UCHUN AVTONOM YO'LNI (POLOSANI) ANIQLASH TIZIMI
Asoslangan loyiha: DeepPiCar (Computer Vision & Lane Following)
Platforma: Raspberry Pi 3/4/5 yoki kompyuter + USB Webcam / Video fayl
=============================================================================
Foydalanish:
  python lane_detector_webcam.py            -> USB WebCam orqali jonli efir
  python lane_detector_webcam.py video      -> DeepPiCar namunaviy video orqali test
  python lane_detector_webcam.py image      -> DeepPiCar namunaviy rasmlari orqali test
=============================================================================
"""

import cv2
import numpy as np
import math
import time
import sys
import os

class LaneDetector:
    def __init__(self, color_mode='tactile_yellow', yellowness_min=20):
        """
        color_mode:
          'tactile_yellow' - Ko'zi ojizlar sariq taktil yo'lagi (QULAY MAKON, default)
          'yellow'         - Sariq chiziqlar / taktil yo'lak
          'blue'           - Ko'k rangli lenta (DeepPiCar standarti)
          'white'          - Oq chiziqlar (standart yo'l)
          'black'          - Oq polda qora chiziq
        """
        self.color_mode = color_mode
        self.yellowness_min = int(yellowness_min)
        self.curr_steering_angle = 90  # 90 gradus = to'g'riga

    def detect_tactile_mask(self, small_bgr):
        """(R+G)/2 - B farqiga asoslangan taktil sariq yo'lak maskasi (0/255)."""
        b = small_bgr[:, :, 0].astype(np.int16)
        g = small_bgr[:, :, 1].astype(np.int16)
        r = small_bgr[:, :, 2].astype(np.int16)
        ymin = self.yellowness_min
        min_ch = max(12, ymin - 2)
        mask = (
            ((((r + g) >> 1) - b) >= ymin)
            & ((r - b) >= min_ch)
            & ((g - b) >= min_ch)
            & (np.abs(r - g) <= 52)
            & ((r + g) >= 110)
        )
        return (mask.astype(np.uint8)) * 255

    def track_tactile_strip(self, frame):
        """
        Ko'zi ojizlar sariq taktil yo'lagini qatlam-qatlam (pastdan yuqoriga) kuzatadi.
        Chetdagi oq kabellar va T-chorraha yon shoxlarini filtrlaydi.
        Qaytaradi: dict(detected, confidence, offset_norm, angle_deg, raw_steer, t_junction, command, bands, mask_u8)
        """
        small = cv2.resize(frame, (160, 120), interpolation=cv2.INTER_AREA)
        h, w, _ = small.shape
        mask_u8 = self.detect_tactile_mask(small)
        mask = mask_u8 > 0

        y_start = int(h * 0.22)
        y_end = int(h * 0.96)
        n_bands = 14
        edges = np.linspace(y_start, y_end, n_bands + 1, dtype=int)
        min_run = max(3, int(round(w * 0.04)))

        bands = []
        prev_c = None
        prev_w = None
        t_junc = False
        t_junc_side = None

        for i in range(n_bands - 1, -1, -1):
            y0, y1 = int(edges[i]), max(int(edges[i]) + 1, int(edges[i + 1]))
            hits = mask[y0:y1, :].mean(axis=0) > 0.35
            runs = []
            in_r = False
            s = 0
            for x in range(w):
                if hits[x] and not in_r:
                    in_r, s = True, x
                elif not hits[x] and in_r:
                    in_r = False
                    if x - s >= min_run:
                        runs.append((s, x - 1))
            if in_r and w - s >= min_run:
                runs.append((s, w - 1))
            if not runs:
                continue

            merged = [runs[0]]
            for rs, re in runs[1:]:
                if rs - merged[-1][1] <= 3:
                    merged[-1] = (merged[-1][0], re)
                else:
                    merged.append((rs, re))

            if prev_c is None:
                best = max(
                    merged,
                    key=lambda r_: (r_[1] - r_[0] + 1) * (1.0 - 0.3 * abs(((r_[0] + r_[1]) / 2.0 - w / 2.0) / (w / 2.0))),
                )
            else:
                best = min(merged, key=lambda r_: abs((r_[0] + r_[1]) / 2.0 - prev_c))
                if abs((best[0] + best[1]) / 2.0 - prev_c) > w * 0.35 and (best[1] - best[0] + 1) < w * 0.4:
                    continue

            x0, x1 = best
            bw = x1 - x0 + 1
            cx = (x0 + x1) / 2.0
            clamped = False

            if prev_w is not None and bw > w * 0.45 and bw > prev_w * 1.45:
                t_junc = True
                clamped = True
                r_exp = x1 - prev_c
                l_exp = prev_c - x0
                t_junc_side = 'right' if r_exp >= l_exp else 'left'
                lo = x0 + prev_w / 2.0
                hi = x1 - prev_w / 2.0
                cx = float(np.clip(prev_c, lo, hi)) if lo <= hi else prev_c
                x0 = max(x0, int(round(cx - prev_w / 2.0)))
                x1 = min(x1, int(round(cx + prev_w / 2.0)))
                bw = prev_w

            prev_c = cx
            prev_w = bw if prev_w is None else 0.7 * prev_w + 0.3 * bw
            bands.append({
                "y": (y0 + y1) / 2.0 / h,
                "x0": x0 / w,
                "x1": x1 / w,
                "cx": cx / w,
                "clamped": clamped,
            })

        bands.reverse()
        confidence = len(bands) / float(n_bands)
        detected = len(bands) >= 3 and confidence >= 0.21

        if not detected:
            return {
                "detected": False,
                "confidence": confidence,
                "offset_norm": 0.0,
                "angle_deg": 0.0,
                "raw_steer": 0.0,
                "t_junction": t_junc,
                "t_junction_side": t_junc_side,
                "command": "S",
                "bands": bands,
                "mask_u8": mask_u8,
            }

        near = bands[-min(5, len(bands)):]
        near_x = float(np.mean([b_["cx"] for b_ in near]))
        near_y = float(np.mean([b_["y"] for b_ in near]))
        offset_norm = float(np.clip((near_x - 0.5) * 2.0, -1.0, 1.0))

        far = bands[:min(4, len(bands))]
        far_x = float(np.mean([b_["cx"] for b_ in far]))
        far_y = float(np.mean([b_["y"] for b_ in far]))
        dx = far_x - near_x
        dy = max(0.05, near_y - far_y)
        angle_deg = float(np.clip(math.degrees(math.atan2(dx, dy)), -60.0, 60.0))
        heading_norm = float(np.clip(dx * 2.4, -1.0, 1.0))
        raw_steer = float(np.clip(0.85 * offset_norm + 0.45 * heading_norm, -1.0, 1.0))

        abs_s = abs(raw_steer)
        if abs_s >= 0.52:
            cmd = "L" if raw_steer < 0 else "R"
        elif abs_s >= 0.14:
            cmd = "G" if raw_steer < 0 else "I"
        else:
            cmd = "F"

        return {
            "detected": True,
            "confidence": confidence,
            "offset_norm": offset_norm,
            "angle_deg": angle_deg,
            "raw_steer": raw_steer,
            "t_junction": t_junc,
            "t_junction_side": t_junc_side,
            "command": cmd,
            "bands": bands,
            "mask_u8": mask_u8,
        }

    @staticmethod
    def can_turn_left(res):
        """Foydalanuvchi chapga burila oladimi (chapda yo'lak bormi)?"""
        if not res or not res.get("detected"):
            return False
        return (
            res.get("offset_norm", 0.0) <= -0.12 or
            res.get("angle_deg", 0.0) <= -8.0 or
            res.get("t_junction_side") == "left"
        )

    @staticmethod
    def can_turn_right(res):
        """Foydalanuvchi o'ngga burila oladimi (o'ngda yo'lak yoki shox bormi)?"""
        if not res or not res.get("detected"):
            return False
        return (
            res.get("offset_norm", 0.0) >= 0.12 or
            res.get("angle_deg", 0.0) >= 8.0 or
            res.get("t_junction_side") == "right" or
            res.get("t_junction", False)
        )

    def step_assisted(self, res, user_intent, invert_steering=False):
        """
        Yordamchi (assisted) boshqaruv qadami:
          - Oldinga (forward=True): Faqat chiziq bo'ylab harakatlanadi (F/G/I/L/R).
          - Oldinga qo'yib yuborilganda: Yo'lakka avtonom to'g'irlanadi (L/R), to'g'ri bo'lsa S.
          - Chapga burilish: Agar chapda yo'lak bo'lmasa -> BLOKLANADI (S, guard_blocked='left').
          - O'ngga burilish: Agar o'ngda yo'lak bo'lmasa -> BLOKLANADI (S, guard_blocked='right').
        """
        if user_intent.get("emergency_stop"):
            return "S", {"status": "STOP (Tugatildi)", "guard_blocked": None, "auto_aligning": False}

        if user_intent.get("reverse"):
            return "B", {"status": "ORQAGA HARAKAT (B)", "guard_blocked": None, "auto_aligning": False}

        if user_intent.get("turn_left") and not user_intent.get("forward"):
            if self.can_turn_left(res):
                cmd = "R" if invert_steering else "L"
                return cmd, {"status": f"CHAPGA BURILISH ({cmd}) — RUXSAT ETILDI", "guard_blocked": None, "auto_aligning": False}
            else:
                return "S", {"status": "⚠️ CHAPDA YO'LAK YO'Q — BURILISH BLOKLANDI!", "guard_blocked": "left", "auto_aligning": False}

        if user_intent.get("turn_right") and not user_intent.get("forward"):
            if self.can_turn_right(res):
                cmd = "L" if invert_steering else "R"
                return cmd, {"status": f"O'NGGA BURILISH ({cmd}) — RUXSAT ETILDI", "guard_blocked": None, "auto_aligning": False}
            else:
                return "S", {"status": "⚠️ O'NGDA YO'LAK YO'Q — BURILISH BLOKLANDI!", "guard_blocked": "right", "auto_aligning": False}

        if user_intent.get("forward"):
            if not res or not res.get("detected"):
                return "S", {"status": "YO'LAK KO'RINMAYDI — TO'XTATILDI", "guard_blocked": None, "auto_aligning": False}
            raw_s = res.get("raw_steer", 0.0)
            oriented_s = -raw_s if invert_steering else raw_s
            abs_s = abs(oriented_s)
            if abs_s >= 0.52:
                cmd = "L" if oriented_s < 0 else "R"
                dir_txt = "CHAP (L)" if oriented_s < 0 else "O'NG (R)"
                status = f"CHIZIQ: KESKIN {dir_txt}"
            elif abs_s >= 0.14:
                cmd = "G" if oriented_s < 0 else "I"
                dir_txt = "CHAPGA YOY (G)" if oriented_s < 0 else "O'NGGA YOY (I)"
                status = f"CHIZIQ: {dir_txt}"
            else:
                cmd = "F"
                status = "OLDINGA CHIZIQ BO'YLAB (F)"
            return cmd, {"status": status, "guard_blocked": None, "auto_aligning": False}

        # Oldinga qo'yib yuborildi: auto-align
        if res and res.get("detected"):
            raw_s = res.get("raw_steer", 0.0)
            angle = res.get("angle_deg", 0.0)
            if abs(raw_s) >= 0.16 or abs(angle) >= 8.0:
                steer_left = (raw_s < -0.16 or angle < -8.0)
                if invert_steering:
                    align_cmd = "R" if steer_left else "L"
                else:
                    align_cmd = "L" if steer_left else "R"
                return align_cmd, {"status": f"AVTONOM BURILISH ({align_cmd}) — YO'LAKKA TO'G'IRLANMOQDA", "guard_blocked": None, "auto_aligning": True}

            return "S", {"status": "YO'LAKKA TO'G'IRLANDI — TAYYOR (STOP)", "guard_blocked": None, "auto_aligning": False}

        return "S", {"status": "KUTILMOQDA (STOP)", "guard_blocked": None, "auto_aligning": False}
        
    def detect_edges(self, frame):
        """Kadrni HSV ga o'girish va yo'l chiziqlarining chegarasini (Canny) topish"""
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        
        if self.color_mode == 'blue':
            # Ko'k rang diapazoni
            lower = np.array([60, 40, 40])
            upper = np.array([150, 255, 255])
            mask = cv2.inRange(hsv, lower, upper)
        elif self.color_mode in ('yellow', 'tactile_yellow'):
            # Sariq / taktil yo'lak rang diapazoni
            lower = np.array([18, 45, 95])
            upper = np.array([35, 255, 255])
            mask = cv2.inRange(hsv, lower, upper)
        elif self.color_mode == 'white':
            # Oq rang diapazoni
            lower = np.array([0, 0, 180])
            upper = np.array([180, 45, 255])
            mask = cv2.inRange(hsv, lower, upper)
        elif self.color_mode == 'black':
            # Qora rang diapazoni
            lower = np.array([0, 0, 0])
            upper = np.array([180, 255, 70])
            mask = cv2.inRange(hsv, lower, upper)
        else:
            lower = np.array([60, 40, 40])
            upper = np.array([150, 255, 255])
            mask = cv2.inRange(hsv, lower, upper)
            
        # Canny orqali qirralarni aniqlash
        edges = cv2.Canny(mask, 150, 300)
        return edges

    def region_of_interest(self, edges):
        """Faqat yo'l yotgan pastki qismni (pastki 55%) kesib olish"""
        height, width = edges.shape
        mask = np.zeros_like(edges)
        
        # Kamera gorizonti va yuqori fonni kesib tashlash
        polygon = np.array([[
            (0, int(height * 0.45)),
            (width, int(height * 0.45)),
            (width, height),
            (0, height)
        ]], np.int32)
        
        cv2.fillPoly(mask, polygon, 255)
        cropped_edges = cv2.bitwise_and(edges, mask)
        return cropped_edges

    def detect_line_segments(self, cropped_edges):
        """Hough Transform yordamida to'g'ri chiziq parchalarini aniqlash"""
        rho = 1
        angle = np.pi / 180
        min_threshold = 10
        line_segments = cv2.HoughLinesP(
            cropped_edges, rho, angle, min_threshold, 
            np.array([]), minLineLength=10, maxLineGap=6
        )
        return line_segments

    def average_slope_intercept(self, frame, line_segments):
        """Chiziq parchalarini Chap va O'ng yo'l chizig'iga guruhlash va birlashtirish"""
        lane_lines = []
        if line_segments is None:
            return lane_lines
            
        height, width, _ = frame.shape
        left_fit = []
        right_fit = []
        
        boundary = 1/3
        left_region_boundary = width * (1 - boundary)
        right_region_boundary = width * boundary
        
        for line_segment in line_segments:
            for x1, y1, x2, y2 in line_segment:
                if x1 == x2:
                    continue
                fit = np.polyfit((x1, x2), (y1, y2), 1)
                slope = fit[0]
                intercept = fit[1]
                
                # Chap chiziq (salbiy qiyalik)
                if slope < -0.2:
                    if x1 < left_region_boundary and x2 < left_region_boundary:
                        left_fit.append((slope, intercept))
                # O'ng chiziq (musbat qiyalik)
                elif slope > 0.2:
                    if x1 > right_region_boundary and x2 > right_region_boundary:
                        right_fit.append((slope, intercept))
                        
        if len(left_fit) > 0:
            left_fit_average = np.average(left_fit, axis=0)
            lane_lines.append(self._make_points(frame, left_fit_average))
            
        if len(right_fit) > 0:
            right_fit_average = np.average(right_fit, axis=0)
            lane_lines.append(self._make_points(frame, right_fit_average))
            
        return lane_lines

    def _make_points(self, frame, line):
        height, width, _ = frame.shape
        slope, intercept = line
        y1 = height
        y2 = int(y1 * 0.5)
        
        if slope == 0:
            slope = 0.001
        x1 = max(-width, min(2 * width, int((y1 - intercept) / slope)))
        x2 = max(-width, min(2 * width, int((y2 - intercept) / slope)))
        return [[x1, y1, x2, y2]]

    def compute_steering_angle(self, frame, lane_lines):
        """Yo'l chiziqlari markaziga qarab rul burchagini hisoblash (45° - 135°, 90° = to'g'ri)"""
        if len(lane_lines) == 0:
            return 90  # Chiziq ko'rinmasa to'g'riga davom etish
            
        height, width, _ = frame.shape
        if len(lane_lines) == 1:
            x1, _, x2, _ = lane_lines[0][0]
            x_offset = x2 - x1
        else:
            _, _, left_x2, _ = lane_lines[0][0]
            _, _, right_x2, _ = lane_lines[1][0]
            mid = int(width / 2)
            x_offset = int((left_x2 + right_x2) / 2) - mid
            
        y_offset = int(height / 2)
        angle_to_mid_radian = math.atan2(x_offset, y_offset)
        angle_to_mid_deg = int(angle_to_mid_radian * 180.0 / math.pi)
        steering_angle = angle_to_mid_deg + 90
        
        steering_angle = max(45, min(135, steering_angle))
        return steering_angle

    def stabilize_steering_angle(self, new_angle, max_step=5):
        """Rul qaltiramasligi uchun burchakni silliqlash (smooth steering)"""
        diff = new_angle - self.curr_steering_angle
        if abs(diff) > max_step:
            stabilized = self.curr_steering_angle + int(max_step * (diff / abs(diff)))
        else:
            stabilized = new_angle
        self.curr_steering_angle = stabilized
        return stabilized

    def _process_tactile_yellow(self, frame):
        """Sariq taktil yo'lak rejimida vizualizatsiya va rul burchagi hisoblash."""
        res = self.track_tactile_strip(frame)
        raw_angle = int(round(90 + res["raw_steer"] * 45)) if res["detected"] else 90
        raw_angle = max(45, min(135, raw_angle))
        steering_angle = self.stabilize_steering_angle(raw_angle, max_step=8)

        vis_frame = frame.copy()
        h, w, _ = vis_frame.shape
        bands = res["bands"]
        if len(bands) >= 2:
            left_pts = [(int(b["x0"] * w), int(b["y"] * h)) for b in bands]
            right_pts = [(int(b["x1"] * w), int(b["y"] * h)) for b in reversed(bands)]
            poly = np.array(left_pts + right_pts, dtype=np.int32)
            overlay = vis_frame.copy()
            cv2.fillPoly(overlay, [poly], (168, 85, 247) if res["t_junction"] else (34, 197, 94))
            cv2.addWeighted(overlay, 0.25, vis_frame, 0.75, 0, vis_frame)
            cv2.polylines(vis_frame, [poly], True, (34, 197, 94), 2)

            mid_pts = np.array([(int(b["cx"] * w), int(b["y"] * h)) for b in bands], dtype=np.int32)
            cv2.polylines(vis_frame, [mid_pts], False, (0, 220, 255), 3)
            for b in bands:
                color = (255, 100, 220) if b["clamped"] else (0, 220, 255)
                cv2.circle(vis_frame, (int(b["cx"] * w), int(b["y"] * h)), 4, color, -1)

        rad = math.radians(steering_angle - 90)
        x_start = int(w / 2)
        y_start = int(h * 0.94)
        x_end = int(x_start + (h * 0.35) * math.sin(rad))
        y_end = int(y_start - (h * 0.35) * math.cos(rad))
        cv2.line(vis_frame, (x_start, y_start), (x_end, y_end), (0, 200, 255) if res["detected"] else (0, 0, 255), 4)

        cmd = res["command"]
        label = f"CMD:{cmd} CONF:{int(res['confidence']*100)}% ({steering_angle} deg)"
        if res["t_junction"]:
            label += " [T-FILTER]"
        cv2.putText(vis_frame, label, (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0) if res["detected"] else (0, 0, 255), 2)
        cv2.putText(vis_frame, f"Rang: {self.color_mode.upper()} | MIN={self.yellowness_min}", (12, 54), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        mask_full = cv2.resize(res["mask_u8"], (w, h), interpolation=cv2.INTER_NEAREST)
        return vis_frame, steering_angle, mask_full

    def process_frame(self, frame):
        """Kadrni qabul qilib, tahlil qiladi va chizilgan vizual kadr va burchakni qaytaradi"""
        if self.color_mode in ('tactile_yellow', 'yellow'):
            return self._process_tactile_yellow(frame)

        edges = self.detect_edges(frame)
        cropped_edges = self.region_of_interest(edges)
        line_segments = self.detect_line_segments(cropped_edges)
        lane_lines = self.average_slope_intercept(frame, line_segments)
        
        raw_angle = self.compute_steering_angle(frame, lane_lines)
        steering_angle = self.stabilize_steering_angle(raw_angle)
        
        vis_frame = frame.copy()
        
        # 1. Aniqlangan yo'l chiziqlarini yashil rangda chizish
        for line in lane_lines:
            for x1, y1, x2, y2 in line:
                cv2.line(vis_frame, (x1, y1), (x2, y2), (0, 255, 0), 4)
                
        # 2. Rulning harakat yo'nalishi (Heading Line) ni qizil rangda chizish
        height, width, _ = vis_frame.shape
        rad = math.radians(steering_angle - 90)
        x_start = int(width / 2)
        y_start = height
        x_end = int(x_start + (height * 0.4) * math.sin(rad))
        y_end = int(y_start - (height * 0.4) * math.cos(rad))
        
        cv2.line(vis_frame, (x_start, y_start), (x_end, y_end), (0, 0, 255), 4)
        cv2.circle(vis_frame, (x_end, y_end), 8, (0, 0, 255), -1)
        
        # 3. Buyruq matni va burchak ko'rsatkichi
        if steering_angle < 85:
            action = f"CHAPGA BURIL ({steering_angle} deg)"
            color = (255, 100, 0)
        elif steering_angle > 95:
            action = f"O'NGGA BURIL ({steering_angle} deg)"
            color = (0, 165, 255)
        else:
            action = f"TO'G'RI ({steering_angle} deg)"
            color = (0, 255, 0)
            
        cv2.putText(vis_frame, f"Buyruq: {action}", (15, 30), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2)
        cv2.putText(vis_frame, f"Rang: {self.color_mode.upper()}", (15, 60), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
                    
        return vis_frame, steering_angle, edges


def run_on_sample_images():
    """Namunaviy rasmlarda sinash"""
    data_dir = os.path.join(os.path.dirname(__file__), "DeepPiCar", "driver", "data")
    image_files = ["road1_240x320.png", "road2_240x320.png", "road3_240x320.png"]
    
    detector = LaneDetector(color_mode='blue')
    print("[TEST] Namunaviy rasmlarda test o'tkazilmoqda...")
    
    for img_name in image_files:
        path = os.path.join(data_dir, img_name)
        if not os.path.exists(path):
            continue
        frame = cv2.imread(path)
        vis, angle, _ = detector.process_frame(frame)
        print(f"Rasm: {img_name} -> Hisoblangan burchak: {angle} deg")
        cv2.imshow(f"Test - {img_name}", vis)
        
    print("Rasmlarni yopish uchun istalgan tugmani bosing...")
    cv2.waitKey(0)
    cv2.destroyAllWindows()


def run_on_video():
    """DeepPiCar namunaviy videosida sinash"""
    data_dir = os.path.join(os.path.dirname(__file__), "DeepPiCar", "driver", "data")
    video_path = os.path.join(data_dir, "traffic_sign_detection_POV 2019-04-29.mp4")
    
    if not os.path.exists(video_path):
        print(f"[XATO] Video topilmadi: {video_path}")
        return
        
    cap = cv2.VideoCapture(video_path)
    detector = LaneDetector(color_mode='blue')
    print("[TEST] Video tahlil qilinmoqda. To'xtatish uchun 'q' ni bosing.")
    
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        # 320x240 ga moslash
        frame = cv2.resize(frame, (320, 240))
        vis, angle, edges = detector.process_frame(frame)
        cv2.imshow("Avtonom Yo'l Tahlili (Video Test)", vis)
        cv2.imshow("Canny Qirralar", edges)
        
        if cv2.waitKey(20) & 0xFF == ord('q'):
            break
            
    cap.release()
    cv2.destroyAllWindows()


def run_on_custom_photos(photo_paths, no_gui=False):
    """Ko'zi ojizlar sariq taktil yo'lagi rasmlari bo'yicha tezkor tahlil va tekshiruv."""
    detector = LaneDetector(color_mode='tactile_yellow', yellowness_min=20)
    print(f"[TEST] {len(photo_paths)} ta rasm taktil yo'lak algoritmida tekshirilmoqda...")
    for path in photo_paths:
        frame = cv2.imread(path)
        if frame is None:
            print(f"[XATO] O'qib bo'lmadi: {path}")
            continue
        res = detector.track_tactile_strip(frame)
        vis, angle, _ = detector.process_frame(frame)
        print(
            f"{os.path.basename(path)}: detected={res['detected']} conf={res['confidence']:.2f} "
            f"offset={res['offset_norm']:+.3f} steer={res['raw_steer']:+.3f} cmd={res['command']} "
            f"angle={angle}deg t_junc={res['t_junction']} bands={len(res['bands'])}"
        )
        if not no_gui:
            cv2.imshow(f"Taktil Yo'lak - {os.path.basename(path)}", vis)
    if not no_gui:
        print("Rasmlarni yopish uchun istalgan tugmani bosing...")
        cv2.waitKey(0)
        cv2.destroyAllWindows()


def run_webcam():
    """Jonli USB Webcam orqali ishga tushirish"""
    print("=" * 60)
    print("Raspberry Pi & USB WebCam Avtonom Yo'l Aniqlash")
    print("=" * 60)
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 320)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 240)
    
    if not cap.isOpened():
        print("[XATO] USB WebCam topilmadi!")
        print("[MASLAHAT] Namunaviy videoda sinash uchun:")
        print("  python lane_detector_webcam.py video")
        return
        
    detector = LaneDetector(color_mode='tactile_yellow', yellowness_min=20)
    print("[OK] Kamera faol! Chiqish: 'q', rejim: 'y'=taktil sariq, 'b'=ko'k, 'w'=oq, 'k'=qora")
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        vis, angle, edges = detector.process_frame(frame)
        cv2.imshow("Avtonom Yo'l Kamerasi", vis)
        cv2.imshow("Taktil Yo'lak Maskasi / Qirralar", edges)
        
        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break
        elif key == ord('b'):
            detector.color_mode = 'blue'
        elif key == ord('w'):
            detector.color_mode = 'white'
        elif key in (ord('y'), ord('t')):
            detector.color_mode = 'tactile_yellow'
        elif key == ord('k'):
            detector.color_mode = 'black'
            
    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1].lower() == "video":
        run_on_video()
    elif len(sys.argv) > 1 and sys.argv[1].lower() == "image":
        run_on_sample_images()
    elif len(sys.argv) > 1 and sys.argv[1].lower() == "test":
        no_gui_flag = "--no-gui" in sys.argv
        files = [a for a in sys.argv[2:] if not a.startswith("--")]
        run_on_custom_photos(files, no_gui=no_gui_flag)
    else:
        run_webcam()
