#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
🛡️ QALQON — CP-159-1 (V380) PTZ Kamera Avtomatik Ishga Tushiruvchisi (Raspberry Pi)
=============================================================================
Vazifalari:
1. eth0 (LAN) portiga 192.168.1.10 statik IP manzilini biriktirish va marshrutlash.
2. Ichki SO_BINDTODEVICE bilan mustahkamlangan DHCP serveri orqali kameraga 192.168.1.100 berish.
3. Statik ARP (00:55:7B:11:C6:15) yordamida "No route to host" xatosini butunlay yo'q qilish.
4. Kamera portlari (554 RTSP, 8899 ONVIF) tayyor bo'lishini kutib, so'ng 8090-portda camera_server ni ishga tushirish.
5. Natijada VR va HUD dagi 3-linzali (Panorama, PTZ, O'ng, Chap) video oqimi 100% ochiladi!
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

CAMERA_MAC = "00:55:7B:11:C6:15"
CAMERA_IP = "192.168.1.100"
PI_ETH_IP = "192.168.1.10"

def configure_network():
    """eth0 interfeysiga 192.168.1.10/24 berish va marshrutni o'rnatish"""
    print(f"🔌 [PTZ Kamera] eth0 LAN interfeysi sozlanmoqda ({PI_ETH_IP}/24)...")
    cmds = [
        ["sudo", "ip", "link", "set", "eth0", "up"],
        ["sudo", "ip", "addr", "replace", f"{PI_ETH_IP}/24", "dev", "eth0"],
        ["sudo", "ip", "route", "replace", "192.168.1.0/24", "dev", "eth0", "src", PI_ETH_IP],
        # Statik ARP yozuvi — ARP so'rovlari kutmasdan to'g'ridan-to'g'ri Ethernet kadrlarini yuborish uchun
        ["sudo", "ip", "neigh", "replace", CAMERA_IP, "lladdr", CAMERA_MAC.lower(), "dev", "eth0", "nud", "permanent"]
    ]
    for c in cmds:
        try:
            subprocess.run(c, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

def run_mini_dhcp(server_ip=PI_ETH_IP, client_ip=CAMERA_IP):
    """Mini DHCP server: kameraga 192.168.1.100 manzilini taqdim etadi"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        # SO_BINDTODEVICE (25) faqat eth0 orqali yuborish va qabul qilishni ta'minlaydi (wlan0 ga chiqib ketmasligi uchun)
        try:
            s.setsockopt(socket.SOL_SOCKET, 25, b"eth0\x00")
        except Exception as e:
            print(f"ℹ️ [PTZ DHCP] SO_BINDTODEVICE: {e}")
        s.bind(('', 67))
        print(f"📡 [PTZ DHCP] Mini-DHCP server 67-portda eth0 da tayyor...")
    except Exception as e:
        print(f"ℹ️ [PTZ DHCP] Tizim DHCP si faol yoki ruxsat cheklangan: {e}")
        return

    while True:
        try:
            data, addr = s.recvfrom(1024)
            if len(data) < 240 or data[0] != 1:  # Faqat BOOTREQUEST
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

            # 1 (DISCOVER) -> 2 (OFFER)
            # 3 (REQUEST)  -> 5 (ACK)
            resp_type = 2 if msg_type == 1 else (5 if msg_type == 3 else 0)
            if not resp_type:
                continue

            reply = bytearray(300)
            reply[0] = 2  # BOOTREPLY
            reply[1] = 1  # Ethernet
            reply[2] = 6  # MAC len
            reply[3] = 0  # hops
            reply[4:8] = xid
            reply[8:10] = b'\x00\x00'
            reply[10:12] = b'\x80\x00' # Broadcast bayrog'i (0x8000)
            reply[12:16] = b'\x00\x00\x00\x00'
            reply[16:20] = socket.inet_aton(client_ip)  # yiaddr (192.168.1.100)
            reply[20:24] = socket.inet_aton(server_ip)  # siaddr (192.168.1.10)
            reply[24:28] = b'\x00\x00\x00\x00'
            reply[28:34] = mac
            reply[34:236] = b'\x00' * (236 - 34)
            reply[236:240] = bytes([99, 130, 83, 99])  # Magic Cookie

            options = bytearray()
            options.extend([53, 1, resp_type])
            options.extend([54, 4] + list(socket.inet_aton(server_ip)))
            options.extend([51, 4, 0, 1, 81, 128])  # 1 kun lease
            options.extend([1, 4, 255, 255, 255, 0])  # Subnet 255.255.255.0
            options.extend([3, 4] + list(socket.inet_aton(server_ip)))  # Router
            options.extend([6, 4] + list(socket.inet_aton(server_ip)))  # DNS
            options.append(255)

            reply[240:240+len(options)] = options
            full_pkt = reply[:240+len(options)]

            # Ikkala manzilga yuboramiz (global broadcast va tarmoq broadcasti)
            for bcast in ('255.255.255.255', '192.168.1.255'):
                try:
                    s.sendto(full_pkt, (bcast, 68))
                except Exception:
                    pass

            mac_str = ':'.join(f'{b:02X}' for b in mac)
            action = "OFFER" if resp_type == 2 else "ACK"
            if resp_type == 5:
                print(f"🎉 [PTZ DHCP] Kamera ({mac_str}) IP ni QABUL QILDI: {client_ip} (ACK)!")
            else:
                print(f"✅ [PTZ DHCP] Kamera ({mac_str}) ga taklif yuborildi: {client_ip} (OFFER)")
        except Exception:
            time.sleep(0.5)

def wait_for_camera(host=CAMERA_IP, ports=(554, 8899), timeout=25):
    """Kamera portlari ochilishini kutish (No route to host xatosini oldini olish)"""
    print(f"⏳ [PTZ Kamera] {host} ning 554/8899 portlari ochilishi kutilmoqda...")
    start = time.time()
    while time.time() - start < timeout:
        for port in ports:
            try:
                with socket.create_connection((host, port), timeout=0.8):
                    print(f"✅ [PTZ Kamera] {host}:{port} bilan aloqa o'rnatildi!")
                    return True
            except (socket.timeout, OSError):
                pass
        time.sleep(1.0)
    print("ℹ️ [PTZ Kamera] Kutish yakunlandi, PTZ server ishga tushirilmoqda...")
    return False

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
    env["CAMERA_HOST"] = CAMERA_IP
    env["CAMERA_RTSP_URL"] = f"rtsp://{CAMERA_IP}:554/live/ch00_0"
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
    wait_for_camera(timeout=15)
    run_camera_server()
