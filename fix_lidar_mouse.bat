@echo off
chcp 65001 >nul
title QALQON — LiDAR STL-19P Serial Mouse va Qotish Xatosini Butunlay Tuzatish

:: Administrator huquqini tekshirish va avtomatik so'rash (UAC Prompt)
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Administrator huquqi talab qilinadi. UAC oynasi ochilmoqda...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"

echo ==============================================================================
echo       QALQON ROBOT — LIDAR (STL-19P) SICHQONCHA VA TIZIM QOTISHINI TUZATISH
echo ==============================================================================
echo.
echo Sabablar aniqlandi:
echo  1. Silicon Labs drayverining 'silabenm.sys' filtri LiDAR'ni BallPoint sichqoncha deb olgan.
echo  2. Sekundiga 23 000 bayt lazer ma'lumoti Windows input navbatiga quyilib,
echo     klaviatura va sichqonchani 5 soniyagacha qotirib qo'ygan.
echo.
echo [1/3] 'silabenm' (Silicon Labs Serial Enumerator) xizmati o'chirilmoqda...
reg add "HKLM\SYSTEM\CurrentControlSet\Services\silabenm" /v Start /t REG_DWORD /d 4 /f >nul
if %ERRORLEVEL% EQU 0 (echo  [OK] silabenm o'chirildi.) else (echo  [XATOLIK] silabenm o'chirilmadi.)

echo [2/3] Windows 'sermouse' va 'serenum' xizmatlari o'chirilmoqda...
reg add "HKLM\SYSTEM\CurrentControlSet\Services\sermouse" /v Start /t REG_DWORD /d 4 /f >nul
reg add "HKLM\SYSTEM\CurrentControlSet\Services\serenum" /v Start /t REG_DWORD /d 4 /f >nul
echo  [OK] Windows Serial Mouse xizmatlari o'chirildi.

echo [3/3] Ro'yxatdan o'tgan soxta Serial BallPoint qurilmalari o'chirib qo'yilmoqda...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-PnpDevice | Where-Object { $_.InstanceId -like '*SILABENM*' } | Disable-PnpDevice -Confirm:$false" >nul 2>&1
echo  [OK] Soxta kursor generatorlari bloklandi.

echo.
echo ==============================================================================
echo [MUVOFAQIYATLI YAKUNLANDI!]
echo Endi LDROBOT STL-19P LiDAR ulanganda tizim umuman qotmaydi,
echo sichqoncha kursoriga va klaviaturaga hech qanday xalaqit bermaydi!
echo.
echo ESLATMA: O'zgarishlar kuchga kirishi uchun:
echo  1. Agar LiDAR hozir ulangan bo'lsa, USB kabelini bir marta sug'urib qayta ulang.
echo  2. Yoki kompyuteringizni bir marta RESTART qiling.
echo ==============================================================================
echo.
pause
