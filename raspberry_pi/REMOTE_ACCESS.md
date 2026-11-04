# Masofaviy admin boshqaruvi (internet orqali)

Ikkinchi planshet (admin) internet orqali saytdagi **Admin** panelga kiradi va robotni qo'lda boshqaradi. Buyruq
to'g'ridan-to'g'ri shu Raspberry Pi ga boradi. Robotdagi monitor buyruqni ko'rib turadi ("Masofaviy admin: Oldinga").

```
Admin planshet  --HTTPS-->  Cloudflare  --tunnel-->  Pi :8000 (qalqon_brain.py)  --USB-->  Arduino
                                                         |
Monitor (robotda)  <--- LAN: telemetriya (/ws) <---------+   (admin buyruqlari "admin" deb belgilanadi)
```

## 1. Pi da admin tokenni o'rnatish

Token uzun tasodifiy qator bo'lsin (kamida 24 belgi). Kodda saqlanmaydi.

```bash
sudo mkdir -p /etc/qalqon
echo "QALQON_ADMIN_TOKEN=$(openssl rand -hex 24)" | sudo tee /etc/qalqon/remote.env
sudo chmod 600 /etc/qalqon/remote.env
sudo cat /etc/qalqon/remote.env          # tokenni ko'chirib oling va admin planshetga kiriting
```

Qo'shimcha sozlamalar (ixtiyoriy, shu faylga):

| O'zgaruvchi | Standart | Ma'nosi |
|---|---|---|
| `QALQON_LEASE_MS` | 700 | Admin harakat buyrug'i shu vaqt ichida yangilanmasa, robot o'zi to'xtaydi (deadman) |
| `QALQON_LOCAL_HOLD_MS` | 3000 | Monitor buyruq bersa, admin harakati shuncha vaqt to'xtatiladi |
| `QALQON_REMOTE_MAX_SPEED` | 2 | Admin tanlay oladigan eng yuqori tezlik darajasi |
| `QALQON_LOCAL_HOSTS` | (bo'sh) | Faqat sinov uchun: lokal hisoblanadigan Host nomlari ro'yxati |

Systemd xizmati bu faylni avtomatik o'qiydi (`EnvironmentFile`). Qayta ishga tushiring:

```bash
sudo cp systemd/qalqon-core.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl restart qalqon-core
```

Token yo'q bo'lsa masofaviy kirish **butunlay o'chiq** (Pi jurnalida ogohlantirish chiqadi).

## 2. Cloudflare Tunnel (Pi ni internetga chiqarish)

Robot 4G/hotspotda bo'lsa, tashqaridan Pi ga to'g'ridan-to'g'ri ulanib bo'lmaydi. Tunnel Pi dan tashqariga ulanadi, shuning
uchun port ochish yoki statik IP kerak emas.

### A) Tez yo'l (quick tunnel, domen kerak emas)

```bash
# cloudflared ni o'rnatish (Raspberry Pi OS, arm64)
curl -L -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb

cloudflared tunnel --url http://localhost:8000
```

Konsolda `https://xxxx.trycloudflare.com` manzili chiqadi. **Har qayta ishga tushganda manzil o'zgaradi**, uni admin panelda
"Raspberry Pi API manzili" maydoniga kiritasiz. Sinov uchun qulay, doimiy ishlash uchun B) variantni tavsiya qilamiz.

### B) Doimiy yo'l (named tunnel, Cloudflare ga ulangan domen kerak)

```bash
cloudflared tunnel login
cloudflared tunnel create qalqon
cloudflared tunnel route dns qalqon robot.sizning-domeningiz.uz
```

`/etc/cloudflared/config.yml`:

```yaml
tunnel: qalqon
credentials-file: /home/pi/.cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: robot.sizning-domeningiz.uz
    service: http://localhost:8000
  - service: http_status:404
```

```bash
sudo cloudflared service install      # Pi yoqilganda avtomatik ishga tushadi
```

Manzil doimiy bo'ladi: `https://robot.sizning-domeningiz.uz`.

## 3. Admin planshetdan kirish

1. Saytni oching va `#admin` qo'shing: `https://<sayt-manzili>/#admin` (yoki qulf ekranidagi qalqon-belgi tugmasi).
2. **Raspberry Pi API manzili**: tunnel manzili. **Admin token**: 1-bosqichdagi token.
3. "Ulanish". Token noto'g'ri bo'lsa yoki Pi javob bermasa, sababi ko'rsatiladi.
4. Yo'nalish tugmasini **ushlab turing**: robot yuradi, qo'yib yuborsangiz to'xtaydi. Klaviatura: W A S D Q E, Space/Esc (STOP).

## 4. Xavfsizlik qoidalari (kodda amalga oshirilgan)

- Tunnel orqali kelgan har bir so'rov **token talab qiladi** (Cloudflare sarlavhalari yoki lokal bo'lmagan Host bo'yicha aniqlanadi).
  LAN dagi monitor avvalgidek tokensiz ishlaydi.
- Admin faqat buyruq, telemetriya, video va holat yo'llariga kira oladi. To'siq simulyatsiyasi, OTA va boshqa xizmat yo'llari yopiq.
- **Deadman**: aloqa uzilsa yoki planshet o'chsa, `QALQON_LEASE_MS` dan keyin robot to'xtaydi. Admin STOP ni har doim yubora oladi.
- **Lokal ustuvorlik**: monitordan buyruq kelsa, admin harakati vaqtincha to'xtatiladi (409).
- **Kalit**: monitorning Sensorlar panelida "Masofaviy admin: Ruxsat/Taqiq". Taqiqda faqat STOP ishlaydi.
- Noto'g'ri token urinishlari cheklanadi (8 marta/daqiqa, keyin 429).
- Admin tezligi `QALQON_REMOTE_MAX_SPEED` bilan cheklangan.

### Cheklovlar va ehtiyot choralari

- Token URL parametri sifatida faqat video (`<img>`) va WebSocket uchun yuboriladi (brauzer ularga sarlavha qo'sha olmaydi).
  HTTPS ichida shifrlangan, lekin Cloudflare jurnallarida ko'rinishi mumkin. Shubha bo'lsa tokenni almashtiring.
- Cloudflare quick tunnel kafolatlangan xizmat emas. Muhim holatlar uchun named tunnel va Cloudflare Access (qo'shimcha
  login) ni qo'shishni o'ylab ko'ring.
- Internet orqali g'ildirakli robotni boshqarish xavfli: birinchi sinovni past tezlikda, g'ildiraklar ko'tarilgan holda o'tkazing.
- Admin ko'rmaydigan to'siqlar ham bo'lishi mumkin (kechikish, kamera ko'rish maydoni). Avto-tormoz (sonar, LiDAR) Pi
  tomonida baribir ishlaydi.

## 5. Kompyuterda sinash (apparatsiz)

```powershell
cd raspberry_pi
python test_remote_control.py                    # birlik sinovlari (28 ta)

$env:QALQON_ADMIN_TOKEN="demo123"; $env:QALQON_LOCAL_HOSTS="127.0.0.1"; python dev_mock_pi.py
```

- Monitor: `http://127.0.0.1:8000` (lokal). Saytning Sozlamalar bo'limida Pi manzili `127.0.0.1`, haqiqiy rejim.
- Admin: `http://localhost:8000` (masofaviy hisoblanadi), token `demo123`, sayt `http://localhost:5180/#admin`.
