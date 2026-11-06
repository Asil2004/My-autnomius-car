#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
====================================================================
QALQON v1.0 — OQ GUMBAZ QOBIQ (FOMIKS 3-5 mm) LAZER KESIM GENERATORI
====================================================================
Ushbu skript Politsiya Roboti QALQON v1.0 ning tashqi oq sferik
korpusi (fomiks 3-5mm) uchun 1:1 masshtabdagi DXF va SVG lazer
kesim chizmalarini hamda interaktiv HTML vizual ko'rinishini yaratadi.

Qatlamlar (Layers):
  - CUT (Qizil / Red, 0.05mm): Lazer bilan to'liq kesib olish chiziqlari.
  - SCORE_BEND (Ko'k / Blue, 0.15mm): Yarim chuqurlikda chizish / qizdirib egish chiziqlari.
  - ANNOTATIONS (Oq / Qora): O'lchamlar, qismlar nomlari va markirovka.
====================================================================
"""

import math
import os
import ezdxf
from ezdxf import colors

OUTPUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "cad"))
os.makedirs(OUTPUT_DIR, exist_ok=True)

DXF_PATH = os.path.join(OUTPUT_DIR, "fomiks_shell_laser_cut.dxf")
SVG_PATH = os.path.join(OUTPUT_DIR, "fomiks_shell_laser_cut.svg")
HTML_PATH = os.path.join(OUTPUT_DIR, "fomiks_shell_preview.html")

# ====================================================================
# ASOSIY PARAMETRLAR (Barcha o'lchamlar MILLIMETRDA - mm)
# ====================================================================
THICKNESS = 3.0  # Fomiks qalinligi (standart 3 mm, 5 mm ga ham moslashadi)

# Lazer ishchi stoli o'lchamlari (standart 1200 x 900 mm varaq)
BED_W = 1200.0
BED_H = 900.0

# --------------------------------------------------------------------
# SVG Elementlar to'plami
# --------------------------------------------------------------------
svg_elements = []

def svg_rect(x, y, w, h, rx=0, cls="cut"):
    if rx > 0:
        svg_elements.append(f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" rx="{rx:.2f}" class="{cls}" />')
    else:
        svg_elements.append(f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" class="{cls}" />')

def svg_circle(cx, cy, r, cls="cut"):
    svg_elements.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}" class="{cls}" />')

def svg_line(x1, y1, x2, y2, cls="score"):
    svg_elements.append(f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" class="{cls}" />')

def svg_polyline(points, cls="cut", close=False):
    pts_str = " ".join([f"{x:.2f},{y:.2f}" for x, y in points])
    tag = "polygon" if close else "polyline"
    svg_elements.append(f'<{tag} points="{pts_str}" class="{cls}" />')

def svg_path(d_str, cls="cut"):
    svg_elements.append(f'<path d="{d_str}" class="{cls}" />')

def svg_text(x, y, text, size=14, cls="label"):
    svg_elements.append(f'<text x="{x:.2f}" y="{y:.2f}" font-size="{size}" class="{cls}">{text}</text>')


def generate_cad_models():
    doc = ezdxf.new("R2010", setup=True)
    msp = doc.modelspace()

    # Qatlamlar (Layers)
    doc.layers.add("CUT", color=colors.RED)             # Qizil - Lazer to'liq kesish
    doc.layers.add("SCORE_BEND", color=colors.BLUE)      # Ko'k - Lazerda yarim chuqur chizish / Bukish
    doc.layers.add("ANNOTATIONS", color=colors.WHITE)    # Oq/Qora - Yozuvlar va o'lchamlar

    # Varaq ramkasi (1200 x 900 mm)
    msp.add_lwpolyline([(0, 0), (BED_W, 0), (BED_W, BED_H), (0, BED_H)], close=True, dxfattribs={"layer": "ANNOTATIONS"})
    svg_rect(0, 0, BED_W, BED_H, cls="bed-border")
    svg_text(20, 30, f"QALQON v1.0 — Oq Qobiq Fomiks 3-5mm Lazer Kesim Chizmasi (Varaq: {int(BED_W)}x{int(BED_H)} mm)", size=18, cls="header")
    msp.add_text(f"QALQON v1.0 — FOMIKS 3mm LAZER KESIM (BED: {int(BED_W)}x{int(BED_H)}mm)", dxfattribs={"layer": "ANNOTATIONS", "height": 18}).set_placement((20, BED_H - 40))

    # ====================================================================
    # 1. OLD KAPOT / FRONTAL PANEL (TABLET + SPEAKER + KAMERA)
    # Joylashuvi: X: 40, Y: 60, O'lchami: 420 x 280 mm
    # ====================================================================
    p1_x, p1_y = 50.0, 60.0
    p1_w, p1_h = 420.0, 280.0
    
    # Tashqi kontur (trapezoid/yumaloqlangan gumbaz yoyi)
    p1_pts = [
        (p1_x + 30, p1_y),
        (p1_x + p1_w - 30, p1_y),
        (p1_x + p1_w, p1_y + 80),
        (p1_x + p1_w - 20, p1_y + p1_h),
        (p1_x + 20, p1_y + p1_h),
        (p1_x, p1_y + 80)
    ]
    msp.add_lwpolyline(p1_pts, close=True, dxfattribs={"layer": "CUT"})
    svg_polyline(p1_pts, cls="cut", close=True)

    # Planshet oynasi kesimi (215 x 135 mm, R=10mm) - 8.0"-8.7" tablet uchun
    t_w, t_h = 215.0, 135.0
    t_x = p1_x + (p1_w - t_w) / 2.0
    t_y = p1_y + 90.0
    t_pts = [
        (t_x + 8, t_y), (t_x + t_w - 8, t_y),
        (t_x + t_w, t_y + 8), (t_x + t_w, t_y + t_h - 8),
        (t_x + t_w - 8, t_y + t_h), (t_x + 8, t_y + t_h),
        (t_x, t_y + t_h - 8), (t_x, t_y + 8)
    ]
    msp.add_lwpolyline(t_pts, close=True, dxfattribs={"layer": "CUT"})
    svg_polyline(t_pts, cls="cut", close=True)

    # Frontal AI kamera darchasi (Ø22 mm)
    cam_cx = p1_x + p1_w / 2.0
    cam_cy = t_y + t_h + 25.0
    msp.add_circle((cam_cx, cam_cy), radius=11.0, dxfattribs={"layer": "CUT"})
    svg_circle(cam_cx, cam_cy, 11.0, cls="cut")

    # Pastki dinamik va mikrofon panjarasi (Speaker Grill: 4 qator x 12 ustun Ø4mm)
    grill_start_x = p1_x + (p1_w - 110.0) / 2.0
    grill_start_y = p1_y + 35.0
    for row in range(3):
        for col in range(10):
            gx = grill_start_x + col * 12.0
            gy = grill_start_y + row * 12.0
            msp.add_circle((gx, gy), radius=2.5, dxfattribs={"layer": "CUT"})
            svg_circle(gx, gy, 2.5, cls="cut")

    # 2 ta Old Ultratovush Sonar darchalari (HC-SR04, Ø16mm)
    msp.add_circle((p1_x + 60, p1_y + 45), radius=8.0, dxfattribs={"layer": "CUT"})
    msp.add_circle((p1_x + p1_w - 60, p1_y + 45), radius=8.0, dxfattribs={"layer": "CUT"})
    svg_circle(p1_x + 60, p1_y + 45, 8.0, cls="cut")
    svg_circle(p1_x + p1_w - 60, p1_y + 45, 8.0, cls="cut")

    # Bukish chiziqlari (65° planshet ergonomik qiyaligi uchun)
    msp.add_line((p1_x + 10, p1_y + 80), (p1_x + p1_w - 10, p1_y + 80), dxfattribs={"layer": "SCORE_BEND"})
    msp.add_line((p1_x + 20, p1_y + 235), (p1_x + p1_w - 20, p1_y + 235), dxfattribs={"layer": "SCORE_BEND"})
    svg_line(p1_x + 10, p1_y + 80, p1_x + p1_w - 10, p1_y + 80, cls="score")
    svg_line(p1_x + 20, p1_y + 235, p1_x + p1_w - 20, p1_y + 235, cls="score")

    # Panel 1 Yozuvlari
    svg_text(p1_x + 15, p1_y + 20, "PANEL 1: OLD KAPOT VA PLANSHET OYNASI (215x135 mm, 65°)", size=12)
    svg_text(cam_cx - 45, cam_cy + 18, "Front Kamera Ø22", size=10)
    msp.add_text("P1: OLD KAPOT (PLANSHET 215x135)", dxfattribs={"layer": "ANNOTATIONS", "height": 10}).set_placement((p1_x + 20, p1_y + 15))

    # ====================================================================
    # 2. YUQORI GUMBAZ TOJI VA LYUK (TELESKOPIK MINORA UCHUN)
    # Joylashuvi: X: 520, Y: 60, O'lchami: 360 x 300 mm
    # ====================================================================
    p2_x, p2_y = 520.0, 60.0
    p2_w, p2_h = 360.0, 300.0
    
    # Sferik toj konturi (yumaloqlangan 8-burchak)
    p2_pts = [
        (p2_x + 60, p2_y), (p2_x + p2_w - 60, p2_y),
        (p2_x + p2_w, p2_y + 60), (p2_x + p2_w, p2_y + p2_h - 60),
        (p2_x + p2_w - 60, p2_y + p2_h), (p2_x + 60, p2_y + p2_h),
        (p2_x, p2_y + p2_h - 60), (p2_x, p2_y + 60)
    ]
    msp.add_lwpolyline(p2_pts, close=True, dxfattribs={"layer": "CUT"})
    svg_polyline(p2_pts, cls="cut", close=True)

    # Markaziy Teleskopik Minora Lyuki (Ø150 mm)
    hatch_cx = p2_x + p2_w / 2.0
    hatch_cy = p2_y + p2_h / 2.0
    msp.add_circle((hatch_cx, hatch_cy), radius=75.0, dxfattribs={"layer": "CUT"})
    svg_circle(hatch_cx, hatch_cy, 75.0, cls="cut")

    # Minora germetik manjeti va fiksator teshiklari (4 ta Ø4.2mm M4 teshik)
    for ang in [45, 135, 225, 315]:
        rad = math.radians(ang)
        mx = hatch_cx + 85.0 * math.cos(rad)
        my = hatch_cy + 85.0 * math.sin(rad)
        msp.add_circle((mx, my), radius=2.1, dxfattribs={"layer": "CUT"})
        svg_circle(mx, my, 2.1, cls="cut")

    # Qizdirib egish yo'nalish chiziqlari (radial score lines)
    for ang in [0, 90, 180, 270]:
        rad = math.radians(ang)
        sx = hatch_cx + 80.0 * math.cos(rad)
        sy = hatch_cy + 80.0 * math.sin(rad)
        ex = hatch_cx + 140.0 * math.cos(rad)
        ey = hatch_cy + 140.0 * math.sin(rad)
        msp.add_line((sx, sy), (ex, ey), dxfattribs={"layer": "SCORE_BEND"})
        svg_line(sx, sy, ex, ey, cls="score")

    svg_text(p2_x + 20, p2_y + 25, "PANEL 2: YUQORI GUMBAZ TOJI (MINORA LYUKI Ø150 mm)", size=12)
    svg_text(hatch_cx - 50, hatch_cy - 5, "Minora Lyuki Ø150", size=12)
    msp.add_text("P2: YUQORI TOJ (MINORA LYUK Ø150)", dxfattribs={"layer": "ANNOTATIONS", "height": 10}).set_placement((p2_x + 20, p2_y + 20))

    # ====================================================================
    # 3. YUQORI MINORA HALQASI (C1 REINFORCEMENT RING COLLAR)
    # Joylashuvi: X: 920, Y: 80, Tashqi Ø190, Ichki Ø150
    # ====================================================================
    c1_cx, c1_cy = 1030.0, 190.0
    msp.add_circle((c1_cx, c1_cy), radius=95.0, dxfattribs={"layer": "CUT"})
    msp.add_circle((c1_cx, c1_cy), radius=75.0, dxfattribs={"layer": "CUT"})
    svg_circle(c1_cx, c1_cy, 95.0, cls="cut")
    svg_circle(c1_cx, c1_cy, 75.0, cls="cut")
    for ang in [45, 135, 225, 315]:
        rad = math.radians(ang)
        mx = c1_cx + 85.0 * math.cos(rad)
        my = c1_cy + 85.0 * math.sin(rad)
        msp.add_circle((mx, my), radius=2.1, dxfattribs={"layer": "CUT"})
        svg_circle(mx, my, 2.1, cls="cut")
    svg_text(c1_cx - 85, c1_cy + 115, "HALQA C1: Lyuk Mustahkamlagich (Ø190/Ø150)", size=11)
    msp.add_text("C1: LYUK HALQASI Ø190/Ø150", dxfattribs={"layer": "ANNOTATIONS", "height": 10}).set_placement((c1_cx - 75, c1_cy + 110))

    # ====================================================================
    # 4. CHAP YON QANOT VA G'ILDIRAK ARKALARI (LEFT SIDE SKIRT)
    # Joylashuvi: X: 50, Y: 380, O'lchami: 520 x 180 mm
    # G'ildiraklar bazasi: 320 mm, Arkalar: R=75 mm (Ø125mm shinalar uchun)
    # ====================================================================
    p4_x, p4_y = 50.0, 380.0
    p4_w, p4_h = 520.0, 180.0
    w_arch_r = 75.0
    front_wheel_cx = p4_x + 100.0
    rear_wheel_cx = p4_x + 100.0 + 320.0  # 420.0

    # Arkali pastki kontur chizig'i
    # SVG path d: (p4_x, p4_y+p4_h) -> (p4_x+p4_w, p4_y+p4_h) etc.
    d_left_skirt = (
        f"M {p4_x:.2f},{p4_y + p4_h:.2f} "
        f"L {p4_x + 25:.2f},{p4_y:.2f} "
        f"L {front_wheel_cx - w_arch_r:.2f},{p4_y:.2f} "
        f"A {w_arch_r:.2f} {w_arch_r:.2f} 0 0 1 {front_wheel_cx + w_arch_r:.2f} {p4_y:.2f} "
        f"L {rear_wheel_cx - w_arch_r:.2f},{p4_y:.2f} "
        f"A {w_arch_r:.2f} {w_arch_r:.2f} 0 0 1 {rear_wheel_cx + w_arch_r:.2f} {p4_y:.2f} "
        f"L {p4_x + p4_w - 25:.2f},{p4_y:.2f} "
        f"L {p4_x + p4_w:.2f},{p4_y + p4_h:.2f} Z"
    )
    svg_path(d_left_skirt, cls="cut")

    # DXF uchun qanot konturini segmentlar bilan chizamiz
    skirt_dxf_pts = [(p4_x, p4_y + p4_h), (p4_x + 25, p4_y), (front_wheel_cx - w_arch_r, p4_y)]
    # Front arch
    for i in range(17):
        ang = math.pi - i * (math.pi / 16.0)
        skirt_dxf_pts.append((front_wheel_cx + w_arch_r * math.cos(ang), p4_y + w_arch_r * math.sin(ang)))
    skirt_dxf_pts.append((rear_wheel_cx - w_arch_r, p4_y))
    # Rear arch
    for i in range(17):
        ang = math.pi - i * (math.pi / 16.0)
        skirt_dxf_pts.append((rear_wheel_cx + w_arch_r * math.cos(ang), p4_y + w_arch_r * math.sin(ang)))
    skirt_dxf_pts.extend([(p4_x + p4_w - 25, p4_y), (p4_x + p4_w, p4_y + p4_h)])
    msp.add_lwpolyline(skirt_dxf_pts, close=True, dxfattribs={"layer": "CUT"})

    # Chap Yon Kamera Darchasi (Ø18mm) va Chap Sonar (Ø16mm)
    cam_left_x = p4_x + p4_w / 2.0
    cam_left_y = p4_y + 130.0
    msp.add_circle((cam_left_x, cam_left_y), radius=9.0, dxfattribs={"layer": "CUT"})
    svg_circle(cam_left_x, cam_left_y, 9.0, cls="cut")

    msp.add_circle((cam_left_x - 70, p4_y + 90), radius=8.0, dxfattribs={"layer": "CUT"})
    svg_circle(cam_left_x - 70, p4_y + 90, 8.0, cls="cut")

    # Qanot qavariqlik bukish chizig'i
    msp.add_line((p4_x + 30, p4_y + 95), (p4_x + p4_w - 30, p4_y + 95), dxfattribs={"layer": "SCORE_BEND"})
    svg_line(p4_x + 30, p4_y + 95, p4_x + p4_w - 30, p4_y + 95, cls="score")

    svg_text(p4_x + 20, p4_y + p4_h - 15, "PANEL 4: CHAP YON QANOT (Baza: 320 mm, Arkalar R=75, Kamera Ø18)", size=12)
    msp.add_text("P4: CHAP YON QANOT (R75 ARKA)", dxfattribs={"layer": "ANNOTATIONS", "height": 10}).set_placement((p4_x + 30, p4_y + p4_h - 20))

    # ====================================================================
    # 5. O'NG YON QANOT VA G'ILDIRAK ARKALARI (RIGHT SIDE SKIRT)
    # Joylashuvi: X: 610, Y: 380, O'lchami: 520 x 180 mm (Chap panelning simmetrigi)
    # ====================================================================
    p5_x, p5_y = 610.0, 380.0
    p5_w, p5_h = 520.0, 180.0
    front_r_cx = p5_x + 100.0
    rear_r_cx = p5_x + 100.0 + 320.0

    d_right_skirt = (
        f"M {p5_x:.2f},{p5_y + p5_h:.2f} "
        f"L {p5_x + 25:.2f},{p5_y:.2f} "
        f"L {front_r_cx - w_arch_r:.2f},{p5_y:.2f} "
        f"A {w_arch_r:.2f} {w_arch_r:.2f} 0 0 1 {front_r_cx + w_arch_r:.2f} {p5_y:.2f} "
        f"L {rear_r_cx - w_arch_r:.2f},{p5_y:.2f} "
        f"A {w_arch_r:.2f} {w_arch_r:.2f} 0 0 1 {rear_r_cx + w_arch_r:.2f} {p5_y:.2f} "
        f"L {p5_x + p5_w - 25:.2f},{p5_y:.2f} "
        f"L {p5_x + p5_w:.2f},{p5_y + p5_h:.2f} Z"
    )
    svg_path(d_right_skirt, cls="cut")

    r_skirt_pts = [(p5_x, p5_y + p5_h), (p5_x + 25, p5_y), (front_r_cx - w_arch_r, p5_y)]
    for i in range(17):
        ang = math.pi - i * (math.pi / 16.0)
        r_skirt_pts.append((front_r_cx + w_arch_r * math.cos(ang), p5_y + w_arch_r * math.sin(ang)))
    r_skirt_pts.append((rear_r_cx - w_arch_r, p5_y))
    for i in range(17):
        ang = math.pi - i * (math.pi / 16.0)
        r_skirt_pts.append((rear_r_cx + w_arch_r * math.cos(ang), p5_y + w_arch_r * math.sin(ang)))
    r_skirt_pts.extend([(p5_x + p5_w - 25, p5_y), (p5_x + p5_w, p5_y + p5_h)])
    msp.add_lwpolyline(r_skirt_pts, close=True, dxfattribs={"layer": "CUT"})

    cam_right_x = p5_x + p5_w / 2.0
    cam_right_y = p5_y + 130.0
    msp.add_circle((cam_right_x, cam_right_y), radius=9.0, dxfattribs={"layer": "CUT"})
    svg_circle(cam_right_x, cam_right_y, 9.0, cls="cut")

    msp.add_circle((cam_right_x + 70, p5_y + 90), radius=8.0, dxfattribs={"layer": "CUT"})
    svg_circle(cam_right_x + 70, p5_y + 90, 8.0, cls="cut")

    msp.add_line((p5_x + 30, p5_y + 95), (p5_x + p5_w - 30, p5_y + 95), dxfattribs={"layer": "SCORE_BEND"})
    svg_line(p5_x + 30, p5_y + 95, p5_x + p5_w - 30, p5_y + 95, cls="score")

    svg_text(p5_x + 20, p5_y + p5_h - 15, "PANEL 5: O'NG YON QANOT (Baza: 320 mm, Arkalar R=75, Kamera Ø18)", size=12)
    msp.add_text("P5: O'NG YON QANOT (R75 ARKA)", dxfattribs={"layer": "ANNOTATIONS", "height": 10}).set_placement((p5_x + 30, p5_y + p5_h - 20))

    # ====================================================================
    # 6. ORQA KAPOT VA SHAMOLLATISH PANJARASI (REAR SLOPED HATCH)
    # Joylashuvi: X: 50, Y: 600, O'lchami: 420 x 240 mm
    # ====================================================================
    p3_x, p3_y = 50.0, 600.0
    p3_w, p3_h = 420.0, 240.0
    p3_pts = [
        (p3_x + 35, p3_y),
        (p3_x + p3_w - 35, p3_y),
        (p3_x + p3_w, p3_y + 70),
        (p3_x + p3_w - 20, p3_y + p3_h),
        (p3_x + 20, p3_y + p3_h),
        (p3_x, p3_y + 70)
    ]
    msp.add_lwpolyline(p3_pts, close=True, dxfattribs={"layer": "CUT"})
    svg_polyline(p3_pts, cls="cut", close=True)

    # Orqa Kamera Darchasi (Ø22mm)
    rear_cam_cx = p3_x + p3_w / 2.0
    rear_cam_cy = p3_y + p3_h - 45.0
    msp.add_circle((rear_cam_cx, rear_cam_cy), radius=11.0, dxfattribs={"layer": "CUT"})
    svg_circle(rear_cam_cx, rear_cam_cy, 11.0, cls="cut")

    # Orqa 2 ta Ultratovush Sonarlar (HC-SR04, Ø16mm)
    msp.add_circle((p3_x + 70, p3_y + 50), radius=8.0, dxfattribs={"layer": "CUT"})
    msp.add_circle((p3_x + p3_w - 70, p3_y + 50), radius=8.0, dxfattribs={"layer": "CUT"})
    svg_circle(p3_x + 70, p3_y + 50, 8.0, cls="cut")
    svg_circle(p3_x + p3_w - 70, p3_y + 50, 8.0, cls="cut")

    # Shamollatish panjaralari (Ventilation Louvers: 6 ta 90x6 mm gorizontal slot)
    louver_start_x = p3_x + (p3_w - 90.0) / 2.0
    for l_idx in range(6):
        ly = p3_y + 85.0 + l_idx * 16.0
        msp.add_lwpolyline([
            (louver_start_x, ly), (louver_start_x + 90, ly),
            (louver_start_x + 90, ly + 6), (louver_start_x, ly + 6)
        ], close=True, dxfattribs={"layer": "CUT"})
        svg_rect(louver_start_x, ly, 90.0, 6.0, rx=3.0, cls="cut")

    # Orqa qiya bukish chizig'i
    msp.add_line((p3_x + 15, p3_y + 70), (p3_x + p3_w - 15, p3_y + 70), dxfattribs={"layer": "SCORE_BEND"})
    svg_line(p3_x + 15, p3_y + 70, p3_x + p3_w - 15, p3_y + 70, cls="score")

    svg_text(p3_x + 20, p3_y + 25, "PANEL 3: ORQA KAPOT (HAVO OQIMI VA ORQA KAMERA Ø22)", size=12)
    msp.add_text("P3: ORQA KAPOT (VENTILATSIYA & KAMERA)", dxfattribs={"layer": "ANNOTATIONS", "height": 10}).set_placement((p3_x + 20, p3_y + 20))

    # ====================================================================
    # 7. ICHKI MUSTAHKAMLIK QOVURG'ALARI (R1, R2, R3 KARKAS SHABLONLARI)
    # Joylashuvi: X: 520, Y: 600
    # ====================================================================
    # R1: Markaziy Bo'ylama Qovurg'a (Spine Rib: 480 x 200 mm)
    r1_x, r1_y = 520.0, 600.0
    r1_w, r1_h = 480.0, 200.0
    # Arka shakldagi qovurg'a (ichki skelet)
    r1_pts = [
        (r1_x, r1_y),
        (r1_x + 40, r1_y + r1_h),
        (r1_x + r1_w - 40, r1_y + r1_h),
        (r1_x + r1_w, r1_y)
    ]
    msp.add_lwpolyline(r1_pts, close=True, dxfattribs={"layer": "CUT"})
    svg_polyline(r1_pts, cls="cut", close=True)

    # Qovurg'alar tutashuv tishlari (Slots for transverse ribs: 3.2mm x 40mm)
    slot1_x = r1_x + 140.0
    slot2_x = r1_x + 340.0
    msp.add_lwpolyline([(slot1_x, r1_y), (slot1_x + 3.2, r1_y), (slot1_x + 3.2, r1_y + 50), (slot1_x, r1_y + 50)], close=True, dxfattribs={"layer": "CUT"})
    msp.add_lwpolyline([(slot2_x, r1_y), (slot2_x + 3.2, r1_y), (slot2_x + 3.2, r1_y + 50), (slot2_x, r1_y + 50)], close=True, dxfattribs={"layer": "CUT"})
    svg_rect(slot1_x, r1_y, 3.2, 50.0, cls="cut")
    svg_rect(slot2_x, r1_y, 3.2, 50.0, cls="cut")

    # Minora lifti o'tish darchasi (160 x 100 mm markazda)
    msp.add_lwpolyline([
        (r1_x + 160, r1_y + 80), (r1_x + 320, r1_y + 80),
        (r1_x + 320, r1_y + 170), (r1_x + 160, r1_y + 170)
    ], close=True, dxfattribs={"layer": "CUT"})
    svg_rect(r1_x + 160, r1_y + 80, 160.0, 90.0, rx=10.0, cls="cut")

    svg_text(r1_x + 20, r1_y + 25, "R1: MARKAZIY BO'YLAMA SKELET QOVURG'A (SPINE RIB)", size=12)
    msp.add_text("R1: ASOSIY SPAYN QOVURG'A", dxfattribs={"layer": "ANNOTATIONS", "height": 10}).set_placement((r1_x + 20, r1_y + 20))

    # ====================================================================
    # 8. SHASSIGA QOTIRISH VA BURCHAK MONTAJ PLANKALARI (4 TA)
    # Joylashuvi: X: 1040, Y: 400
    # ====================================================================
    bracket_x = 1040.0
    for b_idx in range(4):
        by = 380.0 + b_idx * 55.0
        # 60 x 35 mm mustahkamlash qulog'i
        b_pts = [(bracket_x, by), (bracket_x + 60, by), (bracket_x + 60, by + 40), (bracket_x, by + 40)]
        msp.add_lwpolyline(b_pts, close=True, dxfattribs={"layer": "CUT"})
        svg_polyline(b_pts, cls="cut", close=True)
        # M4 vint teshigi (Ø4.2 mm)
        msp.add_circle((bracket_x + 30, by + 20), radius=2.1, dxfattribs={"layer": "CUT"})
        svg_circle(bracket_x + 30, by + 20, 2.1, cls="cut")
        svg_text(bracket_x + 68, by + 25, f"M{b_idx+1}: M4 Quloq", size=10)

    # ====================================================================
    # 9. LEGENDA VA QOIDALAR (LEGEND & CUTTING GUIDELINES)
    # ====================================================================
    svg_rect(1020, 620, 160, 220, rx=6, cls="legend-box")
    svg_text(1030, 645, "LEGENDA (QOIDALAR):", size=12, cls="legend-title")
    svg_line(1030, 665, 1070, 665, cls="cut")
    svg_text(1080, 670, "QIZIL: To'liq Kesish", size=11)
    svg_line(1030, 695, 1070, 695, cls="score")
    svg_text(1080, 700, "KO'K: Bukish Chizig'i", size=11)
    svg_text(1030, 730, "Material: Fomiks 3-5mm", size=10)
    svg_text(1030, 750, "Lazer: CO2 80-100W", size=10)
    svg_text(1030, 770, "Egish: Fen (110-130°C)", size=10)
    svg_text(1030, 790, "Yelim: Cosmofen CA-12", size=10)
    svg_text(1030, 810, "Masshtab: 1:1 (Aniq mm)", size=10)

    # Fayllarni saqlash
    doc.saveas(DXF_PATH)
    print(f"[OK] DXF fayl saqlandi: {DXF_PATH}")

    # SVG faylini yozish
    svg_content = f"""<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" 
     viewBox="0 0 {BED_W} {BED_H}" 
     width="{BED_W}mm" height="{BED_H}mm"
     style="background-color: #121820; font-family: 'Segoe UI', Arial, sans-serif;">
<defs>
  <style>
    .bed-border {{ fill: #182230; stroke: #37474f; stroke-width: 1.5; stroke-dasharray: 6,4; }}
    .cut {{ fill: none; stroke: #ff3344; stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; }}
    .score {{ fill: none; stroke: #00b0ff; stroke-width: 1.2; stroke-dasharray: 4,3; }}
    .header {{ fill: #00e5ff; font-weight: bold; }}
    .label {{ fill: #cfd8dc; }}
    .legend-box {{ fill: #1e293b; stroke: #475569; stroke-width: 1.0; }}
    .legend-title {{ fill: #38bdf8; font-weight: bold; }}
  </style>
</defs>
<!-- Auto-generated QALQON v1.0 Laser Cutting File -->
{''.join(svg_elements)}
</svg>
"""
    with open(SVG_PATH, "w", encoding="utf-8") as f:
        f.write(svg_content)
    print(f"[OK] SVG fayl saqlandi: {SVG_PATH}")

    # Interaktiv HTML ko'rgazmasini yaratish
    html_content = f"""<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8">
  <title>QALQON v1.0 — Fomiks Oq Qobiq Lazer Kesim Chizmasi</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ background: #0b0f17; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }}
    header {{ background: #111827; border-bottom: 1px solid #1f2937; padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; }}
    .title-box {{ display: flex; align-items: center; gap: 12px; }}
    .badge {{ background: #0284c7; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px; }}
    h1 {{ font-size: 18px; font-weight: 600; color: #f8fafc; }}
    .toolbar {{ display: flex; gap: 10px; }}
    button, a.btn {{ background: #1e293b; color: #38bdf8; border: 1px solid #334155; padding: 7px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; transition: all 0.2s; }}
    button:hover, a.btn:hover {{ background: #0284c7; color: #fff; border-color: #0284c7; }}
    .main-container {{ display: flex; flex: 1; overflow: hidden; }}
    .viewer {{ flex: 1; position: relative; overflow: auto; display: flex; align-items: center; justify-content: center; padding: 20px; background: radial-gradient(circle at center, #131d2e 0%, #0b0f17 100%); }}
    .svg-wrapper {{ box-shadow: 0 10px 40px rgba(0,0,0,0.8); border: 2px solid #334155; border-radius: 8px; max-width: 95%; max-height: 90%; background: #121820; }}
    .sidebar {{ width: 340px; background: #0f172a; border-left: 1px solid #1e293b; padding: 20px; overflow-y: auto; font-size: 13px; }}
    .section-title {{ font-size: 14px; font-weight: 700; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; border-bottom: 1px solid #334155; padding-bottom: 6px; }}
    .part-card {{ background: #1e293b; border-left: 3px solid #ff3344; padding: 10px 12px; border-radius: 4px; margin-bottom: 10px; }}
    .part-card.bend {{ border-left-color: #00b0ff; }}
    .part-card h4 {{ font-size: 13px; color: #f1f5f9; margin-bottom: 4px; }}
    .part-card p {{ color: #94a3b8; font-size: 12px; line-height: 1.4; }}
    .step-list {{ list-style: none; counter-reset: step-counter; }}
    .step-list li {{ position: relative; padding-left: 28px; margin-bottom: 10px; color: #cbd5e1; line-height: 1.4; }}
    .step-list li::before {{ content: counter(step-counter); counter-increment: step-counter; position: absolute; left: 0; top: 0; width: 20px; height: 20px; background: #0369a1; color: #fff; border-radius: 50%; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }}
    .chip {{ display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; margin-right: 4px; }}
    .chip.red {{ background: rgba(255, 51, 68, 0.2); color: #ff3344; border: 1px solid rgba(255, 51, 68, 0.4); }}
    .chip.blue {{ background: rgba(0, 176, 255, 0.2); color: #00b0ff; border: 1px solid rgba(0, 176, 255, 0.4); }}
  </style>
</head>
<body>
  <header>
    <div class="title-box">
      <span class="badge">CAD 1:1 DXF/SVG</span>
      <h1>QALQON v1.0 — Oq Qobiq Fomiks Lazer Kesim Chizmasi</h1>
    </div>
    <div class="toolbar">
      <a class="btn" href="fomiks_shell_laser_cut.dxf" download>💾 DXF Yuklab Olish (Lazer Stanok)</a>
      <a class="btn" href="fomiks_shell_laser_cut.svg" download>📐 SVG Yuklab Olish (CorelDraw)</a>
      <button onclick="toggleGrid()">🌐 To'rni Almashtirish</button>
    </div>
  </header>
  
  <div class="main-container">
    <div class="viewer">
      <div class="svg-wrapper" id="svgHolder">
        {svg_content}
      </div>
    </div>
    
    <div class="sidebar">
      <div class="section-title">📋 Kesiladigan Qismlar</div>
      
      <div class="part-card">
        <h4>Panel 1: Old Kapot & Planshet Oynasi</h4>
        <p><span class="chip red">Kesish</span> 215x135 mm planshet darchasi (8.0"-8.7"), kamera Ø22 mm, dinamik panjarasi va 2 ta sonar.</p>
        <p><span class="chip blue">Egish</span> 65° qiyalik burchagiga fen bilan qizdirib bukiladi.</p>
      </div>

      <div class="part-card">
        <h4>Panel 2: Yuqori Gumbaz Toji</h4>
        <p><span class="chip red">Kesish</span> Markaziy lyuk Ø150 mm (teleskopik minora / LiDAR / kamera / mayoq chiqishi uchun).</p>
      </div>

      <div class="part-card">
        <h4>Panel 3: Orqa Kapot & Ventilyatsiya</h4>
        <p><span class="chip red">Kesish</span> 6 ta sovutish tirqishi (louver), orqa kamera Ø22 mm va 2 ta orqa sonar.</p>
      </div>

      <div class="part-card">
        <h4>Panel 4 & 5: Chap va O'ng Qanotlar</h4>
        <p><span class="chip red">Kesish</span> G'ildirak arkalari R=75 mm (baza: 320 mm, Ø125 mm rezina shinalar erkin aylanadi).</p>
      </div>

      <div class="part-card">
        <h4>R1: Skelet Qovurg'a (Spine Rib)</h4>
        <p><span class="chip red">Kesish</span> Gumbaz ichki shaklini ushlab turuvchi shablon va qattiqlik qovurg'asi.</p>
      </div>

      <div class="part-card">
        <h4>C1 & M1-M4: Lyuk Halqasi & Quloqlar</h4>
        <p><span class="chip red">Kesish</span> Lyuk chetini qalinlashtiruvchi halqa va shassiga M4 vintlar bilan qotirish tirnoqlari.</p>
      </div>

      <div class="section-title" style="margin-top: 20px;">🔨 Tayyorlash Yo'riqnomasi</div>
      <ol class="step-list">
        <li><strong>Lazerda kesish:</strong> 3 mm Fomiks (Foam PVC) varag'ini CO2 lazerda (Tezlik: 25-35 mm/s, Quvvat: 65-75%) kesiladi.</li>
        <li><strong>Termik egish:</strong> Qurilish feni (110-130°C) bilan ko'k chiziqlar bo'ylab qizdirib, ichki R1 qovurg'asi ustiga egiladi.</li>
        <li><strong>Yelimlash:</strong> Qismlar <em>Cosmofen CA-12</em> (yoki maxsus PVX yelimi) bilan mustahkam yopishtiriladi.</li>
        <li><strong>Silliqlash:</strong> Choklar 240 va 400 raqamli mayin zimpara bilan tekislanadi.</li>
        <li><strong>Bo'yash:</strong> Plastik uchun primer sepilib, oq yaltiroq avtoemall va ko'k politsiya chiziqlari bilan bezatiladi.</li>
      </ol>
    </div>
  </div>

  <script>
    function toggleGrid() {{
      const holder = document.getElementById('svgHolder');
      holder.style.filter = holder.style.filter ? '' : 'contrast(1.2) brightness(1.1)';
    }}
  </script>
</body>
</html>
"""
    with open(HTML_PATH, "w", encoding="utf-8") as f:
        f.write(html_content)
    print(f"[OK] HTML Preview saqlandi: {HTML_PATH}")


if __name__ == "__main__":
    generate_cad_models()
