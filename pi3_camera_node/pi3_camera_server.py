#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, sys, time, json, socket, threading
from concurrent.futures import ThreadPoolExecutor
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
import cv2

PORT = 8080
CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "camera_config.json")

class State:
    ip, ch, url = None, 0, ""
    jpeg, fps, running = None, 0.0, True
    lock = threading.Lock()

state = State()

def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()

def scan_cam():
    my_ip = get_ip()
    pref = ".".join(my_ip.split(".")[:3]) + "."
    print(f"[*] Wi-Fi skanerlanmoqda: {pref}1-254 ...")
    found = []
    def check(i):
        tip = f"{pref}{i}"
        if tip == my_ip: return None
        for p in (554, 8899):
            try:
                s = socket.socket()
                s.settimeout(0.25)
                if s.connect_ex((tip, p)) == 0:
                    s.close(); return tip
                s.close()
            except Exception: pass
        return None
    with ThreadPoolExecutor(max_workers=50) as ex:
        for r in ex.map(check, range(1, 255)):
            if r: found.append(r)
    if found:
        cam_ip = found[0]
        print(f"[✓] Kamera topildi: {cam_ip}")
        state.ip = cam_ip
        set_channel(state.ch)
        try:
            with open(CONFIG, "w") as f:
                json.dump({"ip": cam_ip}, f)
        except Exception: pass
        return True
    print("[XATO] Kamera topilmadi!")
    return False

def set_channel(ch_id):
    with state.lock:
        state.ch = ch_id
        if state.ip:
            state.url = f"rtsp://{state.ip}:554/live/ch{ch_id}"
            print(f"[*] Kanal tanlandi: Linz {ch_id + 1} -> {state.url}")

def video_worker():
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|analyzeduration;1000000|max_delay;500000"
    cap, cur_url = None, ""
    fps_cnt, last_t = 0, time.time()
    while state.running:
        with state.lock:
            url = state.url
        if not url:
            time.sleep(1); continue
        if cap is None or url != cur_url:
            if cap: cap.release()
            cur_url = url
            cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if not cap.isOpened():
                time.sleep(2); cap = None; continue
        ret, frame = cap.read()
        if not ret or frame is None:
            time.sleep(0.05); continue
        fps_cnt += 1
        now = time.time()
        if now - last_t >= 1.0:
            with state.lock: state.fps = round(fps_cnt / (now - last_t), 1)
            fps_cnt, last_t = 0, now
        ok, buf = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
        if ok:
            with state.lock: state.jpeg = buf.tobytes()
        time.sleep(0.01)
    if cap: cap.release()

HTML = """<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QALQON - Pi3 Kamera</title>
<style>
body{margin:0;background:#090d16;color:#f1f5f9;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;padding:12px}
.box{max-width:850px;width:100%;background:#131b2e;border-radius:12px;overflow:hidden;border:1px solid #1e293b}
.bar{padding:12px 16px;display:flex;justify-content:space-between;align-items:center;background:#0d1527}
.btn{background:#1e293b;color:#f1f5f9;border:1px solid #334155;padding:10px 16px;border-radius:8px;font-weight:700;cursor:pointer;margin-right:6px}
.btn.act{background:#38bdf8;color:#090d16}
.btn.sc{background:#10b981;color:#090d16}
img{width:100%;max-height:75vh;object-fit:contain;background:#000;display:block}
</style></head><body>
<div class="box">
  <div class="bar">
    <b>🛡️ QALQON Pi3B Kamera</b>
    <span id="st" style="color:#38bdf8">-- FPS</span>
  </div>
  <img id="im" src="/stream" alt="Video">
  <div class="bar">
    <div>
      <button class="btn act" onclick="setCh(0,this)">Linz 1 (PTZ)</button>
      <button class="btn" onclick="setCh(1,this)">Linz 2 (PTZ)</button>
      <button class="btn" onclick="setCh(2,this)">Linz 3 (Gumbaz)</button>
    </div>
    <button class="btn sc" onclick="scan()">🔍 Avto-Qidirish</button>
  </div>
</div>
<script>
function setCh(i,el){
  fetch('/ch?id='+i).then(()=>{
    document.querySelectorAll('.btn').forEach(b=>b.classList.remove('act'));
    el.classList.add('act');
    document.getElementById('im').src='/stream?t='+Date.now();
  });
}
function scan(){
  fetch('/scan').then(r=>r.text()).then(t=>alert(t));
}
setInterval(()=>{
  fetch('/fps').then(r=>r.text()).then(f=>{document.getElementById('st').innerText=f+' FPS';});
},2000);
</script></body></html>"""

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path in ('/', '/index.html'):
            self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8'); self.end_headers()
            self.wfile.write(HTML.encode('utf-8'))
        elif self.path.startswith('/stream'):
            self.send_response(200); self.send_header('Content-Type','multipart/x-mixed-replace; boundary=f'); self.end_headers()
            while state.running:
                with state.lock: j = state.jpeg
                if j:
                    try: self.wfile.write(b"--f\r\nContent-Type: image/jpeg\r\n\r\n" + j + b"\r\n")
                    except Exception: break
                time.sleep(0.04)
        elif self.path.startswith('/ch'):
            try: set_channel(int(self.path.split('id=')[1].split('&')[0]))
            except Exception: pass
            self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
        elif self.path.startswith('/scan'):
            ok = scan_cam()
            self.send_response(200); self.end_headers()
            self.wfile.write(f"Kamera: {state.ip}".encode('utf-8') if ok else b"Topilmadi!")
        elif self.path.startswith('/fps'):
            self.send_response(200); self.end_headers()
            self.wfile.write(str(state.fps).encode('utf-8'))

class Server(ThreadingMixIn, HTTPServer): daemon_threads = True

def main():
    if os.path.exists(CONFIG):
        try:
            with open(CONFIG) as f: state.ip = json.load(f).get("ip")
            set_channel(0)
        except Exception: pass
    if not state.ip: threading.Thread(target=scan_cam, daemon=True).start()
    threading.Thread(target=video_worker, daemon=True).start()
    ip = get_ip()
    print("="*55)
    print(f"🚀 SERVER ISHGA TUSHTI: http://{ip}:{PORT}")
    print("="*55)
    try: Server(('0.0.0.0', PORT), Handler).serve_forever()
    except KeyboardInterrupt: state.running = False

if __name__ == '__main__': main()
