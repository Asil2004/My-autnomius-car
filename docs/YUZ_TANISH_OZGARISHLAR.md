# Yuz orqali tanish: qilingan o'zgarishlar

Sana: 2026-11-02. Kamera qismi (HUD, "Frontal Kamera" rejimi).

## Maqsad

- Bazadagi shaxslar yuzi orqali ismi bilan tanilsin.
- Bazada yo'q yoki yuzi ko'rinmagan har qanday odam **"Piyoda"** deb ko'rsatilsin.
- Odam hech qachon "obyekt" yoki "Noma'lum" deb yozilmasin.
- Mashina, yuk mashinasi, avtobus, motosikl va velosiped aniqlanishda qoladi. Boshqa COCO klasslari ko'rsatilmaydi.

## Oldingi holat

| Muammo | Tavsif |
|---|---|
| Haqiqiy yuz tanish emas | 4x4 to'r bo'yicha yorqinlik va gradient, Pearson korrelyatsiyasi (chegara 0.58) |
| Yuz detektori yo'q | "Yuz" odam ramkasining yuqori qismidan taxminan qirqilgan |
| Qirqish 3 rasmga moslangan | Yangi rasm noto'g'ri qirqilar edi |
| Baza faqat xotirada | Sahifa yangilansa qo'shilgan odamlar yo'qolardi |
| Yuklanish paytida soxta ramkalar | Kontekstdagi namuna "Odam/Mashina" ramkalari jonli kamera ustida turardi |

## Yangi mantiq

1. COCO-SSD odam va transport ramkalarini topadi (avvalgidek).
2. `face-api.js` (TinyFaceDetector, 68 landmark, FaceRecognitionNet) kadrdagi yuzlarni topadi. Har yuz uchun 128 o'lchamli embedding olinadi.
3. Embedding bazadagilar bilan Euclid masofasi bo'yicha solishtiriladi. Chegara **0.5** (face-api standarti 0.6, qat'iyroq qilindi).
4. Yuz o'zini o'z ichiga olgan eng kichik odam ramkasiga biriktiriladi.
5. Ism faqat oxirgi 5 yuz kadridan kamida 3 tasi bir xil odamni ko'rsatsa chiqadi. Ismning miltillashi shu bilan to'xtatilgan.
6. Natija:

| Holat | Ramkada |
|---|---|
| Yuz topildi va bazadagi kishiga mos | Ism-familiya |
| Yuz topildi, bazada yo'q | Piyoda |
| Yuz ko'rinmaydi (orqasi bilan, uzoqda) | Piyoda |
| COCO odamni topmadi, lekin yuz bor | Yuz ramkasi, ism yoki Piyoda |

## O'zgargan fayllar

| Fayl | O'zgarish |
|---|---|
| `frontend/src/services/faceRecognitionService.ts` | To'liq qayta yozildi: model yuklash, embedding, solishtirish, kuzatuv va ovoz berish, `localStorage` bazasi |
| `frontend/src/components/HUDView.tsx` | `detectFrame` yangi servisga ulandi. Yuz va COCO modeli parallel yuklanadi. Soxta ramkalar tozalanadi. Yangi shaxs qo'shishda xato ko'rsatiladi. COCO modeli lokal yuklanadi va bir marta keshlanadi |
| `frontend/package.json`, `package-lock.json` | Qo'shildi: `@vladmandic/face-api`, `@tensorflow/tfjs-backend-wasm` (face-api build uchun kerak, ishlatilmaydi) |
| `frontend/public/models/face` va `frontend/public/models/coco-ssd` | Yuz modellari (~7 MB) va COCO-SSD lite (~18 MB), internetsiz ishlaydi. Bu PR'ga qo'shilmagan: ular `main`da allaqachon shu yo'llarda bor, kod shularni o'qiydi |
| `frontend/src/assets/faces/descriptors-cache.json` (yangi) | 3 kishining oldindan hisoblangan embeddinglari. Ishga tushganda rasmlar qayta ishlanmaydi |

## Baza

- Bazadagi 3 kishi: Qo'ldoshev Sarvar, Asilbek Ravshanov, Bozorov Boburjon.
- Yangi shaxs "Yuzlar Bazasi" orqali qo'shiladi. Yuzi aniq ko'ringan rasm shart, rasmda yuz topilmasa qo'shilmaydi.
- Qo'shilgan shaxslar `localStorage`da (`qalqon.faceDb.v1`) embedding va 96 px kichik rasm bilan saqlanadi.
- Yuz embeddinglari biometrik ma'lumot: bazaga faqat roziligi bor odamlarni kiriting.
- 3 ta asosiy rasm yoki yuz modeli almashtirilsa, `descriptors-cache.json`ni qayta hisoblang. Faylni o'chirsangiz, ilova rasmlardan o'zi hisoblaydi, lekin sekinroq.

## Topilgan va tuzatilgan muammolar

| Muammo | Tuzatish |
|---|---|
| Sarvar rasmi (yuz butun kadrni egallagan) topilmadi | Topilmasa rasm atrofiga bo'sh joy qo'shib qayta urinadi |
| AI yuklanishi ~1 daqiqa | COCO modeli Google serveridan sekin va dev rejimida ikki marta yuklanardi. Endi lokal va bir marta. Embeddinglar oldindan hisoblangan. Modellar parallel yuklanadi |
| Yuklanish paytida soxta "Odam (Piyoda)" va "Mashina" ramkalari | HUD ochilganda tozalanadi |
| "The play() request was interrupted by a new load request" xatosi, kamera ochilmasdi | Dev rejimida (StrictMode) kamera ikki marta ochilib, birinchisining `play()` chaqiruvi ikkinchisi tomonidan uzilardi. Endi har chaqiruvga raqam beriladi, eskirgan chaqiruv oqimni to'xtatib, xato ko'rsatmay chiqib ketadi |
| Yuz modeli yuklanmasa butun AI to'xtardi | COCO ishlayveradi, barcha odamlar "Piyoda", jurnalga xato yoziladi |

## Masofani o'lchash (yangilandi)

Eski formula: `K / ramka_balandligi_foizda` (K = 52 yoki 68, taxminiy). U kameraga bog'liq edi va yaqin turgan odamda (yuz va yelka kadrda) noto'g'ri chiqardi. Yangi mantiq `frontend/src/services/distanceService.ts` ichida.

| Qism | Tavsif |
|---|---|
| Pinhole modeli | `masofa = haqiqiy_o'lcham * fokus_px / piksel_o'lcham`. Haqiqiy balandlik: odam 1.7 m, yengil mashina 1.5 m, yuk mashinasi 3.0 m, avtobus 3.2 m, motosikl 1.4 m, velosiped 1.1 m |
| Yuz kengligi | Odamning yuzi topilsa, masofa yuz kengligidan hisoblanadi (yuz ~16 sm). Yuz kadrdan kesilmaydi, shuning uchun yaqin masofada gavdadan aniqroq |
| Kalibrovka | HUD'dagi "Kalibrovka" tugmasi: kameradan ma'lum masofada turib yuz kengligidan fokus hisoblanadi. Fokus kadr balandligiga nisbatan saqlanadi (`localStorage`, `qalqon.camCalib.v1`), video o'lchami o'zgarsa ham to'g'ri qoladi. Kalibrovka yo'q bo'lsa, vertikal ko'rish burchagi 45° deb olinadi |
| Silliqlash | Obyekt kadrlar bo'ylab kuzatiladi, oxirgi 5 qiymat medianasi ko'rsatiladi |
| Sonar | Faqat haqiqiy robot rejimida va RPi ulanganda. Obyekt kadr markazida (±18%), sonar 4 m ichida va kamera bahosidan ±50% ichida bo'lsa, sonar qiymati ishlatiladi. Simulyatsiya rejimida sonar tasodifiy sonlar bo'lgani uchun ishlatilmaydi |
| Kesilgan ramka | Odam gavdasi ramkasi kadr yuqori yoki pastki chetiga tegsa va yuz ko'rinmasa, masofa `~` bilan (taxminiy) ko'rsatiladi |
| Chegaralar | 0.3 m dan 30 m gacha (avval 0.6-18 m) |

O'zgargan fayllar: `distanceService.ts` (yangi), `HUDView.tsx` (hisob, kalibrovka oynasi, `D: ~x m` yozuvi), `faceRecognitionService.ts` (yuz ramkasi qaytariladi), `types/robot.ts` (`distanceSource`, `distanceApprox`).

Sinov (hisob): gavda 500 px = 3.0 m, yuz 100 px = 1.4 m, mashina 200 px = 6.5 m. Kalibrovka (1 m da yuz 120 px) keyin 120 px = 1.0 m va 60 px = 2.0 m, 480p video ham shu natijani beradi. Sonar to'rt holatda to'g'ri tanlanadi. HUD'da kalibrovka oynasi ishlaydi, saqlanadi va yozuv `D: 1m` ga o'zgaradi.

Real kamerada topilgan xatolar va tuzatishlar (2026-11-02):

| Muammo | Tuzatish |
|---|---|
| Odam kadrga yopishib turganda (bosh va yelka ko'rinadi) `D: 3.8m` chiqardi | Odam gavdasi kadr chetiga tegsa (3% tolerantlik) yoki kadr balandligining 85% idan oshsa, "kesilgan" deb hisoblanadi. Masofa gavda balandligi va yelka kengligi (0.45 m) bo'yicha hisoblanib, kichigi olinadi, yozuv `~` bilan chiqadi. Avval chet tekshiruvi 2 piksel edi, shuning uchun ishlamagan |
| Kalibrovka "yuz kadrda aniq ko'rinsin" deb rad etardi | Yuz kadrlari 2 s o'rniga 3 s ichida yig'iladi, 3 o'rniga 2 kadr yetarli (sekin qurilmada sikl ~1 kadr/0.7 s bo'lishi mumkin). Xabar endi nechta kadr yig'ilganini va nima qilish kerakligini aytadi |
| Noto'g'ri kalibrovka masofani buzardi | Kamera ko'rish burchagi 25-75° dan tashqari chiqsa, kalibrovka rad etiladi va sabab yoziladi. Saqlangan noto'g'ri qiymatlar ham yuklanmaydi |
| Nima uchun yuz topilmayotgani ko'rinmasdi | Yuqori chapdagi panelda yangi `YUZ:` qatori: modelning holati (yuklanmoqda / tayyor / xato), kadrdagi yuzlar soni va kengligi (px), bir kadr necha ms |

Ko'z orasidagi masofa (faqat tizim uchun, ekranda ko'rsatilmaydi): ko'zlarning tashqi burchaklari (landmark 36 va 45) orasidagi masofa har kadrda hisoblanadi va alohida kalibrovka qilinadi (kalibrovka bir vaqtda yuz ramkasi va ko'z orasini saqlaydi, ko'z orasi 9 sm deb olinadi). Ekranda na chiziq, na `KO'Z:` qiymati bor. Asosiy masofa (ramkadagi `D:`) yuz ramkasi bo'yicha.

Juda yaqin masofa (~30 sm, yuz kadrni to'ldiradi): oddiy yuz detektori bunday katta yuzni topmaydi, shuning uchun dastur gavda bo'yicha taxmin qilib, `~0.5 m` chiqarardi. Tuzatish:
- Odam ramkasi kadrning yarmidan katta, lekin yuz topilmagan bo'lsa, kadr 2 baravar kichraytirilib (atrofiga kulrang fon qo'shib) yuz qayta qidiriladi. Sinovda 12 ta katta yuz kadridan oddiy aniqlash 3 tasini, kichraytirilgan kadr 10 tasini topdi. Faqat shunday holatlarda ishlaydi, ortiqcha xarajat yo'q.
- Yuz hamon topilmasa va odam kadrni ikki o'qda ham to'ldirgan bo'lsa, hisob faqat yuqori chegarani beradi, shuning uchun yozuv `D: <0.5m` bo'ladi (haqiqiy masofa undan kichik), aniq raqam emas.
- Kichraytirilgan kadrda yuz o'lchami oddiy aniqlashdan ~3% farq qilishi mumkin.

Kalibrovka datchigi (kalibrovka oynasida): **sariq** nuqta va to'ldirilayotgan chiziq, ma'lumot yetarli bo'lgach **yashil**. Yashil bo'lishi uchun oxirgi 4 soniyada yuz kamida 3 kadrda topilgan va yuz kengligi barqaror (eng katta va eng kichik qiymat farqi mediananing 12% idan oshmasligi) kerak. Datchik yashil bo'lmaguncha "Kalibrovka qilish" tugmasi o'chiq turadi. Yuz yo'qolsa, datchik yana sariqqa qaytadi. Matnli izoh nima qilish kerakligini aytadi (yuz topilmadi, qimirlamang va hokazo).

Kalibrovka masofasi standart **50 sm (0.5 m)**: odam kameradan 50 sm da turadi. 720p veb-kamerada bu holatda yuz kengligi ~280 px bo'lishi kerak (standart 45° ko'rish burchagida). Masofani oynadagi maydonda 0.3-10 m oralig'ida o'zgartirish mumkin.

Cheklov: aniqlik kalibrovkaga bog'liq. Kalibrovka yuz kengligini 16 sm deb oladi, odamlarda bu ~±10% farq qiladi. Mashina masofasi klass bo'yicha o'rtacha balandlikka tayanadi, shuning uchun ±20-30% xato bo'lishi mumkin.

## Interfeys (HUD, noutbuk ekrani)

| O'zgarish | Tavsif |
|---|---|
| Kadr to'liq | Video qutisi videoning haqiqiy nisbatida (16:9 yoki 4:3), kesilmaydi. Eni ekran balandligiga sig'adigan qilib cheklanadi (1366x768 da chap ustun scrollsiz 716 px gacha) |
| Ramkalar aniq | Quti kadr bilan bir xil o'lchamda, shuning uchun ramkalar va ko'z chizig'i yuzga to'g'ri tushadi. Avval markaz nishoni video bilan bir qatorda flex bolasi bo'lib, videoni 56 px toraytirib, `object-cover` kadrni kesib turgan edi |
| Kadr ustida faqat ramkalar | Markaz nishoni (crosshair), burchakdagi AZIMUT va KOMANDA yozuvlari, sonar chiplari va katta "TO'SIQ" banneri olib tashlandi: ular kameraning ko'rinishini buzardi. Qoldi: aniqlangan odam va mashina ramkalari, ko'z chizig'i, yuklanish va xato xabarlari |
| Sonarlar video ostidagi qatorda | 4 ta chip: ↑ OLD, ← CHAP, → O'NG, ↓ ORQA. Rang: yashil xavfsiz, sariq <=45 sm, qizil <=22 sm. OLD xavfda qizarib miltillaydi va "TO'SIQ" yozadi. Qatorning o'ng tomonida AZIMUT va KOMANDA. Pastdagi eski alohida sonar paneli o'chirildi |
| AI paneli video ostida | Yuqori chapdagi 6-8 qatorli panel bitta qatorga aylandi: `AI`, `OBYEKT`, `YUZ`, `RAMKA`, `KO'Z`, `GPS` aniqligi. Qiymatlar bo'lmasa joyi `—` bilan saqlanadi, qator sakramaydi |
| Pastki qatorlar doim sig'adi | Video qutisi eni taxminiy son bilan emas, `ResizeObserver` orqali panelning haqiqiy bo'sh joyiga hisoblanadi: nisbatni saqlagan holda sig'adigan eng katta o'lcham. Yuqori panel o'ralib ketsa yoki brauzer masshtabi o'zgarsa ham AI qatori, sonar qatori va PTZ ekran ichida qoladi. O'lchov: 1366x768 (video 680x383), 1366x640 (476x268), 1920x1080 (858x483): PTZ hammasida pastki menyudan yuqorida |
| Markaz nishonidagi GPS yozuvi olib tashlandi | U yuz ustiga tushardi, GPS yuqori panelda bor |

## Tekshirilgan

| Sinov | Natija |
|---|---|
| `tsc` va `vite build` | O'tdi |
| 3 kishining rasmi (kichraytirilgan, qorong'ilashtirilgan) | Hammasi to'g'ri taniladi, ishonch 87-94% |
| Bazadan olib tashlangan odam | Piyoda |
| Yuzsiz sahna, odam ramkasi bor | Piyoda |
| Faqat yuz bor, COCO topmagan | Yuz orqali tanildi |
| Odamlar orasidagi masofa | 0.65-0.81 (chegara 0.5 dan katta) |
| Yangi shaxs qo'shish va saqlash, yuzsiz rasmni rad etish | Ishladi |
| HUD jonli sikli (veb-kamera o'rniga rasmli sun'iy video oqimi) | Ismlar real vaqtda almashadi, soxta ramkalar yo'q |

## Tekshirilmagan

- Haqiqiy veb-kamera bilan aniqlik: yorug'lik, burchak, masofa. Claude paneli kamerani bloklaydi, shuning uchun faqat Chrome'da sinaladi.
- Raspberry Pi va telefon (APK) tezligi. Intel UHD'da bitta yuz kadri ~90 ms.
- RPi oqimi ("RPi Oqim" rejimi) yuz tanishni qo'llamaydi, faqat "Frontal Kamera".

## Eslatma

- Modellar (~25 MB) shu branchda yo'q: `main`dagi `public/models/face` va `public/models/coco-ssd` ishlatiladi. Branchni `main`siz (eski asos ustida) ishga tushirsangiz, modellar topilmaydi.
- Chegarani (0.5) va ovoz berish parametrlarini (5/3) real kamera sinovidan keyin sozlash mumkin: `faceRecognitionService.ts` boshidagi `MATCH_DISTANCE`, `VOTE_WINDOW`, `VOTE_NEEDED`.
