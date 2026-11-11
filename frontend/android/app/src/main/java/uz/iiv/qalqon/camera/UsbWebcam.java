package uz.iiv.qalqon.camera;

import android.content.Context;
import android.graphics.Rect;
import android.graphics.YuvImage;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.util.Log;

import com.serenegiant.usb.IFrameCallback;
import com.serenegiant.usb.Size;
import com.serenegiant.usb.USBMonitor;
import com.serenegiant.usb.UVCCamera;
import com.serenegiant.usb.UVCParam;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.List;

/**
 * USB (UVC) web-kamera: Android tizimi tashqi kamerani ilovalarga bermaydigan planshetlarda (Xiaomi Pad) kamerani
 * USB orqali to'g'ridan-to'g'ri o'qiydi. Kadrlar JPEG ga aylantirilib, kamera serveri orqali beriladi:
 *   /camera/webcam/status, /camera/webcam/stream (MJPEG), /camera/webcam/snapshot.jpg
 * HUD va robot yuzi ekrani buni Face ID kamerasi sifatida ishlatadi.
 * JPEG faqat kimdir tasvirni so'rayotganda (oxirgi 5 s ichida) tayyorlanadi: aks holda protsessor bekor ishlamaydi.
 */
public class UsbWebcam implements USBMonitor.OnDeviceConnectListener, IFrameCallback {
    private static final String TAG = "QalqonWebcam";
    // 640x480: planshet protsessori 1280x720 ni (dekodlash + JPEG + brauzerda yuz aniqlash) qotib ulgurmasdi
    private static final int W = 640, H = 480;
    private static final int FPS = 15;
    private static final long MIN_FRAME_MS = 60; // ~15 fps

    private static UsbWebcam instance;

    public static synchronized UsbWebcam get(Context ctx) {
        if (instance == null) instance = new UsbWebcam(ctx.getApplicationContext());
        return instance;
    }

    private final Context ctx;
    private USBMonitor monitor;
    private UVCCamera camera;
    private String deviceName = "";
    private String error = "";
    private int width, height;
    private boolean waitingPermission;
    private android.media.ImageReader sink;
    private android.os.HandlerThread readerThread;

    private final Object lock = new Object();
    private byte[] jpeg;
    private long frameId;
    private long lastEncode;
    private volatile long lastDemand;
    private byte[] nv21;
    private long frames;
    private volatile long sinkFrames;

    private UsbWebcam(Context ctx) {
        this.ctx = ctx;
    }

    public synchronized void start() {
        if (monitor != null) return;
        monitor = new USBMonitor(ctx, this);
        monitor.register();
        // Ilova ishga tushganda allaqachon ulangan kamera
        for (UsbDevice d : monitor.getDeviceList()) {
            if (isVideo(d)) {
                onAttach(d);
                break;
            }
        }
    }

    public synchronized void stop() {
        closeCamera();
        if (monitor != null) {
            monitor.unregister();
            monitor.destroy();
            monitor = null;
        }
    }

    /** Planshetga ulangan web-kamera bormi (ruxsat va ochilganidan qat'i nazar) */
    private boolean anyVideoDevice() {
        if (monitor == null) return false;
        for (UsbDevice d : monitor.getDeviceList()) if (isVideo(d)) return true;
        return false;
    }

    private static boolean isVideo(UsbDevice d) {
        if (d.getDeviceClass() == UsbConstants.USB_CLASS_VIDEO) return true;
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            if (d.getInterface(i).getInterfaceClass() == UsbConstants.USB_CLASS_VIDEO) return true;
        }
        return false;
    }

    // --- USBMonitor ------------------------------------------------------------------------------------------------
    @Override
    public synchronized void onAttach(UsbDevice device) {
        if (!isVideo(device) || camera != null) return;
        Log.i(TAG, "Web-kamera ulandi: " + device.getProductName());
        deviceName = device.getProductName() != null ? device.getProductName() : device.getDeviceName();
        error = "";
        waitingPermission = true;
        // Ruxsat bo'lsa darhol onDeviceOpen, bo'lmasa planshetda "ruxsat berish" oynasi chiqadi
        monitor.requestPermission(device);
    }

    @Override
    public synchronized void onDetach(UsbDevice device) {
        if (!isVideo(device)) return;
        Log.i(TAG, "Web-kamera uzildi");
        closeCamera();
        deviceName = "";
    }

    @Override
    public synchronized void onDeviceOpen(UsbDevice device, USBMonitor.UsbControlBlock ctrlBlock, boolean createNew) {
        if (!isVideo(device)) return;
        waitingPermission = false;
        closeCamera();
        try {
            UVCCamera cam = new UVCCamera(new UVCParam());
            cam.open(ctrlBlock);
            try {
                Log.i(TAG, "Qo'llanadigan o'lchamlar: " + cam.getSupportedSize());
            } catch (Exception ignored) {
            }
            // O'lcham turi (size.type): UVC_VS_FRAME_MJPEG (7) yoki UVC_VS_FRAME_UNCOMPRESSED (5)
            Size chosen = pickSize(cam);
            if (chosen != null) {
                // Kamera 15 kadr/s da ishlaydi: dekodlash va konvertatsiya yarmiga kamayadi (Face ID uchun yetarli)
                chosen = chosen.clone();
                if (chosen.fpsList != null && chosen.fpsList.contains(FPS)) chosen.fps = FPS;
                cam.setPreviewSize(chosen);
            }
            else cam.setPreviewSize(W, H, UVCCamera.UVC_VS_FRAME_MJPEG);
            Size ps = cam.getPreviewSize();
            width = ps != null ? ps.width : W;
            height = ps != null ? ps.height : H;
            cam.setFrameCallback(this, UVCCamera.PIXEL_FORMAT_NV21);
            // Kutubxona preview ni faqat "oyna" (Surface) bilan boshlaydi. Ekranda ko'rsatish shart emas: ko'rinmas
            // ImageReader yuzasi beriladi va undagi kadrlar darhol tashlab yuboriladi (navbat to'lib qotmasligi uchun)
            if (readerThread == null) {
                readerThread = new android.os.HandlerThread("QalqonWebcamSink");
                readerThread.start();
            }
            sink = android.media.ImageReader.newInstance(width, height, android.graphics.PixelFormat.RGBX_8888, 3);
            sink.setOnImageAvailableListener(r -> {
                try {
                    android.media.Image img = r.acquireLatestImage();
                    if (img != null) {
                        sinkFrames++;
                        img.close();
                    }
                } catch (Exception ignored) {
                }
            }, new android.os.Handler(readerThread.getLooper()));
            cam.setPreviewDisplay(sink.getSurface());
            cam.startPreview();
            camera = cam;
            error = "";
            Log.i(TAG, "Web-kamera ochildi " + width + "x" + height);
        } catch (Exception e) {
            error = "Kamera ochilmadi: " + e.getMessage();
            Log.w(TAG, error, e);
            closeCamera();
        }
    }

    /** 640x480 ga eng yaqin o'lcham (yuz tanish uchun yetarli, protsessorga yengil) */
    private static Size pickSize(UVCCamera cam) {
        try {
            List<Size> sizes = cam.getSupportedSizeList();
            if (sizes == null || sizes.isEmpty()) return null;
            Size best = null;
            long bestScore = Long.MAX_VALUE;
            for (Size s : sizes) {
                long score = Math.abs((long) s.width * s.height - (long) W * H);
                if (s.width < 320) score += 10_000_000L;
                // MJPEG afzal: USB orqali kam ma'lumot, yuqori kadr tezligi
                if (s.type != UVCCamera.UVC_VS_FRAME_MJPEG) score += 1_000_000L;
                if (score < bestScore) {
                    bestScore = score;
                    best = s;
                }
            }
            return best;
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public synchronized void onDeviceClose(UsbDevice device, USBMonitor.UsbControlBlock ctrlBlock) {
        closeCamera();
    }

    @Override
    public synchronized void onCancel(UsbDevice device) {
        waitingPermission = false;
        error = "Web-kameraga USB ruxsati berilmadi";
    }

    private void closeCamera() {
        UVCCamera c = camera;
        camera = null;
        if (c != null) {
            try {
                c.stopPreview();
            } catch (Exception ignored) {
            }
            try {
                c.destroy();
            } catch (Exception ignored) {
            }
        }
        if (sink != null) {
            try {
                sink.close();
            } catch (Exception ignored) {
            }
            sink = null;
        }
        synchronized (lock) {
            jpeg = null;
            lock.notifyAll();
        }
    }

    // --- Kadrlar ---------------------------------------------------------------------------------------------------
    @Override
    public void onFrame(ByteBuffer frame) {
        frames++;
        long now = System.currentTimeMillis();
        if (now - lastDemand > 5000 || now - lastEncode < MIN_FRAME_MS) return;
        lastEncode = now;
        int n = frame.remaining();
        int need = width * height * 3 / 2;
        if (n < need || width == 0) return;
        if (nv21 == null || nv21.length != need) nv21 = new byte[need];
        frame.get(nv21, 0, need);
        ByteArrayOutputStream out = new ByteArrayOutputStream(need / 6);
        new YuvImage(nv21, android.graphics.ImageFormat.NV21, width, height, null)
            .compressToJpeg(new Rect(0, 0, width, height), 70, out);
        synchronized (lock) {
            jpeg = out.toByteArray();
            frameId++;
            lock.notifyAll();
        }
    }

    /** Oxirgi kadr (talab belgilanadi: kodlash shu paytdan boshlanadi) */
    public byte[] jpeg() {
        lastDemand = System.currentTimeMillis();
        synchronized (lock) {
            return jpeg;
        }
    }

    /** last dan yangiroq kadr kelguncha kutish; yangi kadr raqamini qaytaradi */
    public long waitNewer(long last, long timeoutMs) throws InterruptedException {
        lastDemand = System.currentTimeMillis();
        long end = System.currentTimeMillis() + timeoutMs;
        synchronized (lock) {
            while (frameId == last) {
                long left = end - System.currentTimeMillis();
                if (left <= 0) break;
                lock.wait(left);
            }
            return frameId;
        }
    }

    public synchronized JSONObject statusJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("connected", camera != null);
            o.put("device", anyVideoDevice());
            o.put("name", deviceName);
            o.put("width", width);
            o.put("height", height);
            o.put("waitingPermission", waitingPermission);
            o.put("frames", frames);
            o.put("previewFrames", sinkFrames);
            o.put("error", error);
        } catch (Exception ignored) {
        }
        return o;
    }
}
