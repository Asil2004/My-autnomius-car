package uz.iiv.qalqon.camera;

import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Kichik HTTP server: noutbukdagi camera_server bilan bir xil API (HUD hech narsani o'zgartirmasdan ishlaydi).
 *   GET  /camera/status
 *   GET  /camera/stream[?lens=N]        MJPEG
 *   GET  /camera/snapshot.jpg[?lens=N]
 *   POST /camera/ptz/move   {"pan":-1..1,"tilt":-1..1,"zoom":0,"duration":0.8} yoki {"direction":"left","speed":0.5}
 *   POST /camera/ptz/stop
 * CORS va Chrome "Private Network Access" sarlavhalari bilan (planshetdagi Chrome / GitHub Pages ham ulanadi).
 */
public class CameraHttpServer {
    private static final String TAG = "QalqonCamera";
    private static final int STREAM_FPS = 15;

    private final CameraBridge bridge;
    private final int port;
    private ServerSocket server;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private volatile boolean running;

    public CameraHttpServer(CameraBridge bridge, int port) {
        this.bridge = bridge;
        this.port = port;
    }

    public void start() {
        if (running) return;
        running = true;
        pool.execute(() -> {
            try {
                // Barcha interfeyslarda: planshetning o'zi (localhost) va lokal tarmoqdagi operatorlar
                server = new ServerSocket(port, 50, InetAddress.getByName("0.0.0.0"));
                server.setReuseAddress(true);
                Log.i(TAG, "Kamera serveri: http://localhost:" + port + "/camera");
                while (running) {
                    Socket s = server.accept();
                    pool.execute(() -> handle(s));
                }
            } catch (IOException e) {
                if (running) Log.w(TAG, "HTTP server to'xtadi", e);
            }
        });
    }

    public void stop() {
        running = false;
        try {
            if (server != null) server.close();
        } catch (IOException ignored) {
        }
        pool.shutdownNow();
    }

    // ------------------------------------------------------------------------------------------------------------
    private static class Req {
        String method;
        String path;
        Map<String, String> query = new HashMap<>();
        Map<String, String> headers = new HashMap<>();
        byte[] body = new byte[0];
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 8192) throw new IOException("Juda uzun qator");
        }
        if (c == -1 && b.size() == 0) return null;
        return b.toString("UTF-8");
    }

    private static Req parse(InputStream in) throws IOException {
        String line = readLine(in);
        if (line == null || line.isEmpty()) return null;
        String[] parts = line.split(" ");
        if (parts.length < 2) return null;
        Req r = new Req();
        r.method = parts[0].toUpperCase(Locale.ROOT);
        String target = parts[1];
        int q = target.indexOf('?');
        r.path = q >= 0 ? target.substring(0, q) : target;
        if (q >= 0) {
            for (String kv : target.substring(q + 1).split("&")) {
                int e = kv.indexOf('=');
                if (e > 0) r.query.put(kv.substring(0, e), kv.substring(e + 1));
            }
        }
        String h;
        while ((h = readLine(in)) != null && !h.isEmpty()) {
            int c = h.indexOf(':');
            if (c > 0) r.headers.put(h.substring(0, c).trim().toLowerCase(Locale.ROOT), h.substring(c + 1).trim());
        }
        String cl = r.headers.get("content-length");
        if (cl != null) {
            int n = Math.min(65536, Integer.parseInt(cl));
            byte[] body = new byte[n];
            int off = 0;
            while (off < n) {
                int k = in.read(body, off, n - off);
                if (k < 0) break;
                off += k;
            }
            r.body = body;
        }
        return r;
    }

    private static String cors(Req r) {
        StringBuilder sb = new StringBuilder();
        sb.append("Access-Control-Allow-Origin: *\r\n");
        sb.append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
        sb.append("Access-Control-Allow-Headers: Content-Type\r\n");
        if ("true".equals(r.headers.get("access-control-request-private-network"))) {
            sb.append("Access-Control-Allow-Private-Network: true\r\n");
        }
        return sb.toString();
    }

    private static void send(OutputStream out, Req r, int code, String type, byte[] body) throws IOException {
        String status = code == 200 ? "OK" : code == 204 ? "No Content" : code == 404 ? "Not Found" : code == 502 ? "Bad Gateway" : code == 503 ? "Service Unavailable" : "Error";
        String head = "HTTP/1.1 " + code + " " + status + "\r\n" + cors(r)
            + "Cache-Control: no-cache, no-store, must-revalidate\r\n"
            + (type != null ? "Content-Type: " + type + "\r\n" : "")
            + "Content-Length: " + body.length + "\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.US_ASCII));
        out.write(body);
        out.flush();
    }

    private static void json(OutputStream out, Req r, int code, JSONObject o) throws IOException {
        send(out, r, code, "application/json", o.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static int lensParam(Req r) {
        String v = r.query.get("lens");
        if (v == null || v.isEmpty()) return -1;
        try {
            return Integer.parseInt(v);
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private void handle(Socket s) {
        try (Socket sock = s) {
            sock.setSoTimeout(15000);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            OutputStream out = sock.getOutputStream();
            Req r = parse(in);
            if (r == null) return;
            if ("OPTIONS".equals(r.method)) {
                send(out, r, 204, null, new byte[0]);
                return;
            }
            String p = r.path.endsWith("/") && r.path.length() > 1 ? r.path.substring(0, r.path.length() - 1) : r.path;
            switch (p) {
                case "/camera/status":
                    json(out, r, 200, bridge.statusJson());
                    return;
                case "/camera":
                case "/":
                    send(out, r, 200, "text/plain; charset=utf-8",
                        "QALQON kamera serveri (APK ichida). /camera/status, /camera/stream?lens=0".getBytes(StandardCharsets.UTF_8));
                    return;
                case "/camera/snapshot.jpg": {
                    RtspFrameSource src = bridge.source();
                    byte[] jpg = src == null ? null : src.jpeg(lensParam(r));
                    if (jpg == null) {
                        send(out, r, 503, "text/plain", "Kameradan kadr kelmadi".getBytes(StandardCharsets.UTF_8));
                    } else {
                        send(out, r, 200, "image/jpeg", jpg);
                    }
                    return;
                }
                case "/camera/stream":
                    stream(sock, out, r);
                    return;
                case "/camera/ptz/move":
                case "/camera/ptz/stop":
                    ptz(out, r, p.endsWith("stop"));
                    return;
                default:
                    send(out, r, 404, "text/plain", "Topilmadi".getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            // mijoz uzildi
        }
    }

    private void stream(Socket sock, OutputStream out, Req r) throws IOException, InterruptedException {
        sock.setSoTimeout(0);
        int lens = lensParam(r);
        String head = "HTTP/1.1 200 OK\r\n" + cors(r)
            + "Cache-Control: no-cache, no-store, must-revalidate\r\n"
            + "Content-Type: multipart/x-mixed-replace; boundary=frame\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.US_ASCII));
        out.flush();
        long last = -1;
        long interval = 1000 / STREAM_FPS;
        while (running) {
            long t0 = System.currentTimeMillis();
            RtspFrameSource src = bridge.source();
            if (src == null) {
                Thread.sleep(500);
                continue;
            }
            long id = src.waitNewer(last, 5000);
            if (id == last) continue;
            last = id;
            byte[] jpg = src.jpeg(lens);
            if (jpg == null) continue;
            out.write(("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + jpg.length + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            out.write(jpg);
            out.write("\r\n".getBytes(StandardCharsets.US_ASCII));
            out.flush();
            long wait = interval - (System.currentTimeMillis() - t0);
            if (wait > 0) Thread.sleep(wait);
        }
    }

    private void ptz(OutputStream out, Req r, boolean stop) throws IOException {
        OnvifPtz ptz = bridge.ptz();
        JSONObject res = new JSONObject();
        if (ptz == null) {
            try {
                res.put("detail", "Kamera topilmadi");
            } catch (Exception ignored) {
            }
            json(out, r, 503, res);
            return;
        }
        try {
            if (stop) {
                ptz.stop();
            } else {
                JSONObject b = new JSONObject(new String(r.body, StandardCharsets.UTF_8));
                double duration = b.optDouble("duration", 1.0);
                String dir = b.optString("direction", "");
                if (!dir.isEmpty()) {
                    double sp = Math.max(0.05, Math.min(1, b.optDouble("speed", 0.5)));
                    double dx = dir.contains("left") ? -1 : dir.contains("right") ? 1 : 0;
                    double dy = dir.contains("up") ? 1 : dir.contains("down") ? -1 : 0;
                    ptz.move(dx * sp, dy * sp, 0, duration);
                } else {
                    ptz.move(b.optDouble("pan", 0), b.optDouble("tilt", 0), b.optDouble("zoom", 0), duration);
                }
            }
            res.put("ok", true);
            json(out, r, 200, res);
        } catch (Exception e) {
            try {
                res.put("detail", "Kamera PTZ xatosi: " + e.getMessage());
            } catch (Exception ignored) {
            }
            json(out, r, 502, res);
        }
    }
}
