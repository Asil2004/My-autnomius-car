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
    def __init__(self, color_mode='blue'):
        """
        color_mode: 
          'blue'   - Ko'k rangli lenta (DeepPiCar standarti)
          'white'  - Oq chiziqlar (standart yo'l)
          'yellow' - Sariq chiziqlar
          'black'  - Oq polda qora chiziq
        """
        self.color_mode = color_mode
        self.curr_steering_angle = 90  # 90 gradus = to'g'riga
        
    def detect_edges(self, frame):
        """Kadrni HSV ga o'girish va yo'l chiziqlarining chegarasini (Canny) topish"""
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        
        if self.color_mode == 'blue':
            # Ko'k rang diapazoni
            lower = np.array([60, 40, 40])
            upper = np.array([150, 255, 255])
            mask = cv2.inRange(hsv, lower, upper)
        elif self.color_mode == 'yellow':
            # Sariq rang diapazoni
            lower = np.array([18, 60, 100])
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

    def process_frame(self, frame):
        """Kadrni qabul qilib, tahlil qiladi va chizilgan vizual kadr va burchakni qaytaradi"""
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
        
    detector = LaneDetector(color_mode='blue')
    print("[OK] Kamera faol! Chiqish uchun 'q', rang almashtirish: 'b'=ko'k, 'w'=oq, 'y'=sariq")
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        vis, angle, edges = detector.process_frame(frame)
        cv2.imshow("Avtonom Yo'l Kamerasi", vis)
        cv2.imshow("Canny Qirralar", edges)
        
        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break
        elif key == ord('b'):
            detector.color_mode = 'blue'
        elif key == ord('w'):
            detector.color_mode = 'white'
        elif key == ord('y'):
            detector.color_mode = 'yellow'
        elif key == ord('k'):
            detector.color_mode = 'black'
            
    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1].lower() == "video":
        run_on_video()
    elif len(sys.argv) > 1 and sys.argv[1].lower() == "image":
        run_on_sample_images()
    else:
        run_webcam()
