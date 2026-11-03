@echo off
chcp 65001 >nul
echo ==============================================================================
echo       QALQON ROBOT — LIDAR (STL-19P) SICHQONCHA SAKRASHINI TUZATISH
echo ==============================================================================
echo.
echo Sabab: Windows tizimi LiDAR'dan kelayotgan tezkor lazer ma'lumotlarini
echo        qadimgi "COM Port Sichqonchasi" (Serial Mouse) deb o'ylab xato qilmoqda.
echo.
echo Yechim: 'sermouse' xizmati o'chirilmoqda...
echo.

reg add "HKLM\SYSTEM\CurrentControlSet\Services\sermouse" /v Start /t REG_DWORD /d 4 /f

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [MUVOFAQIYATLI] 'sermouse' drayveri o'chirildi!
    echo Endi LiDAR ulanganda sichqoncha kursoriga mutlaqo xalaqit bermaydi.
    echo.
    echo Iltimos, kompyuterni bir marta RESTART qiling yoki LiDAR USB kabelini qayta ulang.
) else (
    echo.
    echo [DIQQAT] Administrator huquqi talab qilinadi!
    echo Iltimos, ushbu faylni sichqonchaning o'ng tugmasi bilan bosib:
    echo "Запуск от имени администратора" (Run as Administrator) qiling.
)

echo.
pause
