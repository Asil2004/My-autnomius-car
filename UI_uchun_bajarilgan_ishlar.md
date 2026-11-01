# 📋 "QALQON" IIV Avtonom Patrul Roboti — UI Uchun Bajarilgan Ishlar Hisoboti

Ushbu hisobot "QALQON" loyihasining `qalqon.pdf` texnik hujjatini to'liq o'rganish, uning frontend boshqaruv markazini zamonaviy harbiy-taktik uslubda yaratish, Android APK formatida kompilyatsiya qilish, smartfonga o'rnatish va GitHub repozitoriyasiga muvaffaqiyatli kollobratsiya qilish bo'yicha bosqichma-bosqich bajarilgan ishlarni o'z ichiga oladi.

---

## 1-BOSQICH: Texnik Hujjat (`qalqon.pdf`) Tahlili

`qalqon.pdf` ("QALQON" IIV Avtonom Patrul Roboti: Yagona Jamlangan Texnik Qo'llanma) to'liq tahlil qilindi:
1. **Loyiha Konsepsiyasi va Form-faktori**:
   * Balandligi ~1.15 m, asosi 45x45 sm bo'lgan vertikal kiber-kuzatuv minorasi.
   * Amortizatorsiz qattiq shassi (LiDAR va PTZ kamera gorizonti qimirlamasligi uchun).
   * 8.7 dyuymli planshet: bronlangan 4 mm polikarbonat (Lexan) ortida, tashqi ochiq vintlarsiz.
   * Politsiya stroboskop chiroqlari (qizil/ko'k) va 12V LiFePO4 batareya quvvati.
2. **Mexatronika & Mecanum Kinematikasi**:
   * 4WD Mecanum mustaqil harakat: Oldinga (`F`), Orqaga (`B`), Chapga (`L`), O'ngga (`R`), Strafe Chap (`Q`), Strafe O'ng (`E`), Joyida 360° burilish, To'xtatish (`S`).
   * 3 darajali tezlik PWM: 1 (130), 2 (190), 3 (250).
3. **Datchiklar & Xavfsizlik**:
   * 4 ta HC-SR04 ultratovush: Old (A0/A1), Orqa (A2/A3), Chap, O'ng.
   * Xavfsizlik sharti: Old masofa < 22 sm bo'lganda avtomatik to'xtash (`WARN:OBSTACLE_FRONT`).
4. **Tarmoq va Dasturiy Interfeys**:
   * Raspberry Pi veb-kontroller: `pi_patrol.py` (port 8000), MJPEG video strimi, `AUTO_CAMERA` va `MANUAL` rejimlari.
   * Arduino L293D Shield (115200 baud, `/dev/ttyACM0`).
5. **AI Intellekt & Loyihalar Integratsiyasi**:
   * UIUC CS437 IoT Lab 1 TFLite modeli (`road_signs_quantized.tflite`): Odam (Piyoda), STOP belgisi, Svetoforlar (Qizil/Yashil), Tezlik 25/40 belgilari.
   * F1TENTH TTC (Time to Collision) avtotormoz va Gap-Follow (to'siqlardan bo'sh yo'lak topish) algoritmi.
   * Masofani kadr orqali hisoblash: $D = \frac{W \times F}{P}$ (Known Object Size) va OpenCV Aruco markerlari.

---

## 2-BOSQICH: Taktik Kiber-HUD Frontend Arxitekturasi ("Anti-Neuro-Slop")

AI ning odatiy va zerikarli ko'k-binafsharang "neyro slop" gradientlari chetga surilib, professional IIV va harbiy-kiber dispetcherlik dizayni ishlab chiqildi:

1. **Dizayn Tizimi (Design System)**:
   * **Ranglar**: Chuqur himoyalangan taktik qora (`#06090e`, `#0a0f18`), politsiya ko'ki (`#1d63ff`), radar siani (`#00e5ff`), avariya qizili (`#ff2238`) va ogohlantiruvchi yantar (`#ffb300`).
   * **Vizual effektlar**: Optik scanline panjaralari, HUD burchak krestlari (crosshair), chamfered taktik panellar, monospaced telemetriya shriftlari.
2. **Web Audio Sintizatori (`audioService.ts`)**:
   * Tashqi audio fayllarsiz Web Audio API orqali generatsiya qilinadigan operativ taktil click tovushlari, Mecanum komanda biplari, to'siq signali va politsiya 2.2Hz LFO sirena modulyatsiyasi.
3. **Asosiy Modullar va Komponentlar**:
   * `Navbar.tsx`: IIV "QALQON" gerbi, robot holati, ping (ms), LiFePO4 batareya (V va %), stroboskop/sirena tugmalari, E-STOP favqulodda to'xtatish.
   * `HUDView.tsx`: Jonli video stream (MJPEG), 360° PTZ kamera boshqaruvi (pan/tilt burchaklari), 8 yo'nalishli Mecanum 4WD sensorli d-pad + klaviatura navigatsiyasi (`W, A, S, D, Q, E, Space, 1-3`), 4x HC-SR04 datchiklar masofa ko'rsatkichlari (<22sm xavf zonasi).
   * `SOSView.tsx`: 8.7" bronlangan minora ekrani uchun gigant pulsatsiyalovchi **SOS 102** tugmasi, dispetcher (Katta leytenant Sh. Rahimov) bilan audio/video aloqa interfeysi, tezkor xizmatlar (102 Politsiya, 103 Tez Yordam, 101 FVV).
   * `AIAutonomousView.tsx`: Edge TFLite ob'ektlar deteksiyasi, masofa hisoblash formulasi, svetofor va STOP belgisi reaksiyalari, F1TENTH real-vaqtdagi TTC (Time to Collision) ko'rsatkichi, 4 bosqichli amaliy yo'l xaritasi (Roadmap).
   * `LidarRadarView.tsx`: HTML5 Canvas da to'liq 360° LD19 / RPLiDAR radar sweeps, 1m-5m masofa doiralari, burchaklar, to'siqlar nuqtalari buluti, 12V LiFePO4 batareya stansiyasi va M1-M4 motorlar holati.
   * `SettingsView.tsx`: Raspberry Pi IP va portini boshqarish, Arduino serial protokoli, to'liq apparat pinout jadvali (Pinout, USB, sariq jumper xavfsizligi).
   * `RobotContext.tsx`: Butun tizim holatini markazlashtiruvchi, simulyatsiya va real robot o'rtasida o'tishni ta'minlovchi global reaktiv boshqaruv yadrosi.

---

## 3-BOSQICH: Android Platformasi va APK Kompilyatsiyasi

1. **Capacitor Integratsiyasi**:
   * `@capacitor/core`, `@capacitor/cli`, `@capacitor/android` o'rnatildi.
   * Loyiha ID: `uz.iiv.qalqon`, Ilova nomi: `Qalqon`.
2. **Java Moslashuvi va Xatolikni Bartaraf Etish**:
   * Tizimda Java 17 o'rnatilganligi sababli, sukut bo'yicha Java 21 ni so'ragan Capacitor va Gradle konfiguratsiyalari to'liq `JavaVersion.VERSION_17` ga moslashtirildi.
3. **APK Yig'ilishi (Gradle assembleDebug)**:
   * Android SDK platforma vositalari (Build-Tools 35, Platform 36) yuklandi.
   * `gradlew.bat assembleDebug` orqali muvaffaqiyatli APK yaratildi.
   * **Natija fayl**: `qalqon-patrol-v1.0.apk` (Hajmi: 4.23 MB) loyiha asosiy papkasiga nusxalandi.

---

## 4-BOSQICH: Android Smartfonga Avtomatik O'rnatish

1. **ADB orqali Qurilma Aniqlanishi**:
   * Ulangan qurilma: `Xiaomi / Redmi Note 11 Pro (2209116AG - Sweet)`.
   * Qurilma ID: `86064beb0013`.
2. **O'rnatish va Ishga Tushirish**:
   * `adb install -r -d qalqon-patrol-v1.0.apk` buyrug'i orqali o'rnatildi (`Success`).
   * `adb shell am start -n uz.iiv.qalqon/.MainActivity` orqali to'g'ridan-to'g'ri telefonda ishga tushirildi.
   * Dastur smartfon ekranida to'liq interaktiv rejimda ochildi.

---

## 5-BOSQICH: GitHub Repozitoriyasiga Kollobratsiya

1. **Git Initsializatsiyasi**:
   * Repozitoriy: `https://github.com/Asil2004/My-autnomius-car.git`.
   * Mavjud `main` tarmog'i bilan rebase va sinxronizatsiya qilindi.
2. **Gitignore va Kesh Tozalash**:
   * Og'ir `node_modules`, `build` keshlar chiqarib tashlanib, loyihaning toza manba kodlari qoldirildi.
3. **Kollobratorlik Ruxsati va Push**:
   * Taklifnoma tasdiqlangach, `git push origin main` muvaffaqiyatli bajarildi.
   * **Commit kodi**: `24cc868` (*feat: Add tactical cyber-HUD frontend & Android APK control center for QALQON*).


---

## 6-BOSQICH: Robot Displeyi Gorizontal Rejimi & 3D `result.glb` Oyna Ortidagi Odam Integratsiyasi

1. **Gorizontal (Landscape) Orientatsiya**:
   * Dastur robot minorasining 8.7" planshet ekrani uchun to'liq gorizontal (landscape) rejimga o'tkazildi.
   * `AndroidManifest.xml` da `android:screenOrientation="sensorLandscape"` o'rnatildi.
2. **Oyna Ortida Turgan 3D Odam (`result.glb`) Bosh Sahifasi**:
   * Three.js (`three` va `GLTFLoader`) orqali `result.glb` 3D modeli yuklandi.
   * Minora ichidagi kiber-yorug'lik (police cyan rim light, blue/red ambient) va 4 mm bronlangan Lexan oynasi effekti (glare, scanlines, zirhli burchaklar) qo'shildi.
   * **Jonli Sergak Harakat**: Model bir o'ngga, bir chapga silliq qarab (`targetLookAngle` sinusoidal ritmi), vaziyatni sergak kuzatayotgandek animatsiya qilindi.
   * Ekran pastida fuqarolar uchun tezkor **SOS 102** tugmasi, sana/vaqt va jamoat xavfsizligi statusi joylashtirildi.
3. **Xavfsiz Operator Kirish Tizimi (PIN/Parol)**:
   * Ekran yuqori o'ng chetida "OPERATOR KIRISH" taktik tugmasi o'rnatildi.
   * Bosilganda zamonaviy `OperatorAuthModal` ochiladi (Login: `operator`, Parol: `102`).
   * Touchscreen planshetlar uchun qulay raqamli sensor numpad bilan jihozlandi.
   * To'g'ri kiritilgach, to'liq Operator Boshqaruv Markazi ochiladi.
   * Operator markazida "YUZ EKRANI" tugmasi orqali istalgan vaqtda qayta 3D yuz rejimiga qulflanish imkoniyati yaratildi.
4. **Android APK Yangilanishi va Qurilmaga O'rnatilishi**:
   * Yangi gorizontal va 3D modifikatsiyalangan versiya `gradlew.bat assembleDebug` orqali yig'ildi.
   * Ulangan Xiaomi / Redmi Note 11 Pro qurilmasiga to'g'ridan-to'g'ri yangilanib o'rnatildi va ishga tushirildi.


---

## 7-BOSQICH: Minimalist Och Yashil Fon, 3D Modelni Yarqiratish va Ekrandagi Ortiqcha Elementlarni Tozalash

1. **Bosh Sahifani Tozalash (Distraction-Free Face Mode)**:
   * Ekrandagi barcha chalg'ituvchi yozuvlar, ma'lumot vidjetlari (soat, sana, sektor, batareya holati) va ulkan SOS tugmalari to'liq olib tashlandi.
   * Ekran toza va estetik holatga keltirildi.
   * Faqat burchakda sezilar-sezilmas, ixcham va minimalist qulf tugmasi qoldirildi (operator bosib PIN/parol bilan boshqaruv paneliga o'tishi uchun).
2. **Och Yashil Fon (Soft Pastel Light Green)**:
   * HTML konteyner va Three.js sahnasi foni chiroyli och yashil rangga (`#D7F5DC`) o'tkazildi.
   * Tuman (fog) rangi ham och yashil qilib sozlandi.
3. **3D Modelni Yarqiraydigan (Glossy/Metallic/Specular) Qilish**:
   * Materiallar yaltiroq va silliq parametrlar bilan yangilandi (`roughness = 0.12`, `metalness = 0.55`).
   * Zümrad va sian rangdagi kuchli yon yorug'liklar (Rim Lights, intensity 4.5), asosiy tepa quyosh nuri (intensity 3.2) va orqa soch/yelka jilosi qo'shildi.
   * Natijada 3D model och yashil fonda yaltiroq, yarqiragan va jozibador ko'rinishga ega bo'ldi.
4. **Android APK Yangilanishi va Telefonga Qayta O'rnatilishi**:
   * Yangilangan kodlar asosida yangi APK kompilyatsiya qilindi (`qalqon-patrol-v1.0.apk`).
   * Ulangan Xiaomi / Redmi qurilmasiga to'g'ridan-to'g'ri o'rnatildi va ishga tushirildi.


---

## 8-BOSQICH: 3D Politsiyachi Modelining Orientatsiyasini To'g'rilash (Ekranga Yuzma-Yuz Qarash)

1. **Rotatsiya Muammosini Tahlil Qilish**:
   * `result.glb` modelining ichki koordinatalari tahlil qilindi (bitta statik mesh `tripo_node_...`). Model eksport qilinganda dastlabki yo'nalishi +X o'qiga (90 gradus o'ngga) qaragan holatda bo'lgan, natijada kamera oldida yonboshlab qolgan edi.
2. **Kamera Markazi va Boshlang'ich Burilish (Base Rotation)**:
   * Model markazi atrofida siljimasdan erkin aylanishi uchun `THREE.Group` wrapper tizimi joriy etildi.
   * Asosiy burchak: `BASE_ROTATION_Y = -Math.PI / 2` (-90 gradus) o'rnatildi.
   * Natijada politsiyachining yuzi to'ppa-to'g'ri foydalanuvchiga (ekranga) qarab turishi ta'minlandi.
3. **Jonli Kuzatuv Ritmiga Moslash**:
   * To'g'ri qaragan holatdan turib silliq mayin burchaklar ostida ($\pm 0.30$ rad, ya'ni $\approx \pm 17^\circ$) chapga va o'ngga atrofni sergak kuzatishi saqlab qolindi.
4. **Android APK Yangilanishi va Qurilmaga O'rnatilishi**:
   * Yangi to'g'rilangan APK fayli kompilyatsiya qilindi (`qalqon-patrol-v1.0.apk`).
   * Ulangan Xiaomi / Redmi qurilmasiga to'g'ridan-to'g'ri o'rnatildi va ishga tushirildi.
