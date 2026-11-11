# QALQON kamera serveri (PTZ + o'ng + chap)

CP-159-1 (V380) uch linzali IP kamera uchun video va burish (PTZ) servisi. Asl modul: `Desktop\Kamera\kamera_modul`.

| Linza | Yo'nalish | HUD dagi joyi |
|---|---|---|
| `lens=0` | PTZ (buriladi) | **PTZ** oynasi, joystik bilan boshqariladi |
| `lens=1` | o'ngga qaragan | **O'ng** oynasi |
| `lens=2` | chapga qaragan | **Chap** oynasi |

## Ishga tushirish

```powershell
cd camera_server
powershell -ExecutionPolicy Bypass -File start.ps1
```

Birinchi marta `.venv` yaratib kutubxonalarni o'rnatadi. Kamera noutbukka LAN kabel bilan to'g'ridan-to'g'ri ulangan bo'lsa
(noutbuk LAN porti `192.168.1.10`), kameraga `192.168.1.100` manzilini beradigan DHCP yordamchisini ham ishga tushiradi.

Tekshirish: brauzerda `http://localhost:8090/camera/` (asl boshqaruv sahifasi) yoki `http://localhost:8090/camera/status`.

## HUD bilan ulanish

HUD: **Sozlamalar → PTZ kamera moduli** — manzil standart holatda `http://localhost:8090/camera`.
Kamera serveri boshqa kompyuterda (masalan Raspberry Pi da) ishlasa, shu yerga uning manzilini yozing: `http://<IP>:8090/camera`.

- Video: `GET /camera/stream?lens=N` (MJPEG, `<img>` orqali)
- Burish: `POST /camera/ptz/move` `{"pan": -1..1, "tilt": -1..1, "duration": 0.8}` — joystik bosilib turganda har 0.3 s da
  qayta yuboriladi; qo'yib yuborilsa `POST /camera/ptz/stop`. `duration` himoya: aloqa uzilsa kamera o'zi to'xtaydi.

`main.py` CORS va Chrome "Private Network Access" sarlavhasini qo'shadi, shuning uchun HUD `localhost:5173`, GitHub Pages
yoki planshetdagi APK dan ham buyruq yubora oladi. Ruxsat etilgan manzillarni cheklash: `.env` da
`CAMERA_CORS_ORIGINS=https://asil2004.github.io,http://localhost:5173`.

## Kamera sozlamalari

`.env` (`.env.example` dan nusxa): `CAMERA_HOST`, `CAMERA_RTSP_URL`, `CAMERA_ONVIF_PORT=8899`, `CAMERA_MAX_WIDTH`,
`CAMERA_INVERT_PAN/TILT`. Batafsil: kamera haqidagi eslatmalar `kamera/` modulidagi izohlarda va asl README da.

- V380 Pro ilovasida *Настройки → Дополнительно → Настройки onvif* **yoqilgan** bo'lishi shart (aks holda 554 va 8899 portlari yopiq).
- Kamera routerga ulangan bo'lsa, routerda kamera MAC manziliga doimiy IP bog'lang.
- `scripts/kamera_qidirish.ps1` — kamera IP manzilini topish (Administrator sifatida).
