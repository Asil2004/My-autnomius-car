#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QALQON - Raspberry Pi Avtonom Veb-Nazoratchi va Video Stream
USB Web-Kamera va Arduino L293D bilan to'liq integratsiya.
"""

import cv2
import numpy as np
import glob
import time
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
import serial

# Arduino portini avtomatik topish
def get_arduino_port():
    ports = glob.glob('/dev/ttyACM*') + glob.glob('/dev/ttyUSB*')
    return ports[0] if ports else None

arduino_port = get_arduino_port()
ser = None
if arduino_port:
    try:
        ser = serial.Serial(arduino_port, 115200, timeout=0.1)
        time.sleep(2)
        print(f"[+] Arduino ulandi: {arduino_port}")
    except Exception as e:
        print(f"[-] Serial xatolik: {e}")

last_cmd = None
def send_cmd(cmd):
    global last_cmd
    if cmd == last_cmd and cmd not in ['S', '1', '2', '3']:
        return
    last_cmd = cmd
    if ser and ser.is_open:
        try:
            ser.write(cmd.encode('utf-8'))
        except:
            pass
    print(f"-> Harakat: {cmd}")

# Holatlar
auto_mode = False
camera = cv2.VideoCapture(0)
camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

output_frame = None
lock = threading.Lock()

def process_lane(frame):
    global auto_mode
    h, w = frame.shape[:2]
    
    # 1. Pastki qism (Pol va yo'l yuzasi zonasi)
    roi_top = int(h * 0.55)
    roi = frame[roi_top:h, 0:w]

    # 2. Oq / och rangli yo'lni filtrlash
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 150)

    # 3. Yo'l markazini aniqlash (Massalar markazi)
    M = cv2.moments(edges)
    frame_center = w // 2
    direction = "FORWARD"
    cmd = 'F'
    deviation = 0

    if M["m00"] > 500:
        cx = int(M["m10"] / M["m00"])
        cy = int(M["m01"] / M["m00"]) + roi_top
        deviation = cx - frame_center

        # Vizual ko'rsatkichlar
        cv2.circle(frame, (cx, cy), 10, (0, 0, 255), -1) # Yo'l markazi (Qizil nuqta)
        cv2.line(frame, (frame_center, h), (cx, cy), (0, 255, 0), 3) # Harakat vektori

        # Burilish chegarasi
        if deviation < -45:
            direction = "CHAPGA (LEFT)"
            cmd = 'L'
        elif deviation > 45:
            direction = "O'NGGA (RIGHT)"
            cmd = 'R'
        else:
            direction = "TO'G'RI (FORWARD)"
            cmd = 'F'
    else:
        direction = "YO'L KO'RINMAYAPTI"
        cmd = 'S'

    # Ekranga ma'lumot chiqarish
    status_color = (0, 255, 0) if auto_mode else (0, 255, 255)
    rejim = "AVTO-YO'L" if auto_mode else "QO'LDA"
    cv2.putText(frame, f"REJIM: {rejim}", (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.8, status_color, 2)
    cv2.putText(frame, f"YO'NALISH: {direction}", (20, 75), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    cv2.line(frame, (frame_center, 0), (frame_center, h), (255, 0, 0), 1)

    if auto_mode:
        send_cmd(cmd)

    return frame

def camera_loop():
    global output_frame
    while True:
        success, frame = camera.read()
        if not success:
            time.sleep(0.05)
            continue
        
        processed = process_lane(frame)
        with lock:
            output_frame = processed.copy()
        time.sleep(0.03)

threading.Thread(target=camera_loop, daemon=True).start()

HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>Qalqon Robot Boshqaruvi</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: sans-serif; text-align: center; background: #0e1318; color: white; margin: 0; padding: 10px; }
        img { width: 95%; max-width: 550px; border: 2px solid #00e5ff; border-radius: 8px; }
        .grid { display: grid; grid-template-columns: repeat(3, 85px); gap: 10px; justify-content: center; margin-top: 15px; }
        button { width: 85px; height: 60px; font-size: 22px; font-weight: bold; background: #1a2332; color: #00e5ff; border: 1px solid #00e5ff; border-radius: 8px; cursor: pointer; }
        button:active { background: #00e5ff; color: black; }
        .stop { background: #b71c1c; color: white; border-color: red; }
        .mode-btn { width: 275px; height: 50px; margin-top: 15px; font-size: 18px; background: #00897b; border-color: #4db6ac; color: white; }
    </style>
</head>
<body>
    <h3>🛡️ QALQON AVTONOM PATRUL</h3>
    <img src="/video_feed">
    <br>
    <button class="mode-btn" onclick="toggleMode()">🤖 REJIM: QO'LDA / AVTO-YO'L</button>
    <div class="grid">
        <button onclick="cmd('Q')">↖️</button>
        <button onclick="cmd('F')">⬆️</button>
        <button onclick="cmd('E')">↗️</button>
        <button onclick="cmd('L')">⬅️</button>
        <button class="stop" onclick="cmd('S')">🛑</button>
        <button onclick="cmd('R')">➡️</button>
        <button onclick="cmd('1')">1️⃣</button>
        <button onclick="cmd('B')">⬇️</button>
        <button onclick="cmd('3')">3️⃣</button>
    </div>
    <script>
        function cmd(c) { fetch('/cmd?c=' + c); }
        function toggleMode() { fetch('/toggle_mode'); }
        window.addEventListener('keydown', (e) => {
            const map = {'KeyW':'F','KeyS':'B','KeyA':'L','KeyD':'R','KeyQ':'Q','KeyE':'E','Space':'S'};
            if(map[e.code]) cmd(map[e.code]);
            if(e.code === 'KeyM') toggleMode();
        });
    </script>
</body>
</html>
"""

class WebHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global output_frame, auto_mode
        if self.path == '/':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(HTML.encode('utf-8'))
        elif self.path.startswith('/cmd'):
            auto_mode = False
            c = self.path.split('c=')[-1]
            send_cmd(c)
            self.send_response(200)
            self.end_headers()
        elif self.path == '/toggle_mode':
            auto_mode = not auto_mode
            if not auto_mode:
                send_cmd('S')
            print(f"[🔄 Rejim]: {'AVTO-YO`L' if auto_mode else 'QO`LDA'}")
            self.send_response(200)
            self.end_headers()
        elif self.path == '/video_feed':
            self.send_response(200)
            self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
            self.end_headers()
            while True:
                with lock:
                    if output_frame is None:
                        continue
                    _, jpeg = cv2.imencode('.jpg', output_frame)
                self.wfile.write(b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n')
                time.sleep(0.04)

if __name__ == '__main__':
    print("🚀 Qalqon avtonom yo'l nazorati serveri: http://0.0.0.0:8000")
    HTTPServer(('0.0.0.0', 8000), WebHandler).serve_forever()
