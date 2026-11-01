# 📱 «QALQON v1.0» — Raspberry Pi 4 uchun Telethon (MTProto) Integratsiyasi Qo'llanmasi

Ushbu yo'riqnoma Raspberry Pi 4 bort kompyuterida Telegram API bilan MTProto protokoli (Telethon) orqali to'g'ridan-to'g'ri bog'lanish, patrul xabarnomalari, favqulodda kadrlar va telemetriya signallarini IIV dispetcheriga inson aralashuvisiz avtonom yuborish tartibini tushuntiradi.

---

## 1. Telegram API Ma'lumotlarini Olish (`my.telegram.org`)

1. Brauzer orqali [my.telegram.org](https://my.telegram.org) saytiga kiring.
2. Telefon raqamingizni kiritib, Telegram ilovangizga kelgan kod orqali kiring.
3. **«API development tools»** bo'limiga o'ting.
4. Yangi ilova yarating:
   * *App title:* `QalqonPatrol`
   * *Short name:* `qalqonpi`
5. Quyidagi 2 ta kalitni oling:
   * **`api_id`** (masalan: `12345678`)
   * **`api_hash`** (masalan: `'abcdef0123456789abcdef0123456789'`)

---

## 2. Telethon Kutubxonasini O'rnatish

Raspberry Pi terminalida:

```bash
pip3 install telethon
```

---

## 3. Bir Martalik Avtorizatsiya va Sessiyani Saqlash

Quyidagi skriptni bir marta ishga tushirib, telefon raqam va SMS/Telegram kodini kiriting (`setup_telethon.py`):

```python
from telethon import TelegramClient

api_id = 12345678  # O'zingizning api_id
api_hash = 'abcdef0123456789abcdef0123456789'  # O'zingizning api_hash
phone = '+998XXXXXXXXX'

client = TelegramClient('qalqon_session', api_id, api_hash)

async def main():
    await client.start(phone=phone)
    me = await client.get_me()
    print(f"✅ Ulandi: {me.first_name} (@{me.username})")

with client:
    client.loop.run_until_complete(main())
```

> **Eslatma:** Ushbu amaldan so'ng papkada `qalqon_session.session` nomli fayl paydo bo'ladi. Keyingi barcha avtomatik chaqiruvlarda hech qanday kod yoki parol so'ralmaydi!

---

## 4. Raspberry Pi Patrul Dasturida Ishlatish Namunasi

`pi_patrol.py` yoki `qalqon_brain.py` ichida hodisalar (odam ko'ringanda, to'siq bo'lganda yoki SOS 102 bosilganda):

```python
import asyncio
from telethon import TelegramClient

api_id = 12345678
api_hash = 'abcdef0123456789abcdef0123456789'

client = TelegramClient('/home/pi/qalqon_session', api_id, api_hash)

async def send_patrol_alert(photo_path: str, message_text: str, recipient: str = '@iiv_dispetcher'):
    await client.connect()
    if not await client.is_user_authorized():
        print("Xatolik: Telethon avtorizatsiyadan o'tmagan!")
        return

    # Surat va matnli xabarnoma yuborish
    await client.send_file(recipient, photo_path, caption=message_text)
    print("✅ Hodisa IIV ga yetkazildi!")
    
    await client.disconnect()

# Ishlatish:
# asyncio.run(send_patrol_alert('incident.jpg', '🚨 OGOHLANTIRISH: Piyoda taqiqlangan hududga kirdi!'))
```
