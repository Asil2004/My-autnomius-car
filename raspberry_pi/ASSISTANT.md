# Ovozli yordamchi (lex.uz bazasi asosida savol-javob)

Robot yuzi "**Qalqon**" deb chaqirilganda savolni eshitadi, lex.uz bazasidan mos moddalarni topadi, Gemini yordamida
qisqa javob tayyorlaydi va **Sardor ovozida** aytadi. Ekranda javob, manbalar (modda va lex.uz havolasi) ko'rinadi.

```
Planshet (Chrome nutq tanishi, uz-UZ) --matn--> Pi /api/assistant/ask
   Pi: qidiruv (modda bo'laklari) -> Gemini (faqat shu moddalardan) -> edge-tts Sardor (mp3)
Planshet <-- javob matni + manbalar + mp3 --- Pi        (og'iz mp3 balandligiga qarab qimirlaydi)
```

## Yoqish va o'chirish
Holat Pi da saqlanadi va telemetriya orqali hammaga tarqaladi:
- Monitor: Boshqaruv HUD -> Sensorlar paneli -> **Ovozli yordamchi** (Yoqilgan/O'chiq).
- Admin panel (internet orqali): **Ovozli yordamchi** qatori. Admin faqat yoqish/o'chirish va holatni ko'ra oladi, savol bera olmaydi.
- Standart: **o'chiq**. Pi qayta ishga tushganda ham oxirgi holat saqlanadi (`/tmp` da, qayta yuklanganda o'chiq qaytadi).

## O'rnatish (Pi da)
```bash
pip3 install edge-tts          # Sardor ovozi (requirements.txt da bor)
sudo mkdir -p /etc/qalqon
sudo tee /etc/qalqon/assistant.env >/dev/null <<'EOF'
QALQON_GEMINI_API_KEY=SIZNING_KALITINGIZ
QALQON_GEMINI_MODEL=gemini-2.5-flash
EOF
sudo chmod 600 /etc/qalqon/assistant.env
```
`systemd/qalqon-core.service` ga `EnvironmentFile=-/etc/qalqon/assistant.env` qatorini qo'shing va xizmatni qayta ishga tushiring.
Kalit **faqat Pi da** turadi, saytda yo'q. Kalit bo'lmasa, yordamchi eng mos modda matnini o'qib beradi (Gemini siz).

**Model nomi:** Google modellarni almashtirib turadi. Joriy nomni [ai.google.dev](https://ai.google.dev) dan tekshiring va
`QALQON_GEMINI_MODEL` ga yozing. Ba'zi eski Live modellar 2026-noyabrda o'chirilishi haqida ma'lumot bor.

## Bilim bazasi (lex.uz)
Hujjatlar ro'yxati: `knowledge/sources.json`. Hozir 6 ta hujjat (3002 modda bo'lagi):
Konstitutsiya, Jinoyat kodeksi, Jinoyat-protsessual kodeks, Oila kodeksi, "Ichki ishlar organlari to'g'risida"gi qonun,
Startaplar bo'yicha qaror.

```bash
python knowledge/ingest_lex.py                         # sources.json dagi hammasini qayta yuklash
python knowledge/ingest_lex.py --url https://lex.uz/docs/12345 --title "Hujjat nomi"   # bittasini qo'shish
python knowledge/ingest_lex.py --cache-dir /tmp/lexcache   # HTML ni saqlab, qayta yuklamaslik
```
Natija `knowledge/lex_chunks.json` (repoda). **Qonunlar o'zgaradi**: vaqti-vaqti bilan qayta yuklang (masalan oyiga bir marta).
lex.uz da ommaviy API yo'q, skript har so'rov orasida 2 soniya kutadi. Foydalanish shartlarini Adliya vazirligidan aniqlang.

## Javob qoidalari (kodda)
- Javob faqat topilgan moddalardan. Mos modda topilmasa Gemini chaqirilmaydi: "Bu savolga bazamda javob topa olmadim."
- Har javobda manbalar ro'yxati va "Bu ma'lumot, yuridik maslahat emas" ogohlantirishi.
- Sardor ovozi faqat **lotin** yozuvini o'qiydi: javob avtomatik lotinga o'giriladi (lex.uz matni kirillda).
- Savol matni jurnalga yozilmaydi, ovoz saqlanmaydi. Planshetdan Pi ga faqat tanilgan MATN yuboriladi.

## Cheklovlar va ehtiyot choralari
- **Qidiruv sifati cheklangan:** sinovda 12 ta savoldan 9 tasida to'g'ri modda dastlabki 4 ta natijada chiqdi. Gemini kaliti bo'lsa savol
  qonuniy atamalarga qayta yoziladi (yaxshilaydi), lekin real savollar bilan sinash kerak. Keyingi qadam: embedding qidiruv.
- **Nutq tanish:** Chrome ning ichki xizmati, internet kerak, uz-UZ sifati o'zgaruvchan. Shovqinli joyda "Qalqon" so'zi eshitilmasligi mumkin.
  Ekranda "Savolni yozing" maydoni ham bor.
- **Mikrofon ruxsati** va brauzerning avto-ijro cheklovi: birinchi marta ovoz bloklansa, "Ovozni eshitish uchun bosing" chiqadi.
- Sayt `https` da, Pi esa `http` bo'lsa brauzer so'rovni bloklaydi. Planshet saytni Pi dan yoki lokal tarmoqdan `http` orqali ochishi kerak.
- Yuridik javob xato bo'lishi mumkin: politsiya robotida bu jiddiy xavf. Muhim savollarda javobni mutaxassis tekshirishi tavsiya etiladi.
- Pi 4 da bazani indekslash fonda ~30-60 soniya olishi mumkin (server shu vaqt ichida ham ishlaydi).

## Sinov
```bash
python test_assistant.py        # 38 ta sinov (soxta Gemini va ovoz bilan)
# apparatsiz: python dev_mock_pi.py  (QALQON_ADMIN_TOKEN, QALQON_LOCAL_HOSTS sozlamalari bilan)
```
