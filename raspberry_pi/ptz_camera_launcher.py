#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
🛡️ QALQON — CP-159-1 (V380) PTZ Kamera Avtomatik Ishga Tushiruvchisi (Raspberry Pi)
=============================================================================
Vazifalari:
1. eth0 (LAN) portiga 192.168.1.10 statik IP manzilini bog'lash.
2. Ichki yengil Python DHCP serveri orqali kameraga 192.168.1.100 berish.
3. camera_server/main.py ni 8090-portda ishga tushirish.
4. Natijada VR va HUD dagi 3-linzali (Panorama, PTZ, O'ng, Chap) video oqim ochiladi!
"""

import os
import sys
import time
import socket
import subprocess
import threading

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
CAM_DIR = os.path.join(REPO_DIR, "camera_server")

def configure_network():
    """eth0 interfeysiga 192.168.1.10/24 berish"""
    print("🔌 [PTZ Kamera] eth0 LAN interfeysi sozlanmoqda (192.168.1.10/24)...")
    try:
        # NetworkManager orqali yoki to'g'ridan-to'g'ri ip buyrug'i bilan
        subprocess.run(["sudo", "ip", "link", "set", "eth0", "up"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["sudo", "ip", "addr", "add", "192.168.1.10/24", "dev", "eth0"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        print(f"⚠️ [PTZ Network]: {e}")

def run_mini_dhcp(server_ip='192.168.1.10', client_ip='192.168.1.100'):
    """Mini DHCP server: kameraga 192.168.1.100 manzilini taqdim etadi"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.bind(('', 67))
        print("📡 [PTZ DHCP] Mini-DHCP server 67-portda tayyor (Kamerani kutmoqda)...")
    except Exception as e:
        # Agar dnsmasq allaqachon ishlayotgan bo'lsa
        print(f"ℹ️ [PTZ DHCP] Tizim DHCP si faol yoki ruxsat cheklangan: {e}")
        return

    while True:
        try:
            data, addr = s.recvfrom(1024)
            if len(data) < 240 or data[0] != 1:  # BOOTREQUEST
                continue
            xid = data[4:8]
            mac = data[28:34]

            # Option 53 (DHCP Message Type)
            msg_type = 0
            idx = 240
            while idx < len(data) and data[idx] != 255:
                if data[idx] == 0:
                    idx += 1
                    continue
                opt_len = data[idx+1]
                if data[idx] == 53 and opt_len >= 1:
                    msg_type = data[idx+2]
                    break
                idx += 2 + opt_len

            resp_type = 2 if msg_type == 1 else (5 if msg_type == 3 else 0)
            if not resp_type:
                continue

            reply = bytearray(300)
            reply[0] = 2  # BOOTREPLY
            reply[1] = 1  # Ethernet
            reply[2] = 6  # MAC len
            reply[4:8] = xid
            reply[10] = 0x80  # Broadcast flag
            reply[16:20] = socket.inet_aton(client_ip)  # yiaddr (192.168.1.100)
            reply[20:24] = socket.inet_aton(server_ip)  # siaddr (192.168.1.10)
            reply[28:34] = mac
            reply[236:240] = bytes([99, 130, 83, 99])  # Magic Cookie

            options = bytearray()
            options.extend([53, 1, resp_type])
            options.extend([54, 4] + list(socket.inet_aton(server_ip)))
            options.extend([51, 4, 0, 1, 81, 128])  # 1 kun lease
            options.extend([1, 4, 255, 255, 255, 0])  # Subnet
            options.extend([3, 4] + list(socket.inet_aton(server_ip)))  # Router
            options.extend([6, 4] + list(socket.inet_aton(server_ip)))  # DNS
            options.append(255)

            reply[240:240+len(options)] = options
            s.sendto(reply, ('255.255.255.255', 68))
            mac_str = ':'.join(f'{b:02X}' for b in mac)
            action = "OFFER" if resp_type == 2 else "ACK"
            print(f"✅ [PTZ DHCP] Kamera ({mac_str}) ga IP berildi: {client_ip} ({action})")
        except Exception:
            time.sleep(1)

def run_camera_server():
    """8090-portda camera_server/main.py ni ishga tushirish"""
    if not os.path.isdir(CAM_DIR):
        print(f"⚠️ [PTZ Kamera] {CAM_DIR} papkasi topilmadi!")
        return

    # 8090 portni tozalash
    try:
        subprocess.run(["fuser", "-k", "-9", "8090/tcp"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

    env = os.environ.copy()
    env["CAMERA_HOST"] = "192.168.1.100"
    env["CAMERA_RTSP_URL"] = "rtsp://192.168.1.100:554/live/ch00_0"
    env["CAMERA_ONVIF_PORT"] = "8899"
    env["CAMERA_MAX_WIDTH"] = "1280"
    env["CAMERA_JPEG_QUALITY"] = "80"

    print("🚀 [PTZ Kamera] 8090-portda PTZ server ishga tushirilmoqda...")
    cmd = [sys.executable, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8090", "--log-level", "warning"]
    try:
        subprocess.run(cmd, cwd=CAM_DIR, env=env)
    except Exception as e:
        print(f"⚠️ [PTZ Server Error]: {e}")

if __name__ == "__main__":
    configure_network()
    t_dhcp = threading.Thread(target=run_mini_dhcp, daemon=True)
    t_dhcp.start()
    run_camera_server()
