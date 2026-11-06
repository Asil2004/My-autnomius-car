#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
====================================================================
GEODEZIK GUMBAZ (GEODESIC DOME) — 2V IKOSAEDRAL LAZER KESIM GENERATORI
====================================================================
D = 1000 mm (R = 500 mm) — 2V chastotali geodezik gumbaz (yarim sfera).

Ikosaedr yuzalarini 2V subdivision bilan bo'lib, sfera yuzasiga proyeksiya
qilib, yuqori yarim sferadagi uchburchaklarni tekis lazer kesim chizmasiga
yoyadi. Har bir uchburchak tipi (A va B) alohida ajratiladi, montaj
quloqlari (tab) va raqamlari bilan to'liq chizma DXF, SVG va HTML
formatida chiqariladi.

Ikosaedr asoslari:
  - 12 tugun, 30 qirra, 20 yuz (teng tomonli uchburchaklar)
  - 2V bo'lingandan keyin: 42 tugun, 120 qirra, 80 yuz (to'liq sfera)
  - Yarim gumbaz (dome): ~40 ta uchburchak
  - 2 xil qirra uzunligi (A ≈ 312.87 mm, B ≈ 298.38 mm)
  - 2 xil uchburchak tipi (10 ta AAB va 30 ta ABB tipidagi)
====================================================================
"""

import math
import os
import ezdxf
from ezdxf import colors

OUTPUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "cad"))
os.makedirs(OUTPUT_DIR, exist_ok=True)

DXF_PATH = os.path.join(OUTPUT_DIR, "geodesic_dome_2v.dxf")
SVG_PATH = os.path.join(OUTPUT_DIR, "geodesic_dome_2v.svg")
HTML_PATH = os.path.join(OUTPUT_DIR, "geodesic_dome_2v_preview.html")

R = 500.0           # Sfera radiusi (mm)
D = 2 * R            # Diametr: 1000 mm
TAB_WIDTH = 15.0     # Montaj qulog'i kengligi (mm)
TAB_DEPTH = 12.0     # Montaj qulog'i chuqurligi (mm)
MATERIAL_THICK = 3.0 # Material qalinligi (mm)
SLOT_EXTRA = 0.3     # Slot toleransiyasi (+0.3 mm)

# ====================================================================
# GEOMETRIK HISOB-KITOBLAR
# ====================================================================

def normalize(v, radius=1.0):
    """Vektorni berilgan radiusga normallash"""
    mag = math.sqrt(sum(c * c for c in v))
    if mag == 0:
        return v
    return tuple(c / mag * radius for c in v)


def midpoint_on_sphere(a, b, radius=1.0):
    """Ikki nuqta orasidagi o'rta nuqtani sferaga proyeksiya qilish"""
    mid = tuple((a[i] + b[i]) / 2.0 for i in range(3))
    return normalize(mid, radius)


def edge_length_3d(a, b):
    """3D da ikki nuqta orasidagi masofa (xordal)"""
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


def geodesic_distance(a, b, radius):
    """Sfera yuzasidagi geodezik (yoy) masofa"""
    chord = edge_length_3d(a, b)
    # 2R sin(theta/2) = chord => theta = 2 arcsin(chord / 2R)
    arg = min(chord / (2.0 * radius), 1.0)
    theta = 2.0 * math.asin(arg)
    return radius * theta


def generate_icosahedron():
    """Birlik sferada ikosaedr tugunlari va yuzlarini yaratish"""
    phi = (1.0 + math.sqrt(5.0)) / 2.0  # Oltin nisbat ≈ 1.618

    # 12 ta tugun (normalized to unit sphere)
    raw_verts = [
        (-1,  phi,  0), ( 1,  phi,  0), (-1, -phi,  0), ( 1, -phi,  0),
        ( 0, -1,  phi), ( 0,  1,  phi), ( 0, -1, -phi), ( 0,  1, -phi),
        ( phi,  0, -1), ( phi,  0,  1), (-phi,  0, -1), (-phi,  0,  1),
    ]
    verts = [normalize(v) for v in raw_verts]

    # 20 ta yuz (uchburchak indekslari, soat strelkasiga qarshi)
    faces = [
        (0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
        (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
        (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
        (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1),
    ]
    return verts, faces


def subdivide_2v(verts, faces):
    """Har bir uchburchakni 2V (4 ta kichik uchburchak) ga bo'lish"""
    edge_midpoints = {}
    new_verts = list(verts)

    def get_midpoint_index(i, j):
        key = (min(i, j), max(i, j))
        if key in edge_midpoints:
            return edge_midpoints[key]
        mid = midpoint_on_sphere(new_verts[i], new_verts[j])
        idx = len(new_verts)
        new_verts.append(mid)
        edge_midpoints[key] = idx
        return idx

    new_faces = []
    for (a, b, c) in faces:
        ab = get_midpoint_index(a, b)
        bc = get_midpoint_index(b, c)
        ac = get_midpoint_index(a, c)
        new_faces.append((a, ab, ac))
        new_faces.append((b, bc, ab))
        new_faces.append((c, ac, bc))
        new_faces.append((ab, bc, ac))

    return new_verts, new_faces


def get_dome_faces(verts, faces, min_z=-0.15):
    """
    Gumbaz (yarim sfera) uchburchaklarini tanlash.
    Uchburchakning barcha uchlarining o'rtacha z koordinatasi
    min_z dan katta bo'lsa tanlanadi.
    """
    dome = []
    for (a, b, c) in faces:
        avg_z = (verts[a][2] + verts[b][2] + verts[c][2]) / 3.0
        if avg_z >= min_z:
            dome.append((a, b, c))
    return dome


def flatten_triangle(a, b, c, radius):
    """
    Sferadagi 3D uchburchakni 2D tekislikka yoyish.
    Geodezik yoy masofalarini ishlatadi.
    Natija: 3 ta (x, y) koordinata.
    """
    # Qirralarning geodezik uzunliklari
    lab = geodesic_distance(a, b, radius)
    lbc = geodesic_distance(b, c, radius)
    lac = geodesic_distance(a, c, radius)

    # A nuqtani (0, 0) ga, B nuqtani (lab, 0) ga qo'yamiz
    ax, ay = 0.0, 0.0
    bx, by = lab, 0.0

    # C nuqtani kosinus teoremasi bilan hisoblaymiz
    # lac^2 = cx^2 + cy^2
    # lbc^2 = (cx - bx)^2 + cy^2
    # => cx = (lac^2 - lbc^2 + lab^2) / (2 * lab)
    if lab > 0:
        cx = (lac * lac - lbc * lbc + lab * lab) / (2.0 * lab)
    else:
        cx = 0.0
    cy_sq = lac * lac - cx * cx
    cy = math.sqrt(max(0.0, cy_sq))

    return [(ax, ay), (bx, by), (cx, cy)]


def add_triangle_with_tabs(msp, pts_2d, offset_x, offset_y, tri_id, layer="CUT", svg_els=None):
    """
    Uchburchakni DXF va SVG ga chizish (montaj quloqlari bilan).
    pts_2d: [(x0,y0), (x1,y1), (x2,y2)] — tekislangan uchburchak koordinatalari.
    """
    # Offset qo'shish
    pts = [(p[0] + offset_x, p[1] + offset_y) for p in pts_2d]

    # Asosiy uchburchak konturi
    msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": layer})
    if svg_els is not None:
        pts_str = " ".join([f"{x:.2f},{y:.2f}" for x, y in pts])
        svg_els.append(f'<polygon points="{pts_str}" class="cut" />')

    # Har bir qirra o'rtasiga montaj qulog'i (tab)
    for i in range(3):
        j = (i + 1) % 3
        ax, ay = pts[i]
        bx, by = pts[j]

        # Qirra o'rtasi va normal yo'nalishi
        mx, my = (ax + bx) / 2.0, (ay + by) / 2.0
        dx, dy = bx - ax, by - ay
        edge_len = math.sqrt(dx * dx + dy * dy)
        if edge_len < 1.0:
            continue

        # Tashqariga qaratilgan normal
        nx, ny = -dy / edge_len, dx / edge_len

        # Tab o'lchamlari (qirra uzunligining 30% i)
        tw = edge_len * 0.30
        # Tab uchi nuqtalari
        half_tw = tw / 2.0
        # Qirra bo'ylab yo'nalish
        ex, ey = dx / edge_len, dy / edge_len

        tab_pts = [
            (mx - half_tw * ex, my - half_tw * ey),
            (mx - half_tw * ex + TAB_DEPTH * nx, my - half_tw * ey + TAB_DEPTH * ny),
            (mx + half_tw * ex + TAB_DEPTH * nx, my + half_tw * ey + TAB_DEPTH * ny),
            (mx + half_tw * ex, my + half_tw * ey),
        ]
        msp.add_lwpolyline(tab_pts, close=False, dxfattribs={"layer": "TABS"})
        if svg_els is not None:
            tp_str = " ".join([f"{x:.2f},{y:.2f}" for x, y in tab_pts])
            svg_els.append(f'<polyline points="{tp_str}" class="tab" />')

    # Raqam yozuvi
    cx = sum(p[0] for p in pts) / 3.0
    cy = sum(p[1] for p in pts) / 3.0
    msp.add_text(tri_id, dxfattribs={"layer": "ANNOTATIONS", "height": 12}).set_placement((cx - 10, cy - 5))
    if svg_els is not None:
        svg_els.append(f'<text x="{cx:.1f}" y="{cy:.1f}" class="tri-id">{tri_id}</text>')


def classify_triangles(verts, faces, radius):
    """Uchburchaklarni qirra uzunliklari bo'yicha tiplashtirish"""
    types = {}
    tri_data = []

    for idx, (a, b, c) in enumerate(faces):
        va, vb, vc = verts[a], verts[b], verts[c]
        edges_raw = sorted([
            geodesic_distance(va, vb, radius),
            geodesic_distance(vb, vc, radius),
            geodesic_distance(va, vc, radius),
        ])
        # Ikki xonaga yaxlitlab guruhlash
        key = tuple(round(e, 1) for e in edges_raw)
        if key not in types:
            types[key] = chr(65 + len(types))  # A, B, C, ...
        tri_type = types[key]
        flat_pts = flatten_triangle(va, vb, vc, radius)
        tri_data.append({
            "idx": idx,
            "face": (a, b, c),
            "type": tri_type,
            "edges": edges_raw,
            "flat_pts": flat_pts,
        })

    return tri_data, types


def generate_all():
    print("=" * 60)
    print("GEODEZIK GUMBAZ 2V — LAZER KESIM CHIZMASI GENERATSIYASI")
    print("=" * 60)

    # 1. Ikosaedr yaratish va 2V bo'lish
    verts, faces = generate_icosahedron()
    print(f"[1/6] Ikosaedr: {len(verts)} tugun, {len(faces)} yuz")

    verts, faces = subdivide_2v(verts, faces)
    print(f"[2/6] 2V Subdiviziya: {len(verts)} tugun, {len(faces)} yuz")

    # Sferaga masshtablash (R = 500 mm)
    verts = [normalize(v, R) for v in verts]

    # 2. Gumbaz (yuqori yarim sfera) yuzlarini tanlash
    dome_faces = get_dome_faces(verts, faces, min_z=-0.08 * R)
    print(f"[3/6] Gumbaz yuzlari: {len(dome_faces)} ta uchburchak")

    # 3. Uchburchaklarni tiplashtirish
    tri_data, types = classify_triangles(verts, dome_faces, R)
    print(f"[4/6] Uchburchak tiplari: {len(types)} xil")
    for key, label in sorted(types.items(), key=lambda x: x[1]):
        count = sum(1 for t in tri_data if t["type"] == label)
        print(f"       Tip {label}: qirralar = ({key[0]:.1f}, {key[1]:.1f}, {key[2]:.1f}) mm — {count} dona")

    # ================================================================
    # DXF FAYL GENERATSIYASI
    # ================================================================
    doc = ezdxf.new("R2010", setup=True)
    msp = doc.modelspace()

    doc.layers.add("CUT", color=colors.RED)
    doc.layers.add("TABS", color=colors.YELLOW)
    doc.layers.add("AXIS", color=colors.BLUE)
    doc.layers.add("ANNOTATIONS", color=colors.WHITE)
    doc.layers.add("DIMENSIONS", color=colors.GREEN)

    svg_els = []

    # Uchburchaklarni tiplar bo'yicha guruhlash
    type_groups = {}
    for td in tri_data:
        t = td["type"]
        if t not in type_groups:
            type_groups[t] = []
        type_groups[t].append(td)

    # Varaq hajmi (yetarli katta)
    sheet_w = 2400.0
    sheet_h = 1800.0
    msp.add_lwpolyline([(0, 0), (sheet_w, 0), (sheet_w, sheet_h), (0, sheet_h)], close=True, dxfattribs={"layer": "ANNOTATIONS"})
    svg_els.append(f'<rect x="0" y="0" width="{sheet_w}" height="{sheet_h}" class="bed-border" />')

    # Sarlavha
    title = f"GEODEZIK GUMBAZ 2V (D={int(D)}mm, R={int(R)}mm) — {len(dome_faces)} TA UCHBURCHAK LAZER KESIM CHIZMASI"
    msp.add_text(title, dxfattribs={"layer": "ANNOTATIONS", "height": 22}).set_placement((30, sheet_h - 50))
    svg_els.append(f'<text x="30" y="40" class="header">{title}</text>')

    # Har bir tip uchun uchburchaklarni joylash
    current_x = 40.0
    current_y = 80.0
    row_max_h = 0.0
    col_count = 0
    max_cols_per_row = 8

    for type_label in sorted(type_groups.keys()):
        group = type_groups[type_label]
        sample = group[0]
        edges = sample["edges"]
        flat = sample["flat_pts"]

        # Uchburchak gabariti
        xs = [p[0] for p in flat]
        ys = [p[1] for p in flat]
        tw = max(xs) - min(xs) + TAB_DEPTH * 2 + 30
        th = max(ys) - min(ys) + TAB_DEPTH * 2 + 50

        # Tip sarlavhasi
        tip_text = f"TIP {type_label}: {len(group)} dona | Qirralar: {edges[0]:.1f} / {edges[1]:.1f} / {edges[2]:.1f} mm"
        if current_x + tw * min(len(group), max_cols_per_row) > sheet_w - 40:
            current_x = 40.0
            current_y += row_max_h + 60
            row_max_h = 0.0

        msp.add_text(tip_text, dxfattribs={"layer": "DIMENSIONS", "height": 14}).set_placement((current_x, current_y))
        svg_els.append(f'<text x="{current_x:.1f}" y="{current_y + 12:.1f}" class="type-title">{tip_text}</text>')
        current_y += 30

        col_in_type = 0
        type_start_x = current_x
        type_row_start_y = current_y

        for i, td in enumerate(group):
            if col_in_type >= max_cols_per_row:
                col_in_type = 0
                current_x = type_start_x
                current_y += th

            ox = current_x + TAB_DEPTH + 10
            oy = current_y + TAB_DEPTH + 10
            tri_id = f"{type_label}{i+1}"

            add_triangle_with_tabs(msp, td["flat_pts"], ox, oy, tri_id, svg_els=svg_els)

            current_x += tw
            row_max_h = max(row_max_h, th)
            col_in_type += 1

        current_x = 40.0
        current_y += th + 20
        row_max_h = 0.0

    doc.saveas(DXF_PATH)
    print(f"[5/6] DXF saqlandi: {DXF_PATH}")

    # ================================================================
    # SVG FAYL
    # ================================================================
    svg_content = f"""<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 {sheet_w} {sheet_h}"
     width="{sheet_w}mm" height="{sheet_h}mm"
     style="background:#0b1121; font-family:'Segoe UI', Arial, sans-serif;">
<defs>
  <style>
    .bed-border {{ fill: #111827; stroke: #334155; stroke-width: 1.5; stroke-dasharray: 8,4; }}
    .cut {{ fill: rgba(239,68,68,0.08); stroke: #ef4444; stroke-width: 1.8; stroke-linejoin: round; }}
    .tab {{ fill: none; stroke: #eab308; stroke-width: 1.2; stroke-dasharray: 5,3; }}
    .header {{ fill: #38bdf8; font-size: 20px; font-weight: bold; }}
    .type-title {{ fill: #22c55e; font-size: 14px; font-weight: 600; }}
    .tri-id {{ fill: #e2e8f0; font-size: 13px; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }}
  </style>
</defs>
{''.join(svg_els)}
</svg>
"""
    with open(SVG_PATH, "w", encoding="utf-8") as f:
        f.write(svg_content)
    print(f"[5/6] SVG saqlandi: {SVG_PATH}")

    # ================================================================
    # HTML INTERAKTIV VIZUAL PANEL
    # ================================================================
    # Statistikalar
    all_edges_set = set()
    for td in tri_data:
        for e in td["edges"]:
            all_edges_set.add(round(e, 1))
    all_edges_sorted = sorted(all_edges_set)

    type_rows_html = ""
    for type_label in sorted(type_groups.keys()):
        group = type_groups[type_label]
        edges = group[0]["edges"]
        flat = group[0]["flat_pts"]
        # Uchburchak yuzasi (Geron formulasi)
        a_e, b_e, c_e = edges
        s = (a_e + b_e + c_e) / 2.0
        area = math.sqrt(max(0, s * (s - a_e) * (s - b_e) * (s - c_e)))
        total_area = area * len(group)

        color = "#ef4444" if type_label == "A" else "#3b82f6" if type_label == "B" else "#22c55e"
        type_rows_html += f"""
        <tr>
          <td><span style="color:{color}; font-weight:800; font-size:18px;">{type_label}</span></td>
          <td style="font-weight:700;">{len(group)} dona</td>
          <td>{edges[0]:.2f} mm</td>
          <td>{edges[1]:.2f} mm</td>
          <td>{edges[2]:.2f} mm</td>
          <td>{area:.1f} mm&sup2;</td>
          <td style="color:#38bdf8;">{total_area / 1e4:.2f} dm&sup2;</td>
        </tr>
        """

    total_panels = len(tri_data)
    total_surface = sum(
        math.sqrt(max(0, ((sum(td["edges"])/2) * (sum(td["edges"])/2 - td["edges"][0]) * (sum(td["edges"])/2 - td["edges"][1]) * (sum(td["edges"])/2 - td["edges"][2]))))
        for td in tri_data
    )

    # 3D geodezik gumbaz vizualizatsiyasi uchun tugunlarni tayyorlash
    dome_verts_json = []
    dome_faces_json = []
    for td in tri_data:
        a, b, c = td["face"]
        base_idx = len(dome_verts_json)
        for vi in [a, b, c]:
            v = verts[vi]
            dome_verts_json.append({"x": round(v[0], 2), "y": round(v[1], 2), "z": round(v[2], 2)})
        dome_faces_json.append({"a": base_idx, "b": base_idx+1, "c": base_idx+2, "type": td["type"]})

    import json
    verts_js = json.dumps(dome_verts_json)
    faces_js = json.dumps(dome_faces_json)

    html_content = f"""<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8">
  <title>Geodezik Gumbaz 2V — D={int(D)}mm Lazer Kesim Chizmasi</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ background: #0b0f17; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }}
    .top-bar {{ background: #111827; border-bottom: 1px solid #1e293b; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }}
    .top-bar h1 {{ font-size: 20px; color: #38bdf8; }}
    .badge {{ background: #0284c7; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 4px; text-transform: uppercase; }}
    .btns {{ display: flex; gap: 10px; }}
    .btn {{ background: #1e293b; color: #38bdf8; border: 1px solid #334155; padding: 8px 14px; border-radius: 6px; font-size: 13px; text-decoration: none; font-weight: 600; transition: 0.2s; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }}
    .btn:hover {{ background: #0284c7; color: #fff; border-color: #0284c7; }}

    .layout {{ display: grid; grid-template-columns: 1fr 1fr; gap: 0; height: calc(100vh - 65px); }}
    @media (max-width: 1000px) {{ .layout {{ grid-template-columns: 1fr; height: auto; }} }}

    .panel-3d {{ position: relative; background: #020617; border-right: 1px solid #1e293b; overflow: hidden; min-height: 500px; }}
    canvas {{ display: block; width: 100%; height: 100%; }}
    .panel-info {{ overflow-y: auto; padding: 24px; }}

    .card {{ background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 18px; margin-bottom: 18px; }}
    .card h2 {{ font-size: 16px; color: #f8fafc; margin-bottom: 14px; border-bottom: 1px solid #334155; padding-bottom: 8px; }}
    .stat-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }}
    .stat {{ background: #1e293b; border-radius: 6px; padding: 10px 14px; }}
    .stat .label {{ font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }}
    .stat .value {{ font-size: 20px; font-weight: 700; color: #38bdf8; margin-top: 2px; }}
    .stat .value.red {{ color: #ef4444; }}
    .stat .value.green {{ color: #22c55e; }}

    table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    th, td {{ padding: 8px 10px; text-align: left; border-bottom: 1px solid #1e293b; }}
    th {{ background: #1e293b; color: #64748b; font-size: 11px; text-transform: uppercase; }}
    tr:hover {{ background: #1e293b; }}

    .step-list {{ list-style: none; counter-reset: s; padding: 0; }}
    .step-list li {{ position: relative; padding-left: 30px; margin-bottom: 12px; color: #cbd5e1; line-height: 1.5; font-size: 13px; }}
    .step-list li::before {{ content: counter(s); counter-increment: s; position: absolute; left: 0; top: 0; width: 22px; height: 22px; background: #0369a1; color: #fff; border-radius: 50%; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }}
  </style>
</head>
<body>
  <div class="top-bar">
    <div style="display:flex; align-items:center; gap:12px;">
      <span class="badge">Geodezik 2V</span>
      <h1>Geodezik Gumbaz — D={int(D)} mm Lazer Kesim Chizmasi</h1>
    </div>
    <div class="btns">
      <a class="btn" href="geodesic_dome_2v.dxf" download>DXF Yuklab Olish (Lazer)</a>
      <a class="btn" href="geodesic_dome_2v.svg" download>SVG Ko'rish (CorelDraw)</a>
    </div>
  </div>

  <div class="layout">
    <div class="panel-3d">
      <canvas id="domeCanvas"></canvas>
      <div style="position:absolute; bottom:12px; left:12px; color:#475569; font-size:11px;">Sichqoncha bilan aylantiring | Scroll bilan kattalashtiring</div>
    </div>

    <div class="panel-info">
      <div class="card">
        <h2>Asosiy Parametrlar</h2>
        <div class="stat-grid">
          <div class="stat"><div class="label">Shar Diametri (D)</div><div class="value">{int(D)} mm</div></div>
          <div class="stat"><div class="label">Shar Radiusi (R)</div><div class="value">{int(R)} mm</div></div>
          <div class="stat"><div class="label">Chastota (Frequency)</div><div class="value">2V</div></div>
          <div class="stat"><div class="label">Jami Panellar</div><div class="value red">{total_panels} dona</div></div>
          <div class="stat"><div class="label">Panel Tiplari</div><div class="value green">{len(types)} xil</div></div>
          <div class="stat"><div class="label">Umumiy Sirt Yuzasi</div><div class="value">{total_surface / 1e4:.1f} dm&sup2;</div></div>
        </div>
      </div>

      <div class="card">
        <h2>Uchburchak Tiplari va O'lchamlari</h2>
        <table>
          <thead>
            <tr><th>Tip</th><th>Soni</th><th>Qirra 1</th><th>Qirra 2</th><th>Qirra 3</th><th>Yuza (1 ta)</th><th>Jami Yuza</th></tr>
          </thead>
          <tbody>
            {type_rows_html}
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>Yig'ish Yo'riqnomasi</h2>
        <ol class="step-list">
          <li><strong>Lazerda kesish:</strong> DXF fayldagi QIZIL konturlar bo'yicha barcha uchburchak panellarni kesib oling. Sariq chiziqlar — montaj quloqlari (tab) chiziqlari.</li>
          <li><strong>Panellarni guruhlash:</strong> Har bir panelda Tip harfi va raqam (masalan, A1, A2... B1, B2...) yozilgan. Shu belgi bo'yicha guruhlang.</li>
          <li><strong>Tepadan (qutb) boshlash:</strong> 5 ta A tipidagi uchburchakni pentagonsimon qilib orasiga 5 ta B tipidagilarni qo'yib, yuqoridan pasga qarab spiral shaklda yig'ing.</li>
          <li><strong>Biriktirish usuli:</strong> Tab-Slot: quloqlarni qo'shni panelning ichiga bukib yelim yoki vint bilan mahkamlang. Metall bo'lsa — pop-rivets yoki jihoz vintlari.</li>
          <li><strong>Ekvator halqasi:</strong> Eng pastki qatordagi panellarning pastki qirrasiga tekis baza halqasi (doiraviy yoki beshburchak flanes) ulang.</li>
        </ol>
      </div>
    </div>
  </div>

  <script>
    // 3D Geodezik Gumbaz Interaktiv Vizualizatsiyasi (Canvas 2D Projection)
    const verts = {verts_js};
    const faces = {faces_js};
    const canvas = document.getElementById('domeCanvas');
    const ctx = canvas.getContext('2d');
    let rotY = -0.4, rotX = 0.5, scale = 0.6, dragging = false, lastX = 0, lastY = 0;

    function resize() {{
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
      draw();
    }}
    window.addEventListener('resize', resize);

    function project(v) {{
      // Rotate Y
      let x = v.x * Math.cos(rotY) - v.z * Math.sin(rotY);
      let z = v.x * Math.sin(rotY) + v.z * Math.cos(rotY);
      let y = v.y;
      // Rotate X
      let y2 = y * Math.cos(rotX) - z * Math.sin(rotX);
      let z2 = y * Math.sin(rotX) + z * Math.cos(rotX);
      let s = canvas.width * scale / 1200;
      return {{ x: canvas.width / 2 + x * s, y: canvas.height / 2 - y2 * s, z: z2 }};
    }}

    function draw() {{
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Yuzalarni chizish (Z-sort)
      let tris = faces.map((f, i) => {{
        let pa = project(verts[f.a]), pb = project(verts[f.b]), pc = project(verts[f.c]);
        let avgZ = (pa.z + pb.z + pc.z) / 3;
        return {{ pa, pb, pc, type: f.type, z: avgZ }};
      }});
      tris.sort((a, b) => a.z - b.z);

      for (let t of tris) {{
        ctx.beginPath();
        ctx.moveTo(t.pa.x, t.pa.y);
        ctx.lineTo(t.pb.x, t.pb.y);
        ctx.lineTo(t.pc.x, t.pc.y);
        ctx.closePath();
        let brightness = Math.max(0.15, Math.min(0.7, 0.3 + t.z / 800));
        if (t.type === 'A') {{
          ctx.fillStyle = `rgba(239, 68, 68, ${{brightness}})`;
          ctx.strokeStyle = `rgba(239, 68, 68, ${{brightness + 0.3}})`;
        }} else {{
          ctx.fillStyle = `rgba(59, 130, 246, ${{brightness}})`;
          ctx.strokeStyle = `rgba(59, 130, 246, ${{brightness + 0.3}})`;
        }}
        ctx.lineWidth = 1.2;
        ctx.fill();
        ctx.stroke();
      }}

      // Legenda
      ctx.font = '13px "Segoe UI", sans-serif';
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(16, 16, 14, 14);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText('Tip A', 36, 28);
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(16, 38, 14, 14);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText('Tip B', 36, 50);
    }}

    canvas.addEventListener('mousedown', e => {{ dragging = true; lastX = e.clientX; lastY = e.clientY; }});
    canvas.addEventListener('mousemove', e => {{
      if (!dragging) return;
      rotY += (e.clientX - lastX) * 0.008;
      rotX += (e.clientY - lastY) * 0.008;
      rotX = Math.max(-1.2, Math.min(1.2, rotX));
      lastX = e.clientX; lastY = e.clientY;
      draw();
    }});
    canvas.addEventListener('mouseup', () => dragging = false);
    canvas.addEventListener('mouseleave', () => dragging = false);
    canvas.addEventListener('wheel', e => {{
      e.preventDefault();
      scale = Math.max(0.2, Math.min(2.0, scale - e.deltaY * 0.001));
      draw();
    }}, {{ passive: false }});

    // Touch support
    canvas.addEventListener('touchstart', e => {{
      if (e.touches.length === 1) {{ dragging = true; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; }}
    }});
    canvas.addEventListener('touchmove', e => {{
      if (!dragging || e.touches.length !== 1) return;
      e.preventDefault();
      rotY += (e.touches[0].clientX - lastX) * 0.008;
      rotX += (e.touches[0].clientY - lastY) * 0.008;
      rotX = Math.max(-1.2, Math.min(1.2, rotX));
      lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
      draw();
    }}, {{ passive: false }});
    canvas.addEventListener('touchend', () => dragging = false);

    // Auto rotate
    let autoRot = setInterval(() => {{ if (!dragging) {{ rotY += 0.006; draw(); }} }}, 30);
    resize();
  </script>
</body>
</html>
"""

    with open(HTML_PATH, "w", encoding="utf-8") as f:
        f.write(html_content)
    print(f"[6/6] HTML vizual panel saqlandi: {HTML_PATH}")
    print("=" * 60)
    print(f"JAMI: {total_panels} ta uchburchak panel, {len(types)} xil tip")
    print(f"Umumiy sirt yuzasi: {total_surface / 1e4:.2f} dm2 ({total_surface / 1e6:.4f} m2)")
    print("=" * 60)


if __name__ == "__main__":
    generate_all()
