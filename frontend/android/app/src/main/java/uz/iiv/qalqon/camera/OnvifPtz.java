package uz.iiv.qalqon.camera;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * ONVIF orqali kamerani burish (camera_server/kamera/ptz.py ning Java nusxasi).
 * CP-159-1 (V380): port 8899, login talab qilinmaydi. duration berilsa kamera o'zi to'xtaydi (himoya).
 */
public class OnvifPtz {
    private static final String ENV_OPEN =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
            + "<s:Envelope xmlns:s=\"http://www.w3.org/2003/05/soap-envelope\""
            + " xmlns:trt=\"http://www.onvif.org/ver10/media/wsdl\""
            + " xmlns:tptz=\"http://www.onvif.org/ver20/ptz/wsdl\""
            + " xmlns:tt=\"http://www.onvif.org/ver10/schema\"><s:Body>";
    private static final String ENV_CLOSE = "</s:Body></s:Envelope>";

    private final String base;
    private String profileToken;
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private ScheduledFuture<?> stopTask;
    private int gen = 0;

    public OnvifPtz(String host, int port) {
        this.base = "http://" + host + ":" + port + "/onvif";
    }

    public static class Profile {
        public final String token;
        public final int width;
        public final int height;
        public final boolean ptz;

        Profile(String token, int width, int height, boolean ptz) {
            this.token = token;
            this.width = width;
            this.height = height;
            this.ptz = ptz;
        }
    }

    /** SOAP so'rov: xato bo'lsa Exception (matni kamera javobidan) */
    String call(String service, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(base + "/" + service).openConnection();
        c.setConnectTimeout(3000);
        c.setReadTimeout(5000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/soap+xml; charset=utf-8");
        byte[] payload = (ENV_OPEN + body + ENV_CLOSE).getBytes(StandardCharsets.UTF_8);
        try (OutputStream os = c.getOutputStream()) {
            os.write(payload);
        }
        int code = c.getResponseCode();
        InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String text = is == null ? "" : readAll(is);
        c.disconnect();
        if (code >= 400 || text.contains(":Fault>") || text.contains("<Fault")) {
            Matcher m = Pattern.compile("<(?:\\w+:)?Text[^>]*>(.*?)</", Pattern.DOTALL).matcher(text);
            throw new Exception(m.find() ? m.group(1).trim() : "HTTP " + code);
        }
        return text;
    }

    private static String readAll(InputStream is) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] b = new byte[8192];
        int n;
        while ((n = is.read(b)) > 0) bo.write(b, 0, n);
        is.close();
        return bo.toString("UTF-8");
    }

    /** Media profillari (token, o'lcham, PTZ bor-yo'qligi) */
    public java.util.List<Profile> profiles() throws Exception {
        String text = call("media_service", "<trt:GetProfiles/>");
        java.util.List<Profile> out = new java.util.ArrayList<>();
        Matcher m = Pattern.compile("<(?:\\w+:)?Profiles[^>]*token=\"([^\"]+)\"[^>]*>(.*?)</(?:\\w+:)?Profiles>", Pattern.DOTALL).matcher(text);
        while (m.find()) {
            String body = m.group(2);
            int w = intTag(body, "Width");
            int h = intTag(body, "Height");
            out.add(new Profile(m.group(1), w, h, body.contains("PTZConfiguration")));
        }
        return out;
    }

    private static int intTag(String s, String tag) {
        Matcher m = Pattern.compile("<(?:\\w+:)?" + tag + ">(\\d+)<").matcher(s);
        return m.find() ? Integer.parseInt(m.group(1)) : 0;
    }

    private synchronized String token() throws Exception {
        if (profileToken == null) {
            for (Profile p : profiles()) {
                if (p.ptz) {
                    profileToken = p.token;
                    break;
                }
            }
            if (profileToken == null) profileToken = "PROFILE_000";
        }
        return profileToken;
    }

    private static double clamp(double v) {
        return Math.max(-1, Math.min(1, v));
    }

    /** Uzluksiz harakat. pan/tilt/zoom: -1..1. duration (s) > 0 bo'lsa shuncha vaqtdan keyin o'zi to'xtaydi */
    public synchronized void move(double pan, double tilt, double zoom, double duration) throws Exception {
        String velocity = String.format(java.util.Locale.US, "<tt:PanTilt x=\"%.2f\" y=\"%.2f\"/>", clamp(pan), clamp(tilt));
        if (zoom != 0) velocity += String.format(java.util.Locale.US, "<tt:Zoom x=\"%.2f\"/>", clamp(zoom));
        cancelTimer();
        call("ptz_service", "<tptz:ContinuousMove><tptz:ProfileToken>" + token() + "</tptz:ProfileToken>"
            + "<tptz:Velocity>" + velocity + "</tptz:Velocity></tptz:ContinuousMove>");
        if (duration > 0) {
            final int myGen = gen;
            stopTask = timer.schedule(() -> {
                synchronized (OnvifPtz.this) {
                    if (myGen != gen) return;
                    try {
                        sendStop();
                    } catch (Exception ignored) {
                    }
                }
            }, (long) (duration * 1000), TimeUnit.MILLISECONDS);
        }
    }

    public synchronized void stop() throws Exception {
        cancelTimer();
        sendStop();
    }

    private void sendStop() throws Exception {
        call("ptz_service", "<tptz:Stop><tptz:ProfileToken>" + token() + "</tptz:ProfileToken>"
            + "<tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>");
    }

    private void cancelTimer() {
        gen++;
        if (stopTask != null) {
            stopTask.cancel(false);
            stopTask = null;
        }
    }

    public void close() {
        timer.shutdownNow();
    }
}
