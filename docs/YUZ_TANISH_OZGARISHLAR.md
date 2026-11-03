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

## Birinchi ishga tushish tezligi (2026-11-03)

Muammo: kamera birinchi ochilganda yuz tahlili juda sekin, sahifa "qotib" qoladi.

| Topilma | Qiymat |
|---|---|
| Modellarni yuklab olish | ~0.5 s, muammo emas |
| Asosiy sabab | WebGL shaderlarini birinchi marta kompilyatsiya qilish: detektor ~13 s, landmark ~11 s, tanish ~10 s. Kompilyatsiya asosiy oqimni bloklaydi. Bu GPU/drayverga bog'liq (Intel UHD da ~35 s) |
| Ikkinchi sabab | Dev rejimida (`npm run dev`) har 800 ms da sensor simulyatsiyasi va har aniqlash siklida butun HUD qayta chiziladi (70-150 ms). Production'da bu yo'q |

Nima qilindi:
- Isitish jonli rejim bilan bir xil sozlamada o'tkaziladi.
- HUD yuz holatini haqiqiy tayyorlikdan oladi: dvigatel tayyor bo'lmasa "yuklanmoqda..." (avval noto'g'ri "topilmadi" yozardi). Yuklanish matni birinchi marta 10-40 s kutish kerakligini aytadi.
- Ramkalar kaliti barqaror, ramkalar va yuz ma'lumoti faqat ko'rinadigan o'zgarishda qayta chiziladi.
- Yuz modeli va COCO-SSD yuklanish vaqti ilova jurnaliga yoziladi.

Sinab ko'rilib, **rad etilgan** yo'llar:
- Modellarni login oynasida oldindan yuklash: kompilyatsiya asosiy oqimni bloklaydi (sinovda 14 s + 9 s + 4 s ketma-ket), sahifa qotadi. Qotishni HUD'dan login oynasiga ko'chiradi, yo'qotmaydi.
- tfjs `ENGINE_COMPILE_ONLY` (parallel kompilyatsiya): face-api bilan ishlamadi, haqiqiy tahlil baribir ~13 s qotdi.

Haqiqiy yechim (qilinmagan): AI'ni (COCO-SSD va face-api) Web Worker'ga ko'chirish (OffscreenCanvas bilan WebGL). Shunda kompilyatsiya va tahlil asosiy oqimni umuman bloklamaydi.

**ISHLATMANG:** `tf.env().set('WEBGL_USE_SHAPES_UNIFORMS', true)`. U birinchi ishga tushishni ~3 baravar tezlashtiradi, lekin face-api tarmoqlarida noto'g'ri natija beradi: yuz detektori hech narsa topmaydi (sinovda yuz: 0, sozlamasiz 1, embedding masofasi 0.095). Bir kun sinab ko'rilib, qaytarilgan.

Tezlik haqida eslatma: demo uchun production rejimi tezroq (`npm run build` va `npm run preview`). Chrome kompilyatsiya qilingan shaderlarni keshlaydi, shuning uchun ikkinchi marta ochilish tezroq bo'ladi.

## Aksessuar taqqan yuzlarni tanish (2026-11-03)

Maqsad: bazadagi shaxs ko'zoynak, bosh kiyim (kepka, toqi), kapyushon, niqob yoki taturovka bilan kameraga qaraganda ham tanilsin.

Usul: **bazadagi rasmga aksessuarlarni sun'iy chizib, har bir variantdan embedding olinadi**, jonli yuz asl rasm va barcha variantlar bilan solishtiriladi.

| Qism | Tavsif |
|---|---|
| `services/faceAugment.ts` (yangi) | 68 landmark bo'yicha ko'zoynak (oddiy va quyoshdan), kepka, toqi, kapyushon, 3 xil niqob, taturovka chizadi. 15 ta variant: 8 ta yakka va 7 ta birikma (masalan `sunglasses+mask_blue`, `hood+mask_black`) |
| Variantlar | Rasm jonli kadrga o'xshash sahnaga (1280x720, yuz ~280 px) joylanadi, variantlar shu yerda chiziladi, embedding jonli quvur bilan olinadi. Yuz topilmagan variantlar tashlanadi (bazada 11-12 tadan qoldi) |
| Kesh | `descriptors-cache.json` yangi formatda: `{ id: { base, variants } }` (41 KB). Yangi shaxs qo'shilganda variantlar shu yerning o'zida hisoblanadi (~15 ta, bir necha soniya, jurnalda ko'rinadi) va `localStorage`da saqlanadi |
| Solishtirish | Asl rasm chegarasi **0.50** (o'zgarmagan), aksessuarli shablonlar chegarasi **0.40**. Ikkalasi chegaraga nisbatan normallanadi, eng kichik nisbat tanlanadi |
| Niqobli yuz topish | Odam ramkasi bor, lekin yuz topilmasa, ramka ichida detektor chegarasi 0.25 ga tushirilib qayta qidiriladi (har 2-kadrda). Bahosi 0.4 dan past yuz ramkasi masofa va kalibrovkada ishlatilmaydi |
| Izni saqlash | Ovoz berish izi vaqt (1.5 s) bo'yicha emas, 6 kadr bo'yicha eskiradi. Eski usulda tahlil 1.5 s dan sekinlashsa ism hech qachon chiqmasdi |

**Nega chegara 0.40:** sinovda aksessuarli yuzlar HAR XIL odamlar bilan ham o'zaro yaqinlashadi (aksessuarli A va aksessuarli B orasidagi eng kichik masofa 0.45, toza yuzlarda ~0.65+). 833 juftlikdan 8 tasi 0.50 dan, 0 tasi 0.45 dan kichik edi. 0.50 da begonani tanib yuborish xavfi sezilarli bo'lardi.

O'lchov (sun'iy aksessuarlar, 3 kishi, 45 ta sinov kadri, shablonlarda ishlatilmagan boshqa shakl va o'lchamlarda):

| Ko'rsatkich | Natija |
|---|---|
| Yuz detektori topdi | 37 / 45 (8 tasi og'ir birikma: niqob + ko'zoynak + bosh kiyim, detektor yuzni umuman topolmaydi) |
| Faqat asl rasm bilan (0.50) | 31 / 37 to'g'ri, 6 ta o'tkazib yuborildi, 0 xato |
| Aksessuarli shablonlar bilan (0.40) | **36 / 37** to'g'ri, 1 ta o'tkazib yuborildi, 0 xato |
| Begona xavfi (aksessuarli yuz boshqa odam shablonlariga, 74 juft) | 0.50 da 7 ta, 0.45 da 1 ta, **0.40 da 0 ta** yaqinlashdi |
| Aksessuarsiz yuz boshqa odamning aksessuarli shabloniga | eng yaqin 0.59 |

**Cheklovlar (muhim):**
- Aksessuarlarni men kod bilan chizganman (oddiy shakllar), haqiqiy rasmdagi ko'zoynak, niqob va kapyushondan farq qiladi. Haqiqiy natija bundan YOMONROQ bo'lishi mumkin. Haqiqiy aksessuarli rasmlar bilan sinab ko'rish kerak.
- Bazada faqat 3 kishi: begona xavfi shu uchtasi orasida o'lchandi. Katta, xilma-xil odamlar orasida aksessuarli yuzlarning o'zaro yaqinligi yuqoriroq bo'lishi mumkin. Shuning uchun chegara 0.40, ovoz berish (5 kadrdan 3 tasi) saqlangan.
- Niqob + ko'zoynak + bosh kiyim bir vaqtda bo'lsa (og'ir birikma), yuz topilmaydi yoki masofa katta chiqadi: dastur "Piyoda" deydi. Bu xavfsiz tomonga xato.

### Muhammadali Ravshanov bazaga qo'shildi (2026-11-03)

- Rasm: `test_4.jpg` dan Exif/GPS'siz nusxa `frontend/src/assets/faces/muhammadali_ravshanov.jpg` (asl faylda GPS joylashuv bor edi, repoga tushmasligi uchun olib tashlandi). Asl `test_4.jpg` repo ildizida qoldi, **commit qilinmaydi**.
- Bazada: id `ravshanov-muhammadali`, lavozim "Ruxsat berilgan shaxs" (aytilmagan), belgi `VERIFIED`. Asl rasm + 11 aksessuar varianti keshda.
- Bevosita tekshiruv (sun'iy aksessuarlar, boshqa shakl/o'lcham): o'ziga eng yaqin masofa toza 0.05, ko'zoynak 0.30, niqob 0.28, kepka+ko'zoynak 0.25, kapyushon 0.10. Hammasida eng yaqin shaxs to'g'ri.
- **O'xshashlik xavfi:** Muhammadali va Asilbek (familiyalari bir xil) toza yuzlari orasida masofa **0.478**, qabul chegarasi (0.50) dan kichik. Ikkalasi bazada bo'lganda adashmaydi (o'z shaxsiga masofa ancha kichik va ikkinchisidan farqi chegaraning 12% idan katta bo'lishi shart: `MIN_RATIO_MARGIN`). Lekin **bazada bo'lmagan qarindosh yoki juda o'xshash odam** Asilbek yoki Muhammadali deb tanilishi mumkin (masalan, Muhammadali bazadan olib tashlansa, uning yuzi Asilbek deb tanilar edi: 0.47 < 0.50). Bu face-api embeddingining chegarasi. Chegarani (0.50) kamaytirish bu xavfni kamaytiradi, lekin haqiqiy kamerada o'z yuzini tanimay qolish ham ortadi. Aniq tanlash uchun har bir odamning haqiqiy kamera kadrlarini yig'ib o'lchash kerak.
- HUD'da Muhammadali bilan oxirigacha avtomatik sinov to'liq o'tkazilmadi (sinov vositam va oyna holati sabab to'xtadi). 3 shaxs bilan HUD sinovi to'liq o'tgan (bazada 9/9, begona 4/4).

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
