import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'uz.iiv.qalqon',
  appName: 'Qalqon',
  webDir: 'dist',
  server: {
    // Raspberry Pi (http://<ip>:8000) va ESP32 lokal tarmoqda http orqali ishlaydi
    cleartext: true
  },
  android: {
    // Ilova https://localhost dan ochiladi: Pi ga http so'rovlar (mixed content) bloklanmasin
    allowMixedContent: true
  }
};

export default config;
