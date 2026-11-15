@echo off
chcp 65001 >nul
title QALQON - LAN PTZ Kamera Serveri
color 0B

echo =====================================================================
echo    🛡️  QALQON AMR v1.0 — LAN PTZ KAMERA BOG'LASH VA ISHGA TUSHIRISH
echo =====================================================================
echo.

set "ROOT_DIR=%~dp0"
set "CAM_DIR=%ROOT_DIR%camera_server"

:: 1. Admin huquqini tekshirish (LAN IP sozlash uchun)
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ESLATMA] To'liq avtomatik LAN sozlash uchun faylni
    echo "Запуск от имени администратора" orqali ochish tavsiya etiladi.
    echo.
)

echo [1/3] Noutbuk Ethernet (LAN) porti tekshirilmoqda...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ip = Get-NetIPAddress -IPAddress 192.168.1.10 -ErrorAction SilentlyContinue;" ^
  "if ($ip) {" ^
  "  Write-Host '  ✓ Noutbuk LAN IP: 192.168.1.10 faol' -ForegroundColor Green;" ^
  "} else {" ^
  "  Write-Host '  ! Noutbuk LAN porti 192.168.1.10 ga sozlanmoqda...' -ForegroundColor Yellow;" ^
  "  $ad = Get-NetAdapter | Where-Object { $_.InterfaceDescription -notmatch 'Wi-Fi|Wireless|Virtual|Bluetooth' } | Select-Object -First 1;" ^
  "  if ($ad) {" ^
  "    New-NetIPAddress -InterfaceAlias $ad.Name -IPAddress 192.168.1.10 -PrefixLength 24 -SkipAsSource $false -ErrorAction SilentlyContinue | Out-Null;" ^
  "    Set-NetIPAddress -InterfaceAlias $ad.Name -IPAddress 192.168.1.10 -PrefixLength 24 -ErrorAction SilentlyContinue | Out-Null;" ^
  "    Write-Host ('  ✓ ' + $ad.Name + ' porti 192.168.1.10 ga sozlandi') -ForegroundColor Green;" ^
  "  } else {" ^
  "    Write-Host '  ! Diqqat: Ethernet (LAN) kabeli ulanmagan yoki adapter topilmadi' -ForegroundColor Red;" ^
  "  }" ^
  "}"

echo.
echo [2/3] Kameraga 192.168.1.100 beruvchi DHCP server va RTSP/ONVIF ishga tushmoqda...
echo   - Kamera kutilayotgan IP: http://192.168.1.100:554
echo   - Web HUD oynasi:        http://localhost:8090/camera/
echo.
echo   [MUHIM ESLATMALAR]:
echo   1. Kameraning 12V quvvat bloki ulangan va chiroqlari yongan bo'lsin.
echo   2. LAN kabel noutbukning Ethernet teshigiga mahkam qadalgan bo'lsin.
echo   3. V380 Pro ilovasida (Настройки -> Дополнительно -> Настройки ONVIF) yoqilgan bo'lsin.
echo =====================================================================
echo.

:: 3 soniyadan so'ng brauzerni ochish
start "" cmd /c "timeout /t 5 >nul && start http://localhost:8090/camera/"

:: Kamera serverini ishga tushirish
cd /d "%CAM_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%CAM_DIR%\start.ps1"

pause
