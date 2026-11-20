FROM python:3.11-slim

WORKDIR /app

# Faqat yengil Python kutubxonalari (OpenCV VPS ga kerak emas — kadrlar Pi 5 da tayyorlanadi)
COPY vps/requirements.txt /app/vps/requirements.txt
RUN pip install --no-cache-dir -r /app/vps/requirements.txt

# VPS Cloud Relay serveri
COPY vps/vps_hub.py /app/vps/vps_hub.py

# Qurilgan frontend statik fayllari (index.html, assets, models, images, faces, audio)
COPY index.html favicon.svg shield.svg icons.svg /app/
COPY assets /app/assets
COPY models /app/models
COPY images /app/images
COPY faces /app/faces
COPY audio /app/audio

ENV QALQON_STATIC_DIR=/app
EXPOSE 8000

CMD ["uvicorn", "vps.vps_hub:app", "--host", "0.0.0.0", "--port", "8000", "--ws-ping-interval", "20", "--ws-ping-timeout", "20"]
