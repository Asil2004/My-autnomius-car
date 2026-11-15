@echo off
chcp 65001 >nul
title QALQON - LAN PTZ Kamera Boshqaruv Serveri
color 0B

echo =====================================================================
echo    🛡️  QALQON AMR v1.0 — LAN PTZ KAMERA BOG'LASH VA ISHGA TUSHIRISH
echo =====================================================================
echo.

set "ROOT_DIR=%~dp0"
set "CAM_DIR=%ROOT_DIR%camera_server"

if not exist "%CAM_DIR%\main.py" (
    echo [XATOLIK] camera_server papkasi topilmadi!
    echo Iltimos, ushbu bat faylni loyiha asosiy papkasidan ishga tushiring.
    pause
    exit /b 1
)

echo [1/3] LAN porti va tarmoq sozlamalari tekshirilmoqda...
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetIPAddress -IPAddress 192.168.1.10 -ErrorAction SilentlyContinue) { Write-Host '  ✓ Noutbuk LAN IP: 192.168.1.10 sozlagan' -ForegroundColor Green } else { Write-Host '  ! DIQQAT: Noutbuk LAN porti 192.168.1.10 ga sozlanmagan.' -ForegroundColor Yellow; Write-Host '    (Agar kamera togridan-togri LAN kabel bilan ulangan bolsa, IPv4 ni 192.168.1.10 qiling)' -ForegroundColor Gray }"

echo.
echo [2/3] Kamera uchun DHCP va PTZ video servisi (Port 8090) ishga tushmoqda...
echo   - Kamera manzili:  http://192.168.1.100
echo   - Video oqimi:     http://localhost:8090/camera/
echo   - Holat tekshirish: http://localhost:8090/camera/status
echo.
echo Server to'xtatish uchun: [Ctrl + C] bosing.
echo =====================================================================
echo.

:: 3 soniyadan so'ng brauzerda kamera sahifasini avtomatik ochish
start "" cmd /c "timeout /t 4 >nul && start http://localhost:8090/camera/"

:: Kamera serverini ishga tushirish
cd /d "%CAM_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%CAM_DIR%\start.ps1"

pause
