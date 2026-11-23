#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
🛡️ QALQON — PTZ Kamera LAN Mukammal Diagnostika & Avto-Ulash Skripti
=============================================================================
Ushbu skript:
1. Fizik ulanishni (RJ45 kabel, link carrier, chiroqlar) tekshiradi.
2. eth0 ga 192.168.1.10 IP beradi va SO_BINDTODEVICE bilan DHCP serverni yoqadi.
3. Kamera tarmoqqa ulanganda unga 192.168.1.100 beradi (OFFER + ACK).
4. Agar kamera statik IP da bo'lsa, tarmoqdagi barcha paketlarni tinglab IP sini topadi.
5. 554 (RTSP), 8899 (ONVIF) portlarini tekshiradi va OpenCV bilan video kadri oladi.
=============================================================================
"""

import os
import sys
import time
import socket
import subprocess
import threading

def run_cmd(cmd):
    try:
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        return res.stdout.strip(), res.returncode
    except Exception as e:
        return str(e), 1

print("\n" + "="*70)
print("🔍 PTZ KAMERA LAN TO'LIQ DIAGNOSTIKASI VA AVTO-ULANISHI...")
print("="*70)

# 1. Fizik kabel (Carrier / Link) tekshiruvi
print("\n[1/6] Fizik kabel va elektr signali (Carrier Link) tekshirilmoqda...")
run_cmd("sudo ip link set eth0 up")
time.sleep(1)

carrier = "0"
try:
    with open("/sys/class/net/eth0/carrier", "r") as f:
        carrier = f.read().strip()
except Exception:
    pass

operstate = "unknown"
try:
    with open("/sys/class/net/eth0/operstate", "r") as f:
        operstate = f.read().strip()
except Exception:
    pass

if carrier == "1" or operstate == "up":
    print("  ✅ Fizik kabel ulangan! (RJ45 portda link va elektr signali mavjud)")
else:
    print("  ⚠️ DIQQAT: eth0 da fizik signal (Carrier) yo'q yoki link o'chirilgan!")
    print("     - RJ45 LAN kabeli Raspberry Pi va Kamera portlariga qattiq qadalganini tekshiring.")
    print("     - Kamera 12V quvvat bloki rozetkaga tiqilganini va kamera yoqilganini tekshiring.")

# 2. eth0 IP va marshrut sozlash
print("\n[2/6] eth0 interfeysi sozlanmoqda (192.168.1.10/24)...")
run_cmd("sudo ip addr replace 192.168.1.10/24 dev eth0 2>/dev/null || true")
run_cmd("sudo ip route replace 192.168.1.0/24 dev eth0 src 192.168.1.10 2>/dev/null || true")
# 00:55:7B:11:C6:15 uchun statik ARP
run_cmd("sudo ip neigh replace 192.168.1.100 lladdr 00:55:7b:11:c6:15 dev eth0 nud permanent 2>/dev/null || true")

out, _ = run_cmd("ip -4 addr show eth0")
if "192.168.1.10" in out:
    print("  ✅ eth0 ga 192.168.1.10/24 IP berildi va marshrut o'rnatildi.")
else:
    print(f"  ⚠️ eth0 holati: {out}")

# 3. Mini-DHCP serverni ishga tushirish (Kameraga IP berish uchun)
print("\n[3/6] eth0 da Mini-DHCP server faollashtirilmoqda...")
dhcp_assigned = threading.Event()
detected_cam_ip = ["192.168.1.100"]

def dhcp_worker():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        try:
            s.setsockopt(socket.SOL_SOCKET, 25, b"eth0\x00")
        except Exception:
            pass
        s.bind(('', 67))
        s.settimeout(2.0)
    except Exception as e:
        # Port band bo'lsa (masalan ptz_camera_launcher ishlab turgan bo'lsa)
        return

    start_t = time.time()
    while time.time() - start_t < 15 and not dhcp_assigned.is_set():
        try:
            data, addr = s.recvfrom(1024)
            if len(data) < 240 or data[0] != 1:
                continue
            xid = data[4:8]
            mac = data[28:34]
            mac_str = ':'.join(f'{b:02X}' for b in mac)

            msg_type = 0
            idx = 240
            while idx < len(data) and data[idx] != 255:
                if data[idx] == 0: idx += 1; continue
                opt_len = data[idx+1]
                if data[idx] == 53 and opt_len >= 1:
                    msg_type = data[idx+2]
                    break
                idx += 2 + opt_len

            resp_type = 2 if msg_type == 1 else (5 if msg_type == 3 else 0)
            if not resp_type: continue

            client_ip = detected_cam_ip[0]
            server_ip = "192.168.1.10"

            reply = bytearray(300)
            reply[0] = 2; reply[1] = 1; reply[2] = 6
            reply[4:8] = xid
            reply[10:12] = b'\x80\x00'
            reply[16:20] = socket.inet_aton(client_ip)
            reply[20:24] = socket.inet_aton(server_ip)
            reply[28:34] = mac
            reply[236:240] = bytes([99, 130, 83, 99])

            opts = bytearray()
            opts.extend([53, 1, resp_type])
            opts.extend([54, 4] + list(socket.inet_aton(server_ip)))
            opts.extend([51, 4, 0, 1, 81, 128])
            opts.extend([1, 4, 255, 255, 255, 0])
            opts.extend([3, 4] + list(socket.inet_aton(server_ip)))
            opts.extend([6, 4] + list(socket.inet_aton(server_ip)))
            opts.append(255)

            reply[240:240+len(opts)] = opts
            pkt = reply[:240+len(opts)]

            for bcast in ('255.255.255.255', '192.168.1.255'):
                try: s.sendto(pkt, (bcast, 68))
                except Exception: pass

            if resp_type == 5:
                print(f"  🎉 [DHCP ACK] Kamera ({mac_str}) ga 192.168.1.100 muvaffaqiyatli berildi!")
                dhcp_assigned.set()
            else:
                print(f"  📡 [DHCP OFFER] Kamera ({mac_str}) ga 192.168.1.100 taklif etildi...")
        except socket.timeout:
            continue
        except Exception:
            break
    try: s.close()
    except Exception: pass

t_dhcp = threading.Thread(target=dhcp_worker, daemon=True)
t_dhcp.start()

print("  ⏳ Kameradan DHCP so'rovi kutilmoqda (10 soniya)...")
dhcp_assigned.wait(timeout=10)

# 4. ARP jadvali va faol IP larni qidirish
print("\n[4/6] Tarmoqdagi qurilma IP manzili aniqlanmoqda...")
run_cmd("ping -b -c 1 -w 1 192.168.1.255 2>/dev/null || true")

found_ips = []
try:
    with open("/proc/net/arp", "r") as f:
        for line in f.readlines()[1:]:
            parts = line.split()
            if len(parts) >= 6 and parts[5] == "eth0":
                ip, mac = parts[0], parts[3]
                if mac.lower() != "00:00:00:00:00:00":
                    print(f"  📡 eth0 da faol qurilma: IP={ip} | MAC={mac}")
                    found_ips.append(ip)
except Exception as e:
    print(f"  ⚠️ ARP xatosi: {e}")

target_ip = "192.168.1.100"
if found_ips:
    target_ip = found_ips[0]
print(f"  🎯 Tekshiriladigan kamera IP si: {target_ip}")

# 5. Ping va Portlar tekshiruvi
print(f"\n[5/6] {target_ip} ga Ping va portlar tekshirilmoqda...")
out, code = run_cmd(f"ping -c 2 -W 2 {target_ip}")
if code == 0:
    print(f"  ✅ {target_ip} Ping ga javob berdi!")
else:
    print(f"  ⚠️ {target_ip} Ping ga javob bermadi.")

rtsp_ok = False
for port, name in [(554, "RTSP"), (8899, "ONVIF"), (80, "HTTP")]:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(1.5)
        res = s.connect_ex((target_ip, port))
        s.close()
        if res == 0:
            print(f"  ✅ Port {port} ({name}) OCHIQ!")
            if port == 554: rtsp_ok = True
        else:
            print(f"  ❌ Port {port} ({name}) YOPIQ (kod {res})")
    except Exception as e:
        print(f"  ❌ Port {port} ({name}) xatosi: {e}")

# 6. OpenCV bilan test kadrini olish
print("\n[6/6] RTSP orqali video oqimi sinab ko'rilmoqda...")
urls = [
    f"rtsp://{target_ip}:554/live/ch00_0",
    f"rtsp://{target_ip}:554/live/ch0",
    f"rtsp://{target_ip}:554/onvif1",
    f"rtsp://admin:admin@{target_ip}:554/live/ch00_0"
]

frame_captured = False
try:
    import cv2
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay"
    for u in urls:
        print(f"  🎥 Oqim tekshirilmoqda: {u} ...")
        cap = cv2.VideoCapture(u, cv2.CAP_FFMPEG)
        if cap.isOpened():
            ret, frame = cap.read()
            cap.release()
            if ret and frame is not None:
                h, w = frame.shape[:2]
                print(f"  🎉 [MUVAFFAQIYAT] Kadr olindi! O'lchami: {w}x{h}")
                cv2.imwrite("/tmp/ptz_test.jpg", frame)
                frame_captured = True
                break
        print("  ❌ Ushbu URL ochilmadi.")
except Exception as e:
    print(f"  ⚠️ OpenCV xatosi: {e}")

print("\n" + "="*70)
if frame_captured:
    print("🎉 PTZ KAMERA 100% ISHLAMOQDA! VR VA HUD DA TO'LIQ KO'RINADI!")
elif rtsp_ok:
    print("⚠️ 554 RTSP porti ochiq, lekin URL yoki parol boshqacha bo'lishi mumkin.")
else:
    print("💡 XULOSA VA KEYINGI QADAMLAR:")
    if carrier != "1":
        print("1. RJ45 LAN kabeli Raspberry Pi va Kameraga to'liq ulanganini tekshiring.")
        print("2. Kameraning 12V 2A quvvat adapteri ulanganini tekshiring (chirog'i yonishi kerak).")
    else:
        print("1. Kameraning quvvatini uzib, 5 soniyadan so'ng qayta ulang (Reboot).")
        print("2. 'sudo bash ~/My-autnomius-car/raspberry_pi/start_brain.sh' ni ishga tushiring.")
print("="*70 + "\n")
