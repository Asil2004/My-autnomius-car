#!/usr/bin/env bash
# QALQON kamera serverini ishga tushirish (Raspberry Pi / Linux).
#   1) Python virtual muhit (.venv) va kutubxonalar (birinchi marta)
#   2) Server: http://<PI_IP>:8090/camera
#
# Doimiy avto-start kerak bo'lsa: scripts/setup_pi_camera_link.sh (systemd xizmati o'rnatadi).
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [ ! -x .venv/bin/python ]; then
  echo "Python muhiti yaratilmoqda..."
  python3 -m venv .venv
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install -r requirements.txt
fi

[ -f .env ] || cp .env.example .env

PORT="${1:-8090}"
echo "Kamera serveri: http://0.0.0.0:${PORT}/camera  (to'xtatish: Ctrl+C)"
exec .venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port "$PORT"
