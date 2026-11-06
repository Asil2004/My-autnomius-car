#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
====================================================================
1 METR DIAMETRLI SHARNI 8 BO'LAK (LEPESTOK)GA YOYISH VA LAZER CHIZMASI
====================================================================
Diametr: D = 1000 mm (Radiusi R = 500 mm)
Bo'laklar soni: N = 8 ta lezyon / lepestok (gore segments)

Hisob-kitob formulasi:
  - Ekvator perimetri: C = pi * D = 3141.59 mm
  - Har bir bo'lakning ekvatordagi maksimal eni: W0 = C / 8 = 392.70 mm
  - Yarim shar (gumbaz) yoyi bo'yi: H = (pi * R) / 2 = 785.40 mm
  - To'liq shar yoyi bo'yi: L = pi * R = 1570.80 mm
  - y masofadagi kenglik (y o'qi bo'ylab):
      W(y) = W0 * cos(y / R)
      X(y) = +/- (W0 / 2) * cos(y / R)
====================================================================
"""

import math
import os
import ezdxf
from ezdxf import colors

OUTPUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "cad"))
os.makedirs(OUTPUT_DIR, exist_ok=True)

DXF_PATH = os.path.join(OUTPUT_DIR, "sphere_1m_8_gores.dxf")
SVG_PATH = os.path.join(OUTPUT_DIR, "sphere_1m_8_gores.svg")
HTML_PATH = os.path.join(OUTPUT_DIR, "sphere_1m_preview.html")

D = 1000.0          # Shar diametri (mm)
R = D / 2.0         # Shar radiusi (500 mm)
N = 8               # Bo'laklar soni
C = math.pi * D     # 3141.59 mm
W0 = C / N          # 392.70 mm
HALF_W0 = W0 / 2.0  # 196.35 mm
H_HEMI = (math.pi * R) / 2.0  # 785.40 mm
L_FULL = math.pi * R          # 1570.80 mm


def get_gore_points_hemisphere(step_mm=10.0, offset_x=0.0, offset_y=0.0):
    """Yarim shar (gumbaz) uchun 1 ta lebestok kontur nuqtalari"""
    steps = int(math.ceil(H_HEMI / step_mm))
    pts_right = []
    pts_left = []
    
    for i in range(steps + 1):
        y = min(i * step_mm, H_HEMI)
        phi = y / R  # radian
        w_half = HALF_W0 * math.cos(phi)
        pts_right.append((offset_x + w_half, offset_y + y))
        pts_left.append((offset_x - w_half, offset_y + y))
        
    pts = pts_right + list(reversed(pts_left))
    return pts


def get_gore_points_full_sphere(step_mm=15.0, offset_x=0.0, offset_y=0.0):
    """To'liq shar uchun 1 ta lebestok kontur nuqtalari (-H_HEMI dan +H_HEMI gacha)"""
    steps = int(math.ceil(H_HEMI / step_mm))
    pts_right = []
    pts_left = []
    
    # -H_HEMI dan +H_HEMI gacha
    total_steps = steps * 2
    for i in range(total_steps + 1):
        y = -H_HEMI + i * (L_FULL / total_steps)
        phi = y / R
        w_half = HALF_W0 * math.cos(phi)
        pts_right.append((offset_x + w_half, offset_y + y + H_HEMI))
        pts_left.append((offset_x - w_half, offset_y + y + H_HEMI))
        
    pts = pts_right + list(reversed(pts_left))
    return pts


def generate_cad_files():
    doc = ezdxf.new("R2010", setup=True)
    msp = doc.modelspace()

    # Qatlamlar
    doc.layers.add("CUT", color=colors.RED)             # Qizil: to'liq kesish
    doc.layers.add("AXIS_CENTER", color=colors.BLUE)    # Ko'k: markaziy o'q chizig'i
    doc.layers.add("DIMENSIONS", color=colors.GREEN)    # Yashil: o'lcham chiziqlari
    doc.layers.add("ANNOTATIONS", color=colors.WHITE)   # Oq: matnlar

    svg_elements = []

    # -------------------------------------------------------------
    # 1. VARAQ 1: YARIM SHAR GUMBAZ UCHUN 8 TA BO'LAK (HEMISPHERE)
    # Standart 1250 x 2500 mm yoki 1500 x 3000 mm listga joylashuv
    # Har bir bo'lak: Asosi 392.7 mm, Balandligi 785.4 mm
    # -------------------------------------------------------------
    spacing_x = 420.0
    start_x = 220.0
    start_y = 100.0

    # Chizish: 8 ta yarim shar bo'lagi yonma-yon (2 qatorda 4 tadan)
    for idx in range(8):
        row = idx // 4
        col = idx % 4
        gx = start_x + col * spacing_x
        gy = start_y + row * 880.0

        pts = get_gore_points_hemisphere(step_mm=10.0, offset_x=gx, offset_y=gy)
        msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": "CUT"})

        # Markaziy simmetriya o'qi
        msp.add_line((gx, gy), (gx, gy + H_HEMI), dxfattribs={"layer": "AXIS_CENTER"})

        # Matn
        msp.add_text(f"BO'LAK #{idx+1} (Yarim shar)", dxfattribs={"layer": "ANNOTATIONS", "height": 18}).set_placement((gx - 90, gy + 30))
        msp.add_text(f"Asos eni: {W0:.1f} mm", dxfattribs={"layer": "ANNOTATIONS", "height": 14}).set_placement((gx - 70, gy - 25))
        msp.add_text(f"Yoy bo'yi: {H_HEMI:.1f} mm", dxfattribs={"layer": "ANNOTATIONS", "height": 14}).set_placement((gx - 70, gy + H_HEMI / 2))

    # O'lcham yozuvlari va sarlavha
    header_text = f"1 METR DIAMETRLI SHAR (D=1000mm, R=500mm) — 8 BO'LAKLI GUMBAZ (YARIM SHAR) CHIZMASI"
    msp.add_text(header_text, dxfattribs={"layer": "ANNOTATIONS", "height": 28}).set_placement((50, 1850))
    msp.add_text("Har bir bo'lak asosi: 392.7 mm | Yoy bo'yi: 785.4 mm | Ekvator perimetri: 3141.6 mm", dxfattribs={"layer": "ANNOTATIONS", "height": 18}).set_placement((50, 1810))

    # -------------------------------------------------------------
    # 2. TO'LIQ SHAR UCHUN ALOHIDA 1 TA ETALON TO'LIQ LEPESTOK
    # Joylashuvi: X: 1950, Y: 100, Bo'yi: 1570.8 mm, O'rtada eni: 392.7 mm
    # -------------------------------------------------------------
    full_gx = 2050.0
    full_gy = 100.0
    pts_full = get_gore_points_full_sphere(step_mm=15.0, offset_x=full_gx, offset_y=full_gy)
    msp.add_lwpolyline(pts_full, close=True, dxfattribs={"layer": "CUT"})
    msp.add_line((full_gx, full_gy), (full_gx, full_gy + L_FULL), dxfattribs={"layer": "AXIS_CENTER"})
    # Ekvator gorizontal chizig'i
    msp.add_line((full_gx - HALF_W0, full_gy + H_HEMI), (full_gx + HALF_W0, full_gy + H_HEMI), dxfattribs={"layer": "DIMENSIONS"})

    msp.add_text("TO'LIQ SHAR BO'LAGI (1/8)", dxfattribs={"layer": "ANNOTATIONS", "height": 20}).set_placement((full_gx - 110, full_gy + H_HEMI + 50))
    msp.add_text(f"To'liq bo'yi: {L_FULL:.1f} mm", dxfattribs={"layer": "ANNOTATIONS", "height": 15}).set_placement((full_gx - 80, full_gy + H_HEMI - 30))
    msp.add_text(f"Ekvatorda eni: {W0:.1f} mm", dxfattribs={"layer": "ANNOTATIONS", "height": 15}).set_placement((full_gx - 80, full_gy + H_HEMI - 60))

    doc.saveas(DXF_PATH)
    print(f"[OK] DXF saqlandi: {DXF_PATH}")

    # =============================================================
    # SVG FAYL GENERATSIYASI (1:1 Vektor)
    # =============================================================
    svg_w = 2350.0
    svg_h = 1950.0

    svg_lines = [
        f'<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {svg_w} {svg_h}" width="{svg_w}mm" height="{svg_h}mm" style="background:#0f172a; font-family:Arial, sans-serif;">',
        f'<defs><style>',
        f'  .cut {{ fill: none; stroke: #ef4444; stroke-width: 2.0; stroke-linejoin: round; }}',
        f'  .axis {{ fill: none; stroke: #38bdf8; stroke-width: 1.2; stroke-dasharray: 8,5; }}',
        f'  .dim {{ fill: none; stroke: #22c55e; stroke-width: 1.5; }}',
        f'  .title {{ fill: #f8fafc; font-size: 26px; font-weight: bold; }}',
        f'  .subtitle {{ fill: #94a3b8; font-size: 16px; }}',
        f'  .lbl {{ fill: #e2e8f0; font-size: 14px; font-weight: bold; }}',
        f'  .val {{ fill: #cbd5e1; font-size: 12px; }}',
        f'  .card {{ fill: #1e293b; stroke: #334155; stroke-width: 1.5; }}',
        f'</style></defs>',
        f'<text x="50" y="60" class="title">1 METR DIAMETRLI SHAR (D=1000 mm, R=500 mm) — 8 BO\'LAKLI LAZER KESIM CHIZMASI</text>',
        f'<text x="50" y="90" class="subtitle">Ekvator perimetri: 3141.6 mm | 8 bo\'lakka bo\'linganda har birining maksimal eni: 392.7 mm | Yarim shar bo\'yi: 785.4 mm | To\'liq shar bo\'yi: 1570.8 mm</text>'
    ]

    # SVG 8 ta yarim shar lepestogi
    for idx in range(8):
        row = idx // 4
        col = idx % 4
        gx = start_x + col * spacing_x
        gy = start_y + 30 + row * 860.0

        pts = get_gore_points_hemisphere(step_mm=10.0, offset_x=gx, offset_y=gy)
        pts_str = " ".join([f"{x:.1f},{y:.1f}" for x, y in pts])
        svg_lines.append(f'<polygon points="{pts_str}" class="cut" />')
        svg_lines.append(f'<line x1="{gx:.1f}" y1="{gy:.1f}" x2="{gx:.1f}" y2="{gy + H_HEMI:.1f}" class="axis" />')
        svg_lines.append(f'<text x="{gx - 75:.1f}" y="{gy + 50:.1f}" class="lbl">BO\'LAK #{idx+1}</text>')
        svg_lines.append(f'<text x="{gx - 65:.1f}" y="{gy + 80:.1f}" class="val">W = {W0:.1f} mm</text>')
        svg_lines.append(f'<text x="{gx - 65:.1f}" y="{gy + 105:.1f}" class="val">H = {H_HEMI:.1f} mm</text>')

    # SVG To'liq shar lepestogi
    f_pts = get_gore_points_full_sphere(step_mm=15.0, offset_x=full_gx - 100, offset_y=start_y + 30)
    f_pts_str = " ".join([f"{x:.1f},{y:.1f}" for x, y in f_pts])
    svg_lines.append(f'<polygon points="{f_pts_str}" class="cut" />')
    svg_lines.append(f'<line x1="{full_gx - 100:.1f}" y1="{start_y + 30:.1f}" x2="{full_gx - 100:.1f}" y2="{start_y + 30 + L_FULL:.1f}" class="axis" />')
    svg_lines.append(f'<line x1="{full_gx - 100 - HALF_W0:.1f}" y1="{start_y + 30 + H_HEMI:.1f}" x2="{full_gx - 100 + HALF_W0:.1f}" y2="{start_y + 30 + H_HEMI:.1f}" class="dim" />')
    svg_lines.append(f'<text x="{full_gx - 190:.1f}" y="{start_y + 30 + H_HEMI - 15:.1f}" class="lbl">TO\'LIQ SHAR BO\'LAGI (1/8)</text>')
    svg_lines.append(f'<text x="{full_gx - 190:.1f}" y="{start_y + 30 + H_HEMI + 25:.1f}" class="val">Ekvator eni: {W0:.1f} mm</text>')
    svg_lines.append(f'<text x="{full_gx - 190:.1f}" y="{start_y + 30 + H_HEMI + 45:.1f}" class="val">Bo\'yi (qutbdan qutbgacha): {L_FULL:.1f} mm</text>')

    svg_lines.append('</svg>')

    with open(SVG_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(svg_lines))
    print(f"[OK] SVG saqlandi: {SVG_PATH}")

    # =============================================================
    # HTML INTERAKTIV HISOBLAGICH VA KOORDINATALAR JADVALI
    # =============================================================
    # Koordinata nuqtalari jadvali
    coords_rows = []
    y_steps = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 785.4]
    for y_val in y_steps:
        phi = y_val / R
        phi_deg = math.degrees(phi)
        w_val = W0 * math.cos(phi)
        x_val = w_val / 2.0
        coords_rows.append(f"""
          <tr>
            <td style="font-weight:600; color:#38bdf8;">{y_val:.1f} mm</td>
            <td>{phi_deg:.1f}°</td>
            <td style="color:#22c55e; font-weight:700;">{w_val:.2f} mm</td>
            <td>± {x_val:.2f} mm</td>
          </tr>
        """)

    html_content = f"""<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8">
  <title>1m Diametrli Sharni 8 Bo'lakka Yoyish — Lazer Kesim Chizmasi</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ background: #0b0f17; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; line-height: 1.5; }}
    .container {{ max-width: 1200px; margin: 0 auto; }}
    header {{ border-bottom: 1px solid #1e293b; padding-bottom: 20px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; }}
    h1 {{ font-size: 24px; color: #38bdf8; }}
    .btn {{ background: #0284c7; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 8px; transition: 0.2s; }}
    .btn:hover {{ background: #0369a1; }}
    .grid-2 {{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }}
    @media (max-width: 850px) {{ .grid-2 {{ grid-template-columns: 1fr; }} }}
    .card {{ background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 20px; }}
    .card h2 {{ font-size: 18px; color: #f8fafc; margin-bottom: 14px; border-bottom: 1px solid #334155; padding-bottom: 8px; }}
    .param-row {{ display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #1e293b; font-size: 14px; }}
    .param-label {{ color: #94a3b8; }}
    .param-val {{ font-weight: 700; color: #38bdf8; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; }}
    th, td {{ padding: 8px 12px; text-align: left; border-bottom: 1px solid #1e293b; }}
    th {{ background: #1e293b; color: #94a3b8; }}
    tr:hover {{ background: #1e293b; }}
    .formula-box {{ background: #1e293b; border-left: 4px solid #38bdf8; padding: 14px; border-radius: 4px; font-family: monospace; font-size: 14px; margin: 12px 0; color: #7dd3fc; }}
    .svg-box {{ background: #020617; border: 1px solid #334155; border-radius: 8px; padding: 16px; overflow: auto; text-align: center; margin-top: 20px; }}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>📐 1m Diametrli Sharni 8 Bo'lakka Yoyish Chizmasi</h1>
        <p style="color: #94a3b8; font-size: 14px; margin-top: 4px;">Shar diametri: 1000 mm (Radiusi R = 500 mm) | Sektorlar soni: 8 ta lepestok</p>
      </div>
      <div style="display: flex; gap: 10px;">
        <a class="btn" href="sphere_1m_8_gores.dxf" download>💾 DXF Yuklab Olish (Lazer)</a>
        <a class="btn" href="sphere_1m_8_gores.svg" download style="background:#334155;">📐 SVG Ko'rish</a>
      </div>
    </header>

    <div class="grid-2">
      <div class="card">
        <h2>📊 Asosiy Matematik Parametrlar</h2>
        <div class="param-row"><span class="param-label">Shar Diametri (D)</span><span class="param-val">1000.0 mm (1.0 metr)</span></div>
        <div class="param-row"><span class="param-label">Shar Radiusi (R)</span><span class="param-val">500.0 mm</span></div>
        <div class="param-row"><span class="param-label">Ekvator Perimetri (C = π × D)</span><span class="param-val">3141.59 mm (3.14 metr)</span></div>
        <div class="param-row"><span class="param-label">Bo'laklar soni (N)</span><span class="param-val">8 dona</span></div>
        <div class="param-row"><span class="param-label">Har bir bo'lakning ekvatordagi maksimal eni</span><span class="param-val" style="color:#22c55e;">392.70 mm</span></div>
        <div class="param-row"><span class="param-label">Yarim shar (gumbaz) bo'yi (yoy uzunligi)</span><span class="param-val">785.40 mm</span></div>
        <div class="param-row"><span class="param-label">To'liq shar bo'yi (qutbdan qutbgacha)</span><span class="param-val">1570.80 mm</span></div>

        <h3 style="font-size: 14px; color: #cbd5e1; margin-top: 18px;">Hisoblash Formulalari:</h3>
        <div class="formula-box">
          Kenglik burchagi: φ = y / R (radian)<br>
          Eni (y masofada): W(y) = 392.70 × cos(y / 500)<br>
          Markaziy o'qdan yarim eni: X(y) = ± 196.35 × cos(y / 500)
        </div>
      </div>

      <div class="card">
        <h2>📋 Bosqichma-bosqich Nuqtalar Koordinatasi</h2>
        <p style="color:#94a3b8; font-size:12px; margin-bottom:8px;">Qo'lda chizish yoki tekshirish uchun har 50 mm dagi eni va markazdan siljishi:</p>
        <div style="max-height: 380px; overflow-y: auto;">
          <table>
            <thead>
              <tr>
                <th>Balandlik (y)</th>
                <th>Burchak (φ)</th>
                <th>To'liq Eni (W)</th>
                <th>Yarim Eni (±X)</th>
              </tr>
            </thead>
            <tbody>
              {''.join(coords_rows)}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>💡 Yig'ish va Tayyorlash Bo'yicha Tavsiyalar</h2>
      <ul style="padding-left: 20px; color: #cbd5e1; font-size: 14px; line-height: 1.7;">
        <li><strong>Material tanlash:</strong> Metall list (0.8–1.5 mm po'lat / alyuminiy), Fomiks (3–5 mm PVX), yoki Organik shisha (akril).</li>
        <li><strong>Egish usuli:</strong> Bo'laklar uzunlik bo'yicha markaziy o'qidan tashqariga sferik yoy (R = 500 mm) shaklida egiladi. Fomiks yoki akril bo'lsa, 110-130°C qurilish feni bilan qizdiriladi.</li>
        <li><strong>Choklar (Birikma):</strong> 
          Agar svarka yoki yelim chokma-chok (стык в стык) bo'lsa, chizmadagi aniq kontur bo'yicha kesiladi. Agar ustma-ust (внахлест / klepka) ulanadigan bo'lsa, har bir bo'lakning bir tarafiga 10-15 mm qo'shimcha faska (bortik) qo'shiladi.</li>
        <li><strong>Qutb tutashuvi:</strong> Sharning eng tepasida (va pastida) 8 ta bo'lak bir nuqtada birlashadi. Yig'ishni qulaylashtirish uchun qutbga Ø80-100 mm doiraviy qopqoq (shayba/flanes) qo'yish tavsiya etiladi.</li>
      </ul>
    </div>

    <div class="svg-box">
      <h3 style="color:#38bdf8; margin-bottom:12px;">1:1 Vektor Ko'rinishi (Qisqartirilgan masshtabda)</h3>
      <img src="sphere_1m_8_gores.svg" alt="1m Shar 8 bo'lak chizmasi" style="max-width:100%; height:auto; border-radius:4px;" />
    </div>
  </div>
</body>
</html>
"""

    with open(HTML_PATH, "w", encoding="utf-8") as f:
        f.write(html_content)
    print(f"[OK] HTML hisoblagich saqlandi: {HTML_PATH}")


if __name__ == "__main__":
    generate_cad_files()
