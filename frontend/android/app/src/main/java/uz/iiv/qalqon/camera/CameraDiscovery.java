package uz.iiv.qalqon.camera;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * Kamerani lokal tarmoqda topish. Android "Ethernet orqali ulashish" kameraga har safar tasodifiy tarmoqdan IP beradi
 * (masalan 10.38.71.188), shuning uchun Ethernet (eth*) interfeysi tarmog'idagi barcha manzillar ONVIF porti (8899)
 * ochiqligi bo'yicha tekshiriladi. Oxirgi topilgan manzil birinchi tekshiriladi.
 */
public final class CameraDiscovery {
    private CameraDiscovery() {}

    static boolean portOpen(String host, int port, int timeoutMs) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(host, port), timeoutMs);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** eth* (va ixtiyoriy boshqa simli) interfeyslarning IPv4 /24 tarmoqlari: "10.38.71." kabi prefikslar */
    static List<String[]> wiredSubnets() {
        List<String[]> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                String name = ni.getName();
                if (!ni.isUp() || ni.isLoopback() || !(name.startsWith("eth") || name.startsWith("usb") || name.startsWith("rndis"))) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress a = ia.getAddress();
                    if (!(a instanceof Inet4Address)) continue;
                    String ip = a.getHostAddress();
                    String prefix = ip.substring(0, ip.lastIndexOf('.') + 1);
                    out.add(new String[] {prefix, ip});
                }
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    /** Kamerani topish: avval oxirgi ma'lum manzil, keyin simli tarmoqlardagi barcha manzillar (parallel) */
    public static String find(String lastKnown, int port) {
        if (lastKnown != null && portOpen(lastKnown, port, 600)) return lastKnown;
        ExecutorService pool = Executors.newFixedThreadPool(48);
        try {
            for (String[] net : wiredSubnets()) {
                List<Future<String>> jobs = new ArrayList<>();
                for (int i = 1; i < 255; i++) {
                    final String host = net[0] + i;
                    if (host.equals(net[1])) continue;
                    jobs.add(pool.submit(() -> portOpen(host, port, 500) ? host : null));
                }
                for (Future<String> f : jobs) {
                    try {
                        String r = f.get(3, TimeUnit.SECONDS);
                        if (r != null) return r;
                    } catch (Exception ignored) {
                    }
                }
            }
        } finally {
            pool.shutdownNow();
        }
        return null;
    }
}
