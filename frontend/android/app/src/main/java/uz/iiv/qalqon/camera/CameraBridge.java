package uz.iiv.qalqon.camera;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONObject;

import java.util.List;

/**
 * APK ichidagi kamera serveri (noutbukdagi camera_server o'rnida): CP-159-1 (V380) uch linzali PTZ kamera planshetga
 * Ethernet (ulashish rejimi) bilan ulanadi. Kamera avtomatik topiladi, RTSP video MJPEG ga aylantiriladi, PTZ ONVIF
 * orqali boshqariladi. HUD (APK ham, planshetdagi Chrome ham) http://localhost:8090/camera dan foydalanadi.
 */
public final class CameraBridge {
    private static final String TAG = "QalqonCamera";
    public static final int HTTP_PORT = 8090;
    private static final int ONVIF_PORT = 8899;
    private static final String PREFS = "qalqon_camera";

    private static CameraBridge instance;

    private final Context ctx;
    private final CameraHttpServer http;
    private volatile String host;
    private volatile RtspFrameSource source;
    private volatile OnvifPtz ptz;
    private volatile String state = "Kamera qidirilmoqda";
    private volatile boolean running;
    private Thread supervisor;

    private CameraBridge(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.http = new CameraHttpServer(this, HTTP_PORT);
    }

    public static synchronized CameraBridge get(Context ctx) {
        if (instance == null) instance = new CameraBridge(ctx);
        return instance;
    }

    public synchronized void start() {
        if (running) return;
        running = true;
        http.start();
        supervisor = new Thread(this::superviseLoop, "QalqonCameraSupervisor");
        supervisor.setDaemon(true);
        supervisor.start();
    }

    public synchronized void stop() {
        running = false;
        if (supervisor != null) supervisor.interrupt();
        http.stop();
        closeCamera();
    }

    RtspFrameSource source() {
        return source;
    }

    OnvifPtz ptz() {
        return ptz;
    }

    private void closeCamera() {
        if (source != null) source.stop();
        if (ptz != null) ptz.close();
        source = null;
        ptz = null;
    }

    /**
     * Nazoratchi: kamera topilmagan bo'lsa qidiradi; video 15 s kelmasa (kabel uzildi, IP o'zgardi) qaytadan qidiradi.
     */
    private void superviseLoop() {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long noFrameSince = 0;
        while (running) {
            try {
                if (source == null) {
                    state = "Kamera qidirilmoqda (Ethernet)";
                    String found = CameraDiscovery.find(prefs.getString("host", null), ONVIF_PORT);
                    if (found == null) {
                        state = "Kamera topilmadi: Ethernet kabeli va 'Ethernet orqali ulashish' ni tekshiring";
                        Thread.sleep(4000);
                        continue;
                    }
                    host = found;
                    prefs.edit().putString("host", found).apply();
                    OnvifPtz p = new OnvifPtz(found, ONVIF_PORT);
                    // Yengil ikkinchi oqim (640x1080 = 3 x 640x360) planshet uchun yetarli va tez; topilmasa asosiy
                    int w = 640;
                    int h = 1080;
                    String path = "/live/ch00_1";
                    try {
                        List<OnvifPtz.Profile> list = p.profiles();
                        if (list.size() > 1 && list.get(1).width > 0) {
                            w = list.get(1).width;
                            h = list.get(1).height;
                        } else if (!list.isEmpty() && list.get(0).width > 0) {
                            w = list.get(0).width;
                            h = list.get(0).height;
                            path = "/live/ch00_0";
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "ONVIF profillari olinmadi: " + e.getMessage());
                    }
                    ptz = p;
                    RtspFrameSource s = new RtspFrameSource(found, 554, path, w, h, 75);
                    s.start(ctx);
                    source = s;
                    state = "Kamera: " + found;
                    noFrameSince = System.currentTimeMillis();
                    Log.i(TAG, "Kamera topildi: " + found + " " + w + "x" + h);
                } else if (source.connected()) {
                    noFrameSince = 0;
                } else {
                    if (noFrameSince == 0) noFrameSince = System.currentTimeMillis();
                    if (System.currentTimeMillis() - noFrameSince > 15000) {
                        Log.w(TAG, "Video kelmayapti: kamera qaytadan qidiriladi");
                        closeCamera();
                        noFrameSince = 0;
                    }
                }
                Thread.sleep(2000);
            } catch (InterruptedException e) {
                return;
            } catch (Exception e) {
                Log.w(TAG, "Nazoratchi xatosi", e);
            }
        }
    }

    /** camera_server /camera/status bilan bir xil ko'rinish */
    JSONObject statusJson() {
        JSONObject o = new JSONObject();
        try {
            JSONObject v = new JSONObject();
            RtspFrameSource s = source;
            v.put("running", s != null && s.isRunning());
            v.put("connected", s != null && s.connected());
            v.put("width", s == null ? 0 : s.frameWidth());
            v.put("height", s == null ? 0 : s.frameHeight());
            v.put("lenses", s == null ? 0 : s.lenses());
            long age = s == null ? -1 : s.lastFrameAgeMs();
            v.put("last_frame_age", age < 0 ? JSONObject.NULL : age / 1000.0);
            String err = s != null && s.connected() ? null : (s != null && s.error() != null ? s.error() : state);
            v.put("error", err == null ? JSONObject.NULL : err);
            o.put("video", v);
            o.put("ptz", ptz != null);
            o.put("ptz_lens", 0);
            o.put("host", host == null ? JSONObject.NULL : host);
            o.put("server", "apk");
        } catch (Exception ignored) {
        }
        return o;
    }
}
