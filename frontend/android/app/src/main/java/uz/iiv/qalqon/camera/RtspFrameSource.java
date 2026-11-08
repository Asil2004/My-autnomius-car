package uz.iiv.qalqon.camera;

import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.graphics.YuvImage;
import android.media.Image;
import android.media.ImageReader;
import android.media.MediaCodec;
import android.media.MediaFormat;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.util.Log;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Kameraning RTSP H.264 videosini o'zimiz o'qib, apparat dekoderi (MediaCodec) bilan kadrlarga aylantiramiz.
 *
 * Nega o'z mijozimiz: CP-159-1 (V380) RTSP i nostandart (SDP da base64 profile-level-id, PLAY javobida RTP-Info yo'q).
 * Media3 ExoPlayer undan kadr yasay olmadi. Bu yerda faqat zarur qism: OPTIONS/DESCRIBE/SETUP(TCP)/PLAY,
 * RTP -> H.264 NAL (single, STAP-A, FU-A), MediaCodec -> ImageReader (YUV) -> NV21 -> JPEG (butun kadr yoki linza).
 */
public class RtspFrameSource {
    private static final String TAG = "QalqonCamera";

    private final String host;
    private final int port;
    private final String path;
    private final int width;
    private final int height;
    private final int jpegQuality;

    private volatile boolean running;
    private Thread rtspThread;
    private HandlerThread imageThread;
    private ImageReader reader;
    private MediaCodec codec;
    private Thread drainThread;
    private Socket sock;

    private final Object lock = new Object();
    private byte[] nv21;
    private int frameW;
    private int frameH;
    private long frameId = 0;
    private long lastFrameMs = 0;
    private volatile long lastDemandMs = 0;
    private volatile String error;

    // JPEG kesh: [lens+1] -> (frameId, bytes). lens -1 = butun kadr
    private final long[] jpegId = new long[8];
    private final byte[][] jpegCache = new byte[8][];

    public RtspFrameSource(String host, int port, String path, int width, int height, int jpegQuality) {
        this.host = host;
        this.port = port;
        this.path = path;
        this.width = width > 0 ? width : 640;
        this.height = height > 0 ? height : 1080;
        this.jpegQuality = jpegQuality;
    }

    public void start(android.content.Context ctx) {
        if (running) return;
        running = true;
        rtspThread = new Thread(this::rtspLoop, "QalqonRtsp");
        rtspThread.start();
    }

    public void stop() {
        running = false;
        closeSocket();
        if (rtspThread != null) rtspThread.interrupt();
        synchronized (lock) {
            lock.notifyAll();
        }
    }

    private void closeSocket() {
        try {
            if (sock != null) sock.close();
        } catch (IOException ignored) {
        }
    }

    // ============================================================================================================
    // RTSP
    // ============================================================================================================
    private int cseq = 0;

    private String url() {
        return "rtsp://" + host + ":" + port + path;
    }

    private String request(OutputStream out, InputStream in, String method, String url, String extra) throws IOException {
        String req = method + " " + url + " RTSP/1.0\r\nCSeq: " + (++cseq) + "\r\nUser-Agent: QalqonRobot\r\n" + extra + "\r\n";
        out.write(req.getBytes(StandardCharsets.US_ASCII));
        out.flush();
        // Javobni o'qish (interleaved bloklar bo'lsa o'tkazib yuboriladi)
        while (true) {
            in.mark(1);
            int b = in.read();
            if (b < 0) throw new IOException("RTSP ulanish uzildi");
            if (b == '$') {
                byte[] h = readN(in, 3);
                readN(in, ((h[1] & 0xff) << 8) | (h[2] & 0xff));
                continue;
            }
            in.reset();
            String head = readHead(in);
            Matcher m = Pattern.compile("(?im)^content-length:\\s*(\\d+)").matcher(head);
            String body = m.find() ? new String(readN(in, Integer.parseInt(m.group(1))), StandardCharsets.ISO_8859_1) : "";
            if (!head.startsWith("RTSP/1.0 200")) throw new IOException(method + ": " + head.split("\r\n")[0]);
            return head + body;
        }
    }

    private static String header(String text, String name) {
        Matcher m = Pattern.compile("(?im)^" + Pattern.quote(name) + ":\\s*(.+?)\\s*$").matcher(text);
        return m.find() ? m.group(1) : null;
    }

    private void rtspLoop() {
        while (running) {
            try {
                session();
            } catch (Exception e) {
                if (!running) break;
                error = "RTSP: " + e.getMessage();
                Log.w(TAG, error);
            } finally {
                closeSocket();
                releaseCodec();
            }
            try {
                Thread.sleep(2000);
            } catch (InterruptedException e) {
                break;
            }
        }
    }

    private void session() throws Exception {
        sock = new Socket();
        sock.connect(new InetSocketAddress(host, port), 5000);
        sock.setSoTimeout(10000);
        sock.setTcpNoDelay(true);
        InputStream in = new BufferedInputStream(sock.getInputStream(), 256 * 1024);
        OutputStream out = sock.getOutputStream();
        cseq = 0;

        request(out, in, "OPTIONS", url(), "");
        String sdp = request(out, in, "DESCRIBE", url(), "Accept: application/sdp\r\n");
        // Video bo'limi: control va sprop-parameter-sets (SPS, PPS)
        int vIdx = sdp.indexOf("m=video");
        if (vIdx < 0) throw new IOException("SDP da video yo'q");
        int aIdx = sdp.indexOf("m=", vIdx + 2);
        String video = aIdx > 0 ? sdp.substring(vIdx, aIdx) : sdp.substring(vIdx);
        Matcher cm = Pattern.compile("a=control:(\\S+)").matcher(video);
        String control = cm.find() ? cm.group(1) : "track1";
        String trackUrl = control.startsWith("rtsp://") ? control : url() + "/" + control;
        Matcher sm = Pattern.compile("sprop-parameter-sets=([^;\\s]+)").matcher(video);
        byte[] sps = null;
        byte[] pps = null;
        if (sm.find()) {
            String[] ps = sm.group(1).split(",");
            sps = Base64.decode(ps[0], Base64.DEFAULT);
            if (ps.length > 1) pps = Base64.decode(ps[1], Base64.DEFAULT);
        }

        String setup = request(out, in, "SETUP", trackUrl, "Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n");
        String session = header(setup, "Session");
        if (session == null) throw new IOException("Session yo'q");
        session = session.split(";")[0];
        request(out, in, "PLAY", url(), "Session: " + session + "\r\nRange: npt=0.000-\r\n");
        Log.i(TAG, "RTSP: video oqimi boshlandi (" + trackUrl + ")");

        startCodec(sps, pps);
        long lastKeepAlive = System.currentTimeMillis();
        ByteArrayOutputStream au = new ByteArrayOutputStream(256 * 1024);
        long auTs = -1;
        long firstTs = -1;
        boolean fuOpen = false;

        while (running) {
            // Sessiyani tirik tutish (har 25 s)
            if (System.currentTimeMillis() - lastKeepAlive > 25000) {
                String ka = "GET_PARAMETER " + url() + " RTSP/1.0\r\nCSeq: " + (++cseq) + "\r\nSession: " + session + "\r\n\r\n";
                out.write(ka.getBytes(StandardCharsets.US_ASCII));
                out.flush();
                lastKeepAlive = System.currentTimeMillis();
            }
            int b = in.read();
            if (b < 0) throw new IOException("Kamera oqimni uzdi");
            if (b != '$') {
                // RTSP javob (keepalive javobi): sarlavha + tana
                String head = (char) b + readHead(in);
                Matcher m = Pattern.compile("(?im)^content-length:\\s*(\\d+)").matcher(head);
                if (m.find()) readN(in, Integer.parseInt(m.group(1)));
                continue;
            }
            byte[] h = readN(in, 3);
            int ch = h[0] & 0xff;
            int len = ((h[1] & 0xff) << 8) | (h[2] & 0xff);
            byte[] pkt = readN(in, len);
            if (ch != 0 || len < 13) continue; // faqat video RTP

            int cc = pkt[0] & 0x0f;
            boolean ext = (pkt[0] & 0x10) != 0;
            boolean marker = (pkt[1] & 0x80) != 0;
            long ts = ((long) (pkt[4] & 0xff) << 24) | ((pkt[5] & 0xff) << 16) | ((pkt[6] & 0xff) << 8) | (pkt[7] & 0xff);
            int off = 12 + cc * 4;
            if (ext && len >= off + 4) off += 4 + (((pkt[off + 2] & 0xff) << 8) | (pkt[off + 3] & 0xff)) * 4;
            if (off >= len) continue;

            // Yangi vaqt belgisi = yangi kadr: oldingisini dekoderga beramiz
            if (auTs >= 0 && ts != auTs && au.size() > 0) {
                feed(au.toByteArray(), auTs, firstTs);
                au.reset();
                fuOpen = false;
            }
            if (firstTs < 0) firstTs = ts;
            auTs = ts;

            int nalType = pkt[off] & 0x1f;
            if (nalType >= 1 && nalType <= 23) {
                au.write(START);
                au.write(pkt, off, len - off);
            } else if (nalType == 24) { // STAP-A
                int p = off + 1;
                while (p + 2 <= len) {
                    int n = ((pkt[p] & 0xff) << 8) | (pkt[p + 1] & 0xff);
                    p += 2;
                    if (p + n > len) break;
                    au.write(START);
                    au.write(pkt, p, n);
                    p += n;
                }
            } else if (nalType == 28 && len > off + 2) { // FU-A
                int ind = pkt[off] & 0xff;
                int fh = pkt[off + 1] & 0xff;
                boolean s = (fh & 0x80) != 0;
                if (s) {
                    au.write(START);
                    au.write((ind & 0xe0) | (fh & 0x1f));
                    fuOpen = true;
                }
                if (fuOpen) au.write(pkt, off + 2, len - off - 2);
            }
            if (marker && au.size() > 0) {
                feed(au.toByteArray(), ts, firstTs);
                au.reset();
                fuOpen = false;
                auTs = -1;
            }
        }
    }

    private static final byte[] START = {0, 0, 0, 1};

    // ============================================================================================================
    // MediaCodec
    // ============================================================================================================
    private void startCodec(byte[] sps, byte[] pps) throws IOException {
        MediaFormat fmt = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height);
        if (sps != null) fmt.setByteBuffer("csd-0", ByteBuffer.wrap(concat(START, sps)));
        if (pps != null) fmt.setByteBuffer("csd-1", ByteBuffer.wrap(concat(START, pps)));
        // Surface siz: kadr CPU xotirasida (YUV420 Flexible) olinadi. ImageReader (apparat buferi) bu planshetda
        // CPU dan o'qishda SIGSEGV berardi
        fmt.setInteger(MediaFormat.KEY_COLOR_FORMAT, android.media.MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible);
        codec = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
        codec.configure(fmt, null, null, 0);
        codec.start();
        final MediaCodec c = codec;
        drainThread = new Thread(() -> {
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            while (running && codec == c) {
                try {
                    int idx = c.dequeueOutputBuffer(info, 20000);
                    if (idx < 0) continue;
                    try {
                        Image img = c.getOutputImage(idx);
                        if (img != null) storeFrame(img);
                    } finally {
                        c.releaseOutputBuffer(idx, false);
                    }
                } catch (Exception e) {
                    break;
                }
            }
        }, "QalqonDecoderOut");
        drainThread.start();
    }

    private void feed(byte[] data, long ts, long firstTs) {
        MediaCodec c = codec;
        if (c == null) return;
        try {
            int idx = c.dequeueInputBuffer(20000);
            if (idx < 0) return; // dekoder band: jonli oqimda kadrni tashlab yuboramiz
            ByteBuffer buf = c.getInputBuffer(idx);
            if (buf == null) return;
            buf.clear();
            if (data.length > buf.capacity()) {
                c.queueInputBuffer(idx, 0, 0, 0, 0);
                return;
            }
            buf.put(data);
            long ptsUs = ((ts - firstTs) & 0xffffffffL) * 1000000L / 90000L;
            c.queueInputBuffer(idx, 0, data.length, ptsUs, 0);
        } catch (Exception e) {
            Log.w(TAG, "Dekoderga berishda xato: " + e.getMessage());
        }
    }

    private void releaseCodec() {
        MediaCodec c = codec;
        codec = null;
        if (c != null) {
            try {
                c.stop();
            } catch (Exception ignored) {
            }
            c.release();
        }
    }

    private static byte[] concat(byte[] a, byte[] b) {
        byte[] r = new byte[a.length + b.length];
        System.arraycopy(a, 0, r, 0, a.length);
        System.arraycopy(b, 0, r, a.length, b.length);
        return r;
    }

    private static String readHead(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int state = 0;
        while (true) {
            int c = in.read();
            if (c < 0) throw new IOException("RTSP ulanish uzildi");
            b.write(c);
            if ((state == 0 || state == 2) && c == '\r') state++;
            else if ((state == 1 || state == 3) && c == '\n') state++;
            else state = c == '\r' ? 1 : 0;
            if (state == 4) return b.toString("ISO-8859-1");
            if (b.size() > 16384) throw new IOException("RTSP sarlavha juda uzun");
        }
    }

    private static byte[] readN(InputStream in, int n) throws IOException {
        byte[] b = new byte[n];
        int off = 0;
        while (off < n) {
            int k = in.read(b, off, n - off);
            if (k < 0) throw new IOException("RTSP ulanish uzildi");
            off += k;
        }
        return b;
    }

    // ============================================================================================================
    // Kadrlar
    // ============================================================================================================
    /** Dekoder kadri (CPU xotirasida) -> NV21. Kadr o'lchami crop maydonidan olinadi */
    private void storeFrame(Image img) {
        try {
            // Hech kim ko'rmayotgan bo'lsa (5 s so'rov yo'q) kadrni o'girmaymiz: faqat "tirik" belgisi yangilanadi
            if (nv21 != null && System.currentTimeMillis() - lastDemandMs > 5000) {
                synchronized (lock) {
                    lastFrameMs = System.currentTimeMillis();
                    error = null;
                }
                return;
            }
            byte[] data = toNv21(img);
            synchronized (lock) {
                nv21 = data;
                frameW = img.getCropRect() != null ? img.getCropRect().width() : img.getWidth();
                frameH = img.getCropRect() != null ? img.getCropRect().height() : img.getHeight();
                frameId++;
                lastFrameMs = System.currentTimeMillis();
                error = null;
                lock.notifyAll();
            }
        } catch (Exception e) {
            Log.w(TAG, "Kadr o'qishda xato", e);
        } finally {
            img.close();
        }
    }

    /** YUV_420_888 -> NV21 (crop, qator va piksel qadamlarini hisobga olib; bufer chegarasidan chiqmaydi) */
    private static byte[] toNv21(Image image) {
        Rect crop = image.getCropRect() != null ? image.getCropRect() : new Rect(0, 0, image.getWidth(), image.getHeight());
        int w = crop.width() & ~1;
        int h = crop.height() & ~1;
        byte[] out = new byte[w * h * 3 / 2];
        Image.Plane[] p = image.getPlanes();
        ByteBuffer y = p[0].getBuffer();
        int yRow = p[0].getRowStride();
        int yPix = p[0].getPixelStride();
        int pos = 0;
        byte[] rowBuf = new byte[yRow];
        for (int row = 0; row < h; row++) {
            int start = (crop.top + row) * yRow + crop.left * yPix;
            if (yPix == 1) {
                y.position(start);
                y.get(out, pos, w);
                pos += w;
            } else {
                int n = Math.min(rowBuf.length, y.capacity() - start);
                y.position(start);
                y.get(rowBuf, 0, n);
                for (int col = 0; col < w; col++) out[pos++] = rowBuf[col * yPix];
            }
        }
        ByteBuffer u = p[1].getBuffer();
        ByteBuffer v = p[2].getBuffer();
        int uvRow = p[1].getRowStride();
        int uvPix = p[1].getPixelStride();
        int cw = w / 2;
        int ch = h / 2;
        // Tez yo'l: har qatorni bitta bulk-get bilan massivga olib, keyin Java ichida joylashtiramiz
        // (har piksel uchun ByteBuffer.get chaqirish protsessorni ko'p yeydi)
        int need = (cw - 1) * uvPix + 1;
        byte[] vRow = new byte[need];
        byte[] uRow = new byte[need];
        for (int row = 0; row < ch; row++) {
            int base = (crop.top / 2 + row) * uvRow + (crop.left / 2) * uvPix;
            int nv = Math.max(0, Math.min(need, v.capacity() - base));
            int nu = Math.max(0, Math.min(need, u.capacity() - base));
            v.position(base);
            v.get(vRow, 0, nv);
            u.position(base);
            u.get(uRow, 0, nu);
            for (int col = 0; col < cw; col++) {
                int i = col * uvPix;
                out[pos++] = i < nv ? vRow[i] : (byte) 128;
                out[pos++] = i < nu ? uRow[i] : (byte) 128;
            }
        }
        return out;
    }

    public boolean connected() {
        return running && System.currentTimeMillis() - lastFrameMs < 5000;
    }

    public long lastFrameAgeMs() {
        return lastFrameMs == 0 ? -1 : System.currentTimeMillis() - lastFrameMs;
    }

    public String error() {
        return error;
    }

    public int frameWidth() {
        return frameW;
    }

    public int frameHeight() {
        return frameH;
    }

    /** Kadrdagi linzalar soni (16:9 bo'laklar): 640x1080 -> 3 */
    public int lenses() {
        if (frameW == 0 || frameH == 0) return 1;
        return Math.max(1, Math.round(frameH * 16f / (frameW * 9f)));
    }

    /** Yangi kadr kelguncha kutish (timeoutMs) */
    public long waitNewer(long lastId, long timeoutMs) throws InterruptedException {
        lastDemandMs = System.currentTimeMillis(); // tomoshabin bor: kadrlar o'girilsin
        synchronized (lock) {
            long end = System.currentTimeMillis() + timeoutMs;
            while (running && frameId == lastId) {
                long left = end - System.currentTimeMillis();
                if (left <= 0) break;
                lock.wait(left);
            }
            return frameId;
        }
    }

    /** Joriy kadrning JPEG i (lens = -1 butun kadr, 0..n-1 bitta linza). Kadr bo'lmasa null */
    public byte[] jpeg(int lens) {
        lastDemandMs = System.currentTimeMillis();
        byte[] data;
        int w;
        int h;
        long id;
        int slot = Math.min(jpegCache.length - 1, lens + 1);
        synchronized (lock) {
            if (nv21 == null) return null;
            if (jpegCache[slot] != null && jpegId[slot] == frameId) return jpegCache[slot];
            data = nv21;
            w = frameW;
            h = frameH;
            id = frameId;
        }
        Rect rect;
        if (lens < 0) {
            rect = new Rect(0, 0, w, h);
        } else {
            int n = Math.max(1, Math.round(h * 16f / (w * 9f)));
            if (lens >= n) return null;
            int lh = (h / n) & ~1;
            rect = new Rect(0, lens * lh, w, lens * lh + lh);
        }
        ByteArrayOutputStream bo = new ByteArrayOutputStream(64 * 1024);
        new YuvImage(data, ImageFormat.NV21, w, h, null).compressToJpeg(rect, jpegQuality, bo);
        byte[] out = bo.toByteArray();
        synchronized (lock) {
            jpegCache[slot] = out;
            jpegId[slot] = id;
        }
        return out;
    }

    public boolean isRunning() {
        return running;
    }

    @Override
    public String toString() {
        return String.format(Locale.US, "RtspFrameSource(%s:%d%s)", host, port, path);
    }
}
