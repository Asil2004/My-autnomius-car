@echo off
chcp 65001 > nul
echo ======================================================================
echo 🛡️  QALQON AMR — LOKAL TEST TIZIMI (PC / RASPBERRY PI)
echo ======================================================================
echo.
echo 1. Apparat datchiklar (Kameralar, LiDAR, Arduino) tekshirilmoqda...
py -3 raspberry_pi\local_hardware_check.py

echo.
echo ======================================================================
echo 🚀 QALQON BRAIN SERVERINI ISHGA TUSHIRISH (localhost:8000)
echo ======================================================================
echo To'xtatish uchun: Ctrl + C
echo.
py -3 -m uvicorn qalqon_brain:app --app-dir raspberry_pi --host 0.0.0.0 --port 8000 --reload
