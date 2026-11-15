@echo off
chcp 65001 >nul
title QALQON - Noutbuk LAN Portini Sozlash (192.168.1.10)
color 0E

echo =====================================================================
echo    🛡️  LAN KABEL UCHUN NOUTBUK TARMOQ KARTASINI AVTO-SOZLASH
echo =====================================================================
echo.
echo Ushbu fayl noutbukingizning Ethernet (LAN) portiga 
echo IP: 192.168.1.10 va Mask: 255.255.255.0 ni avtomatik o'rnatadi.
echo (Bu V380 / PTZ kamerani routerlarsiz to'g'ridan-to'g'ri ulash uchun shart)
echo.

:: Admin huquqini tekshirish
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [OGOHLANTIRISH] Ushbu faylni "Administrator nomidan ishga tushirish" kerak!
    echo Iltimos, fayl ustiga sichqonchaning o'ng tugmasini bosib:
    echo "Запуск от имени администратора" (Run as administrator) ni tanlang.
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$adapter = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -notmatch 'Wi-Fi|Wireless|Virtual|Bluetooth' } | Select-Object -First 1;" ^
  "if (-not $adapter) { $adapter = Get-NetAdapter | Where-Object { $_.InterfaceDescription -notmatch 'Wi-Fi|Wireless|Virtual|Bluetooth' } | Select-Object -First 1 };" ^
  "if ($adapter) {" ^
  "  Write-Host ('Tanlangan LAN adapter: ' + $adapter.Name + ' (' + $adapter.InterfaceDescription + ')') -ForegroundColor Cyan;" ^
  "  New-NetIPAddress -InterfaceAlias $adapter.Name -IPAddress 192.168.1.10 -PrefixLength 24 -SkipAsSource $false -ErrorAction SilentlyContinue;" ^
  "  Set-NetIPAddress -InterfaceAlias $adapter.Name -IPAddress 192.168.1.10 -PrefixLength 24 -ErrorAction SilentlyContinue;" ^
  "  Write-Host '✓ LAN port muvaffaqiyatli 192.168.1.10 ga sozlandi!' -ForegroundColor Green;" ^
  "} else {" ^
  "  Write-Host '! Ethernet (LAN) kabel ulagichi topilmadi. LAN kabelni ulang.' -ForegroundColor Red;" ^
  "}"

echo.
echo Sozlash yakunlandi. Endi START_PTZ_KAMERA.bat ni ishga tushirishingiz mumkin.
pause
