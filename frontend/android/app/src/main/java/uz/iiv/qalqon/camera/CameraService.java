package uz.iiv.qalqon.camera;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import uz.iiv.qalqon.MainActivity;

/**
 * Kamera serveri foreground service sifatida: Qalqon fonga o'tganda ham (masalan planshetda Chrome dagi web versiya
 * ochilganda) MIUI uni to'xtatmaydi. Bildirishnomalar panelida doim "kamera serveri ishlayapti" ko'rinadi.
 */
public class CameraService extends Service {
    private static final String CHANNEL = "qalqon_camera";
    private static final int NOTIF_ID = 8090;

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "PTZ kamera serveri", NotificationManager.IMPORTANCE_LOW));
        }
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        Notification n = b.setContentTitle("QALQON kamera serveri")
            .setContentText("PTZ, o'ng va chap kameralar: http://localhost:8090/camera")
            .setSmallIcon(android.R.drawable.presence_video_online)
            .setOngoing(true)
            .setContentIntent(open)
            .build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        } else {
            startForeground(NOTIF_ID, n);
        }
        CameraBridge.get(this).start();
        // USB web-kamera (Face ID): ulanganda avtomatik ochiladi
        try {
            UsbWebcam.get(this).start();
        } catch (Throwable t) {
            android.util.Log.w("QalqonWebcam", "USB web-kamera ishga tushmadi", t);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        UsbWebcam.get(this).stop();
        CameraBridge.get(this).stop();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
