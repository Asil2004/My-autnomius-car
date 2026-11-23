#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
🛡️ QALQON — PTZ Kamera LAN Diagnostika va Test Skripti
=============================================================================
Ushbu skript Raspberry Pi da turib PTZ kamera aloqasini 100% tekshiradi:
1. eth0 interfeysi holati va 192.168.1.10 IP manzili
2. ARP jadvali va kameraning MAC manzili (00:55:7B:11:C6:15)
3. 192.168.1.100 ga Ping aloqasi
4. 554 (RTSP) va 8899 (ONVIF) portlarining ochiqligi
5. OpenCV orqali haqiqiy RTSP video oqimidan test kadri olish
=============================================================================
"""

import os
import sys
import time
import socket
import subprocess

def run_cmd(cmd):
    try:
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        return res.stdout.strip(), res.returncode
    except Exception as e:
        return str(e), 1

print("\n" + "="*65)
print("🔍 PTZ KAMERA LAN DIAGNOSTIKA VA TEST BOSHLANMOQDA...")
print("="*65)

# 1. eth0 interfeysi va IP
print("\n[1/5] eth0 interfeysi tekshirilmoqda...")
run_cmd("sudo ip link set eth0 up")
run_cmd("sudo ip addr add 192.168.1.10/24 dev eth0 2>/dev/null || true")
run_cmd("sudo ip route replace 192.168.1.0/24 dev eth0 src 192.168.1.10 2>/dev/null || true")
out, _ = run_cmd("ip -4 addr show eth0")
if "192.168.1.10" in out:
    print("  ✅ eth0 ga 192.168.1.10/24 IP manzili berilgan!")
else:
    print(f"  ⚠️ eth0 IP holati: {out or 'IP topilmadi'}")

# 2. ARP jadvali
print("\n[2/5] ARP jadvali (LAN tarmog'idagi qurilmalar) tekshirilmoqda...")
cam_ip = "192.168.1.100"
found_mac = None
try:
    with open("/proc/net/arp", "r") as f:
        for line in f.readlines()[1:]:
            parts = line.split()
            if len(parts) >= 6 and parts[5] == "eth0":
                print(f"  📡 eth0 da topildi: IP={parts[0]} | MAC={parts[3]}")
                if parts[3].lower() != "00:00:00:00:00:00":
                    cam_ip = parts[0]
                    found_mac = parts[3]
except Exception as e:
    print(f"  ⚠️ ARP o'qishda xato: {e}")

if found_mac:
    print(f"  ✅ Kamera aniqlandi: IP={cam_ip}, MAC={found_mac}")
else:
    print(f"  ℹ️ Standart IP bilan tekshiriladi: {cam_ip}")

# 3. Ping tekshiruvi
print(f"\n[3/5] {cam_ip} ga Ping yuborilmoqda...")
out, code = run_cmd(f"ping -c 2 -W 2 {cam_ip}")
if code == 0:
    print(f"  ✅ {cam_ip} Ping ga javob berdi (Aloqa bor)!")
else:
    print(f"  ⚠️ {cam_ip} Ping ga javob bermadi (No route to host yoki kamera IP olmadi).")

# 4. Portlar tekshiruvi (554 RTSP va 8899 ONVIF)
print(f"\n[4/5] Portlar tekshirilmoqda ({cam_ip}:554 RTSP, {cam_ip}:8899 ONVIF)...")
rtsp_open = False
onvif_open = False
for port, name in [(554, "RTSP"), (8899, "ONVIF"), (80, "HTTP")]:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(2.0)
        res = s.connect_ex((cam_ip, port))
        s.close()
        if res == 0:
            print(f"  ✅ Port {port} ({name}) OCHIQ!")
            if port == 554: rtsp_open = True
            if port == 8899: onvif_open = True
        else:
            print(f"  ❌ Port {port} ({name}) YOPIQ (kod {res})")
    except Exception as e:
        print(f"  ❌ Port {port} ({name}) xatosi: {e}")

# 5. OpenCV RTSP test
print(f"\n[5/5] RTSP video oqimi sinab ko'rilmoqda...")
urls_to_test = [
    f"rtsp://{cam_ip}:554/live/ch00_0",
    f"rtsp://{cam_ip}:554/live/ch0",
    f"rtsp://{cam_ip}:554/onvif1",
    f"rtsp://{cam_ip}:554/ch0"
]

frame_captured = False
try:
    import cv2
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay"
    for test_url in urls_to_test:
        print(f"  🎥 Oqim ochilmoqda: {test_url} ...")
        cap = cv2.VideoCapture(test_url, cv2.CAP_FFMPEG)
        if cap.isOpened():
            ret, frame = cap.read()
            cap.release()
            if ret and frame is not None:
                h, w = frame.shape[:2]
                print(f"  🎉 [MUVAFFAQIYAT] Kadr olindi! O'lcham: {w}x{h}")
                frame_captured = True
                break
            else:
                print("  ⚠️ Oqim ochildi, ammo kadr o'qib bo'lmadi.")
        else:
            print("  ❌ Ochib bo'lmadi.")
except ImportError:
    print("  ⚠️ OpenCV kutubxonasi o'rnatilmagan.")

print("\n" + "="*65)
if frame_captured:
    print("🎉 PTZ KAMERA 100% ISHLAMOQDA! VR VA HUD DA TO'LIQ KO'RINADI!")
elif rtsp_open or onvif_open:
    print("⚠️ Kamera tarmoqda bor, ammo video kadr olinmadi. RTSP manzili yoki parolini tekshirish kerak.")
else:
    print("❌ Kamera bilan aloqa yo'q. LAN kabeli, quvvat va IP sozlamalarini tekshiring.")
print("="*65 + "\n")
