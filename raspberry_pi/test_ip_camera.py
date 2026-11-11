#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QALQON - V380 Pro / IP Wi-Fi Kamerani Sinash va Ko'rish Skripti
Raspberry Pi 4 / Kompyuter uchun.

Ushbu skript Wi-Fi ga ulangan V380 Pro (yoki har qanday RTSP/ONVIF)
kamerasidan oqimni (video stream) oladi va ekranda ko'rsatadi.
"""

import sys
import os
import time

try:
    import cv2
except ImportError:
    print("[XATO] OpenCV o'rnatilmagan! Iltimos, quyidagilarni bajaring:")
    print("  sudo apt update && sudo apt install -y python3-opencv")
    print("  yoki: pip install opencv-python")
    sys.exit(1)

def test_camera_stream(rtsp_url: str):
    print("=" * 60)
    print(f"[QALQON] IP Kameraga ulanmoqda...")
    print(f"[URL]: {rtsp_url}")
    print("=" * 60)

    # RTSP ulanish barqaror bo'lishi uchun TCP rejimini tanlaymiz
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|analyzeduration;5000000|max_delay;500000"

    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    
    # Kadr buferi kattalashib ketib, kechikish (latency) bo'lmasligi uchun buferni 1 qilamiz
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    if not cap.isOpened():
        print("\n[XATO] Kameraga ulanib bo'lmadi!")
        print("Tekshiring:")
        print(" 1. Kamera va Raspberry Pi bitta Wi-Fi tarmog'idami?")
        print(" 2. IP manzil to'g'rimi?")
        print(" 3. RTSP porti (odatda 554) ochiqmi?")
        print(" 4. V380 ilovasida o'rnatilgan parol to'g'ri kiritildimi?")
        return False

    print("[MUVAFFAQIN] Ulanish hosil qilindi! Video oyna ochilmoqda...")
    print("Chiqish uchun klaviaturadan 'q' tugmasini bosing.")

    fps_count = 0
    start_time = time.time()
    fps_display = 0.0

    while True:
        ret, frame = cap.read()
        if not ret or frame is None:
            print("[OGOHLANTIRISH] Kadr kelishi to'xtadi yoki uzilish bo'ldi...")
            time.sleep(0.1)
            continue

        fps_count += 1
        elapsed = time.time() - start_time
        if elapsed >= 1.0:
            fps_display = fps_count / elapsed
            fps_count = 0
            start_time = time.time()

        # Ekran ustiga ma'lumot yozish (OSD)
        h, w = frame.shape[:2]
        info_text = f"QALQON V380 Pro Stream | {w}x{h} | FPS: {fps_display:.1f}"
        cv2.putText(frame, info_text, (20, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        cv2.putText(frame, "Chiqish uchun: 'q' bosing", (20, h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 255), 2)

        cv2.imshow("QALQON - V380 Pro WiFi Camera Feed", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q') or key == 27:
            break

    cap.release()
    cv2.destroyAllWindows()
    print("[INFO] Dastur yakunlandi.")
    return True

if __name__ == "__main__":
    if len(sys.argv) > 1:
        camera_url = sys.argv[1]
    else:
        print("\n--- V380 PRO RTSP URL SOZLASH ---")
        cam_ip = input("Kameraning IP manzilini kiriting (masalan: 192.168.1.120): ").strip()
        cam_pass = input("V380 ilovasida o'rnatilgan parolingiz (bo'sh qoldirish mumkin): ").strip()
        channel = input("Kamera kanali (odatda 'ch0' yoki 'ch1', standart: ch0): ").strip() or "ch0"

        if cam_pass:
            camera_url = f"rtsp://admin:{cam_pass}@{cam_ip}:554/live/{channel}"
        else:
            camera_url = f"rtsp://{cam_ip}:554/live/{channel}"

    test_camera_stream(camera_url)
