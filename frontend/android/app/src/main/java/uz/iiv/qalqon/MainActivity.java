package uz.iiv.qalqon;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

import uz.iiv.qalqon.camera.CameraService;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Robot yuzi doim ekranda turishi kerak: planshet ekrani o'chib qolmasin
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // PTZ kamera serveri (Ethernet orqali ulangan CP-159-1): HUD http://localhost:8090/camera dan foydalanadi.
        // Foreground service: ilova fonga o'tganda ham ishlaydi (planshetdagi Chrome dagi web versiya ham ulanadi)
        if (android.os.Build.VERSION.SDK_INT >= 33
            && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {android.Manifest.permission.POST_NOTIFICATIONS}, 8090);
        }
        android.content.Intent svc = new android.content.Intent(this, CameraService.class);
        if (android.os.Build.VERSION.SDK_INT >= 26) startForegroundService(svc);
        else startService(svc);
    }
}
