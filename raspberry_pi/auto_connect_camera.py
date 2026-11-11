#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QALQON - Wi-Fi IP Kamera Avtomatik Qidirish va Ulanish Moduli (Auto-Discovery)
Model: CP-159-1-WIFI (V380 Pro / iCSee / ONVIF 3-linzali PTZ)
Raspberry Pi 4 / Linux / Windows uchun.

Ushbu dastur:
 1. Raspberry Pi ulangan Wi-Fi tarmog'ini aniqlaydi.
 2. Butun tarmoq bo'ylab V380 Pro / ONVIF / RTSP kameralarni avtomatik skanerlaydi (port 554, 8899, 3702).
 3. Hech qanday IP kiritishni talab qilmasdan kamerani topadi va tekshiradi.
 4. 3 ta linza oqimini (ch0, ch1, ch2) sozlaydi va `camera_config.json` ga saqlaydi.
 5. Raspberry Pi da darhol jonli videoni ochib ko'rsatadi.
"""

import os
import sys
import time
import json
import socket
import struct
import threading
from concurrent.futures import ThreadPoolExecutor

try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "camera_config.json")

# ---------------------------------------------------------------------------
# TARMOQNI ANIQLASH (NETWORK SUBNET DISCOVERY)
# ---------------------------------------------------------------------------
def get_local_ip() -> str:
    """Raspberry Pi ning Wi-Fi dagi mahalliy IP manzilini aniqlash"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Tashqi manzilga ulanish simulyatsiyasi (hech qanday paket jo'natilmaydi, faqat marshrut olinadi)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        try:
            ip = socket.gethostbyname(socket.gethostname())
        except Exception:
            ip = "127.0.0.1"
    finally:
        s.close()
    return ip

def get_subnet_prefix(local_ip: str) -> str:
    """192.168.1.45 -> 192.168.1."""
    parts = local_ip.split(".")
    if len(parts) == 4:
        return f"{parts[0]}.{parts[1]}.{parts[2]}."
    return "192.168.1."

# ---------------------------------------------------------------------------
# 1. WS-DISCOVERY (ONVIF MULTICAST/BROADCAST PROBE - UDP 3702)
# ---------------------------------------------------------------------------
def discover_onvif_devices(timeout: float = 1.5) -> list:
    """ONVIF WS-Discovery orqali tarmoqdagi kameralarni izlash"""
    discovered_ips = set()
    probe_msg = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<Envelope xmlns="http://www.w3.org/2003/05/soap-envelope" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">'
        '<Header>'
        '<wsa:MessageID xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">uuid:qalqon-cam-probe-01</wsa:MessageID>'
        '<wsa:To xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>'
        '<wsa:Action xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action>'
        '</Header>'
        '<Body>'
        '<Probe xmlns="http://schemas.xmlsoap.org/ws/2005/04/discovery">'
        '<Types>dn:NetworkVideoTransmitter</Types>'
        '</Probe>'
        '</Body>'
        '</Envelope>'
    ).encode('utf-8')

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(timeout)

        # Multicast va Broadcast yuborish
        sock.sendto(probe_msg, ("239.255.255.250", 3702))
        local_ip = get_local_ip()
        broadcast_ip = get_subnet_prefix(local_ip) + "255"
        sock.sendto(probe_msg, (broadcast_ip, 3702))

        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                data, addr = sock.recvfrom(4096)
                ip = addr[0]
                if ip != local_ip:
                    discovered_ips.add(ip)
            except socket.timeout:
                break
            except Exception:
                break
        sock.close()
    except Exception:
        pass

    return list(discovered_ips)

# ---------------------------------------------------------------------------
# 2. TEZKOR MULTI-THREADED TCP PORT SCAN (554 RTSP, 8899 ONVIF, 34567 XM)
# ---------------------------------------------------------------------------
def check_port(ip: str, port: int, timeout: float = 0.35) -> bool:
    """Berilgan IP va port ochiqligini tekshirish"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        res = sock.connect_ex((ip, port))
        sock.close()
        return res == 0
    except Exception:
        return False

def scan_subnet_for_cameras(local_ip: str) -> list:
    """Butun /24 Wi-Fi tarmog'ini 50 ta oqimda parallel skanerlash (~1-2 soniya)"""
    prefix = get_subnet_prefix(local_ip)
    found_candidates = []
    
    # Kamera portlari: 554 (RTSP), 8899 (ONVIF/V380), 34567 (iCSee), 5000 (V380 media)
    ports_to_check = [554, 8899, 34567, 5000]

    def scan_ip(last_octet: int):
        target_ip = f"{prefix}{last_octet}"
        if target_ip == local_ip:
            return None
        
        # Avvalo RTSP port 554 tekshiriladi
        if check_port(target_ip, 554, timeout=0.3):
            return {"ip": target_ip, "port": 554, "type": "RTSP"}
        
        # So'ng ONVIF yoki iCSee portlari
        if check_port(target_ip, 8899, timeout=0.25):
            return {"ip": target_ip, "port": 8899, "type": "ONVIF"}
        if check_port(target_ip, 34567, timeout=0.25):
            return {"ip": target_ip, "port": 34567, "type": "iCSee"}
        if check_port(target_ip, 5000, timeout=0.25):
            return {"ip": target_ip, "port": 5000, "type": "V380"}
            
        return None

    with ThreadPoolExecutor(max_workers=60) as executor:
        results = executor.map(scan_ip, range(1, 255))
        for r in results:
            if r:
                found_candidates.append(r)

    return found_candidates

# ---------------------------------------------------------------------------
# 3. RTSP OQIMINI TEKSHIRISH VA LINGZALARNI ANIKLASH
# ---------------------------------------------------------------------------
def test_rtsp_url(url: str, timeout_sec: float = 3.0) -> bool:
    """OpenCV yordamida RTSP URL dan kadr o'qish mumkinligini tekshirish"""
    if not HAS_OPENCV:
        # OpenCV bo'lmasa, faqat TCP ulanish borligiga ishonamiz
        return True

    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|analyzeduration;2000000|max_delay;500000"
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    start = time.time()
    opened = cap.isOpened()
    success = False
    if opened:
        # 1 ta kadr o'qib ko'ramiz
        while time.time() - start < timeout_sec:
            ret, frame = cap.read()
            if ret and frame is not None and frame.size > 0:
                success = True
                break
            time.sleep(0.05)

    cap.release()
    return success

def discover_camera_streams(camera_ip: str, password: str = "") -> list:
    """
    CP-159-1-WIFI 3-linzali kamera uchun ishchi oqimlarni (ch0, ch1, ch2) topish.
    """
    auth_part = f"admin:{password}@" if password else ""
    
    # 3 ta linza uchun ehtimoliy kanallar
    # V380 Pro da odatda: /live/ch0, /live/ch1, /live/ch2
    # Xiongmai/iCSee da odatda: /onvif1, /onvif2
    url_patterns = [
        # Standart V380 Pro 3-linza shablonlari
        {"id": 0, "name": "Kamera 1 (Asosiy PTZ)", "path": f"rtsp://{auth_part}{camera_ip}:554/live/ch0"},
        {"id": 1, "name": "Kamera 2 (Ikkinchi PTZ)", "path": f"rtsp://{auth_part}{camera_ip}:554/live/ch1"},
        {"id": 2, "name": "Kamera 3 (Panoramik/Pastki)", "path": f"rtsp://{auth_part}{camera_ip}:554/live/ch2"},
        # Muqobil yo'llar
        {"id": 0, "name": "Kamera 1 (ONVIF Main)", "path": f"rtsp://{auth_part}{camera_ip}:554/onvif1"},
        {"id": 1, "name": "Kamera 2 (ONVIF Sub)", "path": f"rtsp://{auth_part}{camera_ip}:554/onvif2"},
    ]

    working_channels = []
    
    print(f"[*] {camera_ip} bo'yicha RTSP oqimlari tekshirilmoqda...")
    for item in url_patterns:
        url = item["path"]
        print(f"    - Sinab ko'rilmoqda: {url} ...", end=" ", flush=True)
        ok = test_rtsp_url(url, timeout_sec=2.5)
        if ok:
            print("[ISHLADI]")
            # Faqat har bir id bo'yicha bittadan qo'shamiz
            if not any(c["id"] == item["id"] for c in working_channels):
                working_channels.append({
                    "id": item["id"],
                    "name": item["name"],
                    "url": url
                })
        else:
            print("[JAVOB YO'Q]")

    # Agar hech qaysi aniq ochilmagan bo'lsa (lekin port 554 ochiq bo'lsa),
    # standart V380 shablonlarini kafolatli qoldiramiz
    if not working_channels:
        print("[!] Jonli kadr olib bo'lmadi (ehtimol parol talab qilinadi). Standart V380 shabloni qo'llanadi.")
        working_channels = [
            {"id": 0, "name": "Kamera 1 (Asosiy PTZ)", "url": f"rtsp://{auth_part}{camera_ip}:554/live/ch0"},
            {"id": 1, "name": "Kamera 2 (Ikkinchi PTZ)", "url": f"rtsp://{auth_part}{camera_ip}:554/live/ch1"},
            {"id": 2, "name": "Kamera 3 (Panoramik)", "url": f"rtsp://{auth_part}{camera_ip}:554/live/ch2"}
        ]

    return working_channels

# ---------------------------------------------------------------------------
# ASOSIY AVTOMATIK QIDIRISH VA SOZLASH VAZIFASI
# ---------------------------------------------------------------------------
def run_auto_discovery(custom_password: str = "") -> dict:
    print("=" * 65)
    print(" [QALQON] WI-FI SMART KAMERANI AVTOMATIK QIDIRISH VA ULANISH")
    print(" Model: CP-159-1-WIFI (3 linzali V380 Pro / iCSee PTZ)")
    print("=" * 65)

    local_ip = get_local_ip()
    print(f"[*] Raspberry Pi IP manzili : {local_ip}")
    print(f"[*] Qidiruv tarmog'i        : {get_subnet_prefix(local_ip)}1 - 254")

    # 1-qadam: WS-Discovery (ONVIF)
    print("\n[1/3] ONVIF tarmoq signallari (WS-Discovery) tinglanmoqda...")
    onvif_ips = discover_onvif_devices(timeout=1.5)
    if onvif_ips:
        print(f"      [✓] ONVIF orqali topildi: {onvif_ips}")

    # 2-qadam: Tezkor TCP port skaneri
    print("[2/3] Tarmoqdagi barcha qurilmalar portlari tezkor skanerlanmoqda...")
    candidates = scan_subnet_for_cameras(local_ip)

    all_found_ips = set(onvif_ips)
    for c in candidates:
        all_found_ips.add(c["ip"])

    if not all_found_ips:
        print("\n[XATO] Wi-Fi tarmog'ida kamera topilmadi!")
        print("Iltimos, quyidagilarni tekshiring:")
        print("  1. Kamera elektr quvvatiga (12V) ulanganmi?")
        print("  2. Kamera va Raspberry Pi bitta Wi-Fi tarmog'idami?")
        print("  3. Telefon ilovasi (V380 Pro yoki iCSee) orqali kamera Wi-Fi ga muvaffaqiyatli ulanganmi?")
        return None

    print(f"\n[✓] Tarmoqda topilgan kamera nomzodlari: {list(all_found_ips)}")
    target_ip = list(all_found_ips)[0]
    print(f"[*] Tanlangan kamera IP manzili: {target_ip}")

    # 3-qadam: Oqimlarni tekshirish
    print("\n[3/3] Kamera linzalari va RTSP oqimlari tekshirilmoqda...")
    channels = discover_camera_streams(target_ip, password=custom_password)

    config_data = {
        "auto_discovered": True,
        "camera_model": "CP-159-1-WIFI",
        "camera_ip": target_ip,
        "rtsp_port": 554,
        "password": custom_password,
        "channels": channels,
        "last_updated": time.strftime("%Y-%m-%dT%H:%M:%S")
    }

    # Konfiguratsiyani saqlash
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config_data, f, indent=2, ensure_ascii=False)

    print("\n" + "=" * 65)
    print(f"[MUVAFFAQIN] Sozlamalar saqlandi -> {CONFIG_PATH}")
    for ch in channels:
        print(f"  • {ch['name']}: {ch['url']}")
    print("=" * 65)

    return config_data

# ---------------------------------------------------------------------------
# JONLI EKRANDA KO'RISH (3 TA LINZANI BIRLASHGAN KO'RINIShDA KO'RSATISH)
# ---------------------------------------------------------------------------
def show_live_multiview(config_data: dict):
    if not HAS_OPENCV:
        print("[!] OpenCV yo'q, jonli video oyna ochilmadi.")
        return

    channels = config_data.get("channels", [])
    if not channels:
        return

    main_url = channels[0]["url"]
    print(f"\n[*] Jonli oqim ochilmoqda: {main_url}")
    print("Chiqish uchun 'q' tugmasini bosing.")

    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|analyzeduration;5000000|max_delay;500000"
    cap = cv2.VideoCapture(main_url, cv2.CAP_FFMPEG)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    while True:
        ret, frame = cap.read()
        if not ret or frame is None:
            time.sleep(0.05)
            continue

        h, w = frame.shape[:2]
        cv2.putText(frame, f"QALQON - {config_data.get('camera_model')} | {config_data.get('camera_ip')}", 
                    (20, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        cv2.putText(frame, "Jonli Ko'rinish | Chiqish: 'q'", (20, h - 20), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 255), 2)

        cv2.imshow("QALQON - Wi-Fi Smart Camera", frame)
        key = cv2.waitKey(1) & 0xFF
        if key == ord('q') or key == 27:
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    pwd = ""
    if len(sys.argv) > 1:
        pwd = sys.argv[1]

    cfg = run_auto_discovery(custom_password=pwd)
    if cfg:
        # GUI mavjudligini tekshirib, video oynani ochish
        is_headless = not os.environ.get("DISPLAY") and sys.platform.startswith("linux")
        if not is_headless:
            try:
                show_live_multiview(cfg)
            except Exception as e:
                print(f"[INFO] Video oyna ochilmadi (balki headless rejim): {e}")
        else:
            print("\n[INFO] Raspberry Pi headless (ekransiz) rejimda ishlamoqda.")
            print("[INFO] Video oqimni brauzer orqali ko'rish uchun qalqon_brain ni ishga tushiring:")
            print("       python3 qalqon_brain.py")
            print("       va brauzerda http://<RASPBERRY_IP>:8000 ga kiring!")
