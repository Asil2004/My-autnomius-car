@echo off
chcp 65001 > nul
title QALQON - Jamoa Ishlarini Sinxronlash
echo =====================================================================
echo    🤖 QALQON v1.0: JAMOA ISHLARINI AVTOMATIK SINXRONLASH
echo =====================================================================
echo.
echo 1. GitHub'dan barcha yangi o'zgarishlar tortib olinmoqda...
git fetch --all --prune
git pull origin main

echo.
echo 2. Frontend ishlab chiqarish to'plami qayta yig'ilmoqda...
cd frontend
call npm.cmd run build
cd ..

echo.
echo 3. Ildiz katalogiga yangi assetlar nusxalanmoqda...
powershell -Command "Copy-Item -Path 'frontend\dist\*' -Destination '.' -Recurse -Force"

echo.
echo 4. 'gh-pages' tarmog'iga jonli uzatilmoqda...
git push origin main:gh-pages --force

echo.
echo =====================================================================
echo    ✅ BARCHA O'ZGARISHLAR VA GITHUB PAGES SINXRONLASHTIRILDI!
echo    🌐 Jonli sayt: https://asil2004.github.io/My-autnomius-car/
echo =====================================================================
pause
