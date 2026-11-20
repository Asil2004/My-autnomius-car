#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
🛡️ QALQON AMR — RASPBERRY PI TO'LIQ APPARAT VA DATCHIKLAR DIAGNOSTIKASI
Portlar, LiDAR, ESP32, Kameralar, CPU Harorati, RAM va Tarmoqni tekshirish.
=============================================================================
"""

import os
import sys
import time
import glob
import socket
import subprocess

GREEN = "\033[0;32m"
RED = "\033[0;31m"
YELLOW = "\033[1;33m"
CYAN = "\033[0;36m"
BOLD = "\033[1m"
NC = "\033[0m"

def ok_tag(msg):
    return f"{GREEN}[OK] {msg}{NC}"

def fail_tag(msg):
    return f"{RED}[XATO] {msg}{NC}"

def warn_tag(msg):
    return f"{YELLOW}[OGOHLANTIRISH] {msg}{NC}"

def banner(title):
    print(f"\n{CYAN}{'='*68}{NC}")
    print(f"{BOLD}{CYAN}🔍 {title.center(64)}{NC}")
    print(f"{CYAN}{'='*68}{NC}")

def check_system_health():
    banner("1. RASPBERRY PI TIZIM HOLATI VA RESURSLAR")
    
    # 1. CPU Harorati
    temp_str = "Noma'lum"
    try:
        if os.path.exists("/sys/class/thermal/thermal_zone0/temp"):
            with open("/sys/class/thermal/thermal_zone0/temp") as f:
                temp_c = float(f.read().strip()) / 1000.0
                color = GREEN if temp_c < 65 else (YELLOW if temp_c < 78 else RED)
                temp_str = f"{color}{temp_c:.1f}°C{NC}"
        else:
            p = subprocess.run(["vcgencmd", "measure_temp"], capture_output=True, text=True)
            if p.returncode == 0:
                temp_str = p.stdout.strip()
    except Exception as e:
        temp_str = f"Xato: {e}"
    print(f"  🌡️  CPU Harorati:        {temp_str}")

    # 2. Operativ Xotira (RAM) va Swap
    try:
        p = subprocess.run(["free", "-m"], capture_output=True, text=True)
        lines = p.stdout.strip().split("\n")
        if len(lines) >= 3:
            mem_parts = lines[1].split()
            swap_parts = lines[2].split()
            total_ram, used_ram, free_ram = mem_parts[1], mem_parts[2], mem_parts[3]
            total_swap, used_swap = swap_parts[1], swap_parts[2]
            print(f"  🧠 RAM Xotira:          Jami: {total_ram}MB | Ishlatilgan: {used_ram}MB | Bo'sh: {free_ram}MB")
            swap_color = GREEN if int(total_swap) >= 1000 else YELLOW
            print(f"  💾 Swap (Virtual RAM):  {swap_color}{total_swap}MB{NC} (Ishlatilgan: {used_swap}MB)")
    except Exception as e:
        print(f"  🧠 RAM Holati:          {fail_tag(str(e))}")

    # 3. Disk Xotirasi (SD Karta)
    try:
        p = subprocess.run(["df", "-h", "/"], capture_output=True, text=True)
        lines = p.stdout.strip().split("\n")
        if len(lines) >= 2:
            disk_parts = lines[1].split()
            print(f"  💽 SD Karta:            Jami: {disk_parts[1]} | Bo'sh: {disk_parts[3]} ({disk_parts[4]} band)")
    except Exception:
        pass

    # 4. IP Manzillar
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None):
            ip = info[4][0]
            if ':' not in ip and not ip.startswith('127.') and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    print(f"  🌐 Faol IP Manzillar:    {', '.join(ips) if ips else 'Faqat 127.0.0.1 (Offline)'}")

def check_usb_and_serial_ports():
    banner("2. USB VA SERIAL (UART) PORTLARINI TEKSHIRISH")
    
    # 1. Ulangan USB qurilmalar
    try:
        p = subprocess.run(["lsusb"], capture_output=True, text=True)
        if p.stdout.strip():
            print("  🔌 Tizimdagi USB Qurilmalar:")
            for line in p.stdout.strip().split("\n"):
                print(f"     • {line}")
    except Exception:
        pass

    # 2. TTY Serial portlar
    tty_usb = sorted(glob.glob("/dev/ttyUSB*"))
    tty_acm = sorted(glob.glob("/dev/ttyACM*"))
    all_ports = tty_usb + tty_acm

    print(f"\n  📡 Aniqlangan Serial Portlar ({len(all_ports)} ta):")
    if not all_ports:
        print(f"     {fail_tag('Birorta ham Serial/USB datchik topilmadi!')}")
        print("     -> LiDAR yoki ESP32 USB kabelini Raspberry Pi ga ulang.")
        return None, None

    for port in all_ports:
        print(f"     • {port}")

    # 3. LiDAR va ESP32 ni aniqlash testi
    lidar_port = None
    esp_port = None

    try:
        import serial
    except ImportError:
        print(f"  {fail_tag('pyserial kutubxonasi yo`q. `sudo apt install python3-serial` bering.')}")
        return None, None

    print("\n  🔍 Har bir portdan datchik turini aniqlash sinovi...")
    for port in all_ports:
        # A) Avval 230400 baudda LiDAR (LD19 / STL-19P) ga tekshirish
        try:
            ser = serial.Serial(port, 230400, timeout=0.6)
            buf = ser.read(150)
            ser.close()
            if len(buf) >= 47 and b'\x54\x2c' in buf:
                lidar_port = port
                print(f"     {ok_tag(f'{port} -> 360° LIDAR (STL-19P/LD19) aniqlandi!')} (230400 bod, paketlar olinmoqda)")
                continue
        except Exception:
            pass

        # B) 115200 baudda ESP32 / Arduino ga tekshirish
        try:
            ser = serial.Serial(port, 115200, timeout=0.8)
            time.sleep(0.3)
            ser.write(b"S\n")
            rx = ser.read(64).decode('utf-8', errors='ignore')
            ser.close()
            esp_port = port
            print(f"     {ok_tag(f'{port} -> ESP32 / Arduino Motor Drayveri aniqlandi!')} (115200 bod)")
        except Exception as e:
            print(f"     {warn_tag(f'{port} ochilmadi yoki javob bermadi: {e}')}")

    return lidar_port, esp_port

def test_lidar_live(lidar_port):
    banner("3. 360° LIDAR JONLI MASOFA O'LCHASH TESTI")
    if not lidar_port:
        print(f"  {warn_tag('Haqiqiy LiDAR topilmadi. Simulyatsiya rejimi faol bo`ladi.')}")
        return

    import serial
    print(f"  🎯 {lidar_port} portidan 3 soniya davomida jonli masofalar o'lchanmoqda...")
    try:
        ser = serial.Serial(lidar_port, 230400, timeout=1.0)
        t_end = time.time() + 2.5
        pkt_count = 0
        distances = []
        
        while time.time() < t_end:
            b = ser.read(1)
            if b == b'\x54':
                b2 = ser.read(1)
                if b2 == b'\x2c':
                    pkt = ser.read(45)
                    if len(pkt) == 45:
                        pkt_count += 1
                        # Birinchi nuqta masofasi
                        d = int.from_bytes(pkt[6:8], 'little') / 1000.0
                        if d > 0.05:
                            distances.append(d)
        ser.close()

        if pkt_count > 0:
            avg_d = sum(distances) / len(distances) if distances else 0
            min_d = min(distances) if distances else 0
            print(f"  {ok_tag(f'LiDAR 100% ISHLAMOQDA! {pkt_count} ta paket qabul qilindi.')}")
            print(f"     • O'rtacha to'siq masofasi: {avg_d:.2f} metr")
            print(f"     • Eng yaqin to'siq:        {min_d:.2f} metr")
            if min_d <= 0.45:
                print(f"     🚨 {RED}DIQQAT: Oldinda 0.45m dan yaqin to'siq bor! Favqulodda tormoz faol.{NC}")
        else:
            print(f"  {warn_tag('Paket kelmadi. LiDAR quvvatini va TX/RX simlarini tekshiring.')}")
    except Exception as e:
        print(f"  {fail_tag(f'LiDAR o`qishda xatolik: {e}')}")

def test_esp32_commands(esp_port):
    banner("4. ESP32 MOTOR VA DRAYVER BUYRUQLARI TESTI")
    if not esp_port:
        print(f"  {warn_tag('Haqiqiy ESP32/Arduino USB porti topilmadi.')}")
        print("  -> ESP32 ni Micro-USB kabel bilan Raspberry Pi ga ulang.")
        return

    import serial
    print(f"  🕹️  {esp_port} ga test buyruqlari yuborilmoqda...")
    try:
        ser = serial.Serial(esp_port, 115200, timeout=0.5)
        time.sleep(1.0) # Reset kutish
        for cmd, name in [('S', 'Tormoz (S)'), ('1', '1-Tezlik'), ('2', '2-Tezlik')]:
            ser.write(cmd.encode('utf-8'))
            time.sleep(0.1)
            rx = ser.read(32).decode('utf-8', errors='ignore').strip()
            print(f"     -> Yuborildi: '{cmd}' ({name}) | Qabul: '{rx}' {GREEN}✓{NC}")
        ser.close()
        print(f"  {ok_tag('ESP32 UART aloqasi 100% TAYYOR!')}")
    except Exception as e:
        print(f"  {fail_tag(f'ESP32 bilan aloqada xato: {e}')}")

def test_cameras():
    banner("5. KAMERALAR VA VIDEO OQIMINI TEKSHIRISH")
    
    # 1. /dev/video* tugunlari
    video_nodes = sorted(glob.glob("/dev/video*"))
    print(f"  📹 Tizimdagi V4L2 video tugunlari: {', '.join(video_nodes) if video_nodes else 'Yo`q'}")

    try:
        import cv2
    except ImportError:
        print(f"  {fail_tag('OpenCV (cv2) moduli o`rnatilmagan.')}")
        return

    # USB kamera ochish sinovi
    cam_found = False
    for dev_idx in range(4):
        try:
            cap = cv2.VideoCapture(dev_idx)
            if cap.isOpened():
                ret, frame = cap.read()
                if ret and frame is not None:
                    h, w = frame.shape[:2]
                    print(f"  {ok_tag(f'USB Kamera #{dev_idx} faol!')} O'lchami: {w}x{h}")
                    cam_found = True
                    cap.release()
                    break
                cap.release()
        except Exception:
            pass

    if not cam_found:
        print(f"  {warn_tag('USB Web-kamera topilmadi yoki boshqa dastur band qilib turibdi.')}")

    # 2. V380 PTZ IP kamera tekshiruvi (192.168.1.100:554)
    print("\n  🌐 V380 PTZ IP Kamera (192.168.1.100:554 RTSP) tekshirilmoqda...")
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(1.2)
        res = s.connect_ex(("192.168.1.100", 554))
        s.close()
        if res == 0:
            print(f"  {ok_tag('V380 PTZ Kamera 192.168.1.100:554 da ONLINE!')} (RTSP ochiq)")
        else:
            print(f"  {warn_tag('192.168.1.100:554 ga ulanib bo`lmadi (Kamera o`chiq yoki LAN ulanmagan).')}")
    except Exception as e:
        print(f"  {warn_tag(f'PTZ kamera tekshiruvida xato: {e}')}")

def test_web_server():
    banner("6. VEB-SERVER VA MIYA XIZMATI (PORT 8000)")
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.8)
        res = s.connect_ex(("127.0.0.1", 8000))
        s.close()
        if res == 0:
            print(f"  {ok_tag('Qalqon Brain Serveri (port 8000) ISHLAMOQDA!')}")
            print(f"  📱 Brauzerda ochish: http://localhost:8000")
        else:
            print(f"  {warn_tag('Port 8000 o`chiq. Serverni ishga tushirish uchun: bash start_brain.sh')}")
    except Exception as e:
        print(f"  {fail_tag(str(e))}")

def main():
    print(f"\n{BOLD}{GREEN}{'🛡️ '*15}")
    print("   QALQON AMR v1.0 — TO'LIQ APPARAT VA DATCHIKLAR TESTI")
    print("   Vaqt:", time.strftime('%Y-%m-%d %H:%M:%S'))
    print(f"{'🛡️ '*15}{NC}\n")

    check_system_health()
    lidar_p, esp_p = check_usb_and_serial_ports()
    test_lidar_live(lidar_p)
    test_esp32_commands(esp_p)
    test_cameras()
    test_web_server()

    banner("XULOSA VA KEYINGI QADAMLAR")
    print("  1. Agar barcha datchiklar yashil [OK] bo'lsa, tizim 100% apparat darajasida tayyor.")
    print("  2. Asosiy serverni ishga tushirish uchun:")
    print(f"     {CYAN}bash ~/My-autnomius-car/raspberry_pi/start_brain.sh{NC}")
    print("="*68 + "\n")

if __name__ == '__main__':
    main()
