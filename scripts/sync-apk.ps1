# QALQON: web versiya va APK ni parallel yangilash.
#   1) frontend/dist build (web)
#   2) Capacitor sync -> frontend/android
#   3) Gradle assembleDebug -> app-debug.apk
#   4) Planshetga o'rnatish (adb), ruxsatlar, ishga tushirish
#
# Ishlatish (repo ildizidan):
#   powershell -ExecutionPolicy Bypass -File scripts\sync-apk.ps1            # build + o'rnatish
#   powershell -ExecutionPolicy Bypass -File scripts\sync-apk.ps1 -NoInstall # faqat build
param(
  [switch]$NoInstall,
  [string]$Adb = "$env:LOCALAPPDATA\Android\platform-tools\adb.exe",
  [string]$JavaHome = "$env:LOCALAPPDATA\Programs\jdk-17\jdk17.0.20_12"
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root 'frontend'
$android = Join-Path $frontend 'android'
$apk = Join-Path $android 'app\build\outputs\apk\debug\app-debug.apk'
$pkg = 'uz.iiv.qalqon'

function Step($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function BundleHash($html) {
  $m = Select-String -Path $html -Pattern 'index-[\w-]+\.js' | Select-Object -First 1
  if ($m) { $m.Matches[0].Value } else { '(topilmadi)' }
}

Step '1/4 Web build (frontend/dist)'
Push-Location $frontend
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Web build xato' }

  Step '2/4 Capacitor sync'
  npx cap sync android
  if ($LASTEXITCODE -ne 0) { throw 'cap sync xato' }
} finally { Pop-Location }

$webHash = BundleHash (Join-Path $frontend 'dist\index.html')
$apkHash = BundleHash (Join-Path $android 'app\src\main\assets\public\index.html')
Write-Host "Web build: $webHash"
Write-Host "APK ichida: $apkHash"
if ($webHash -ne $apkHash) { throw 'APK ichidagi build web build bilan bir xil emas' }

Step '3/4 APK build (gradle assembleDebug)'
if (Test-Path $JavaHome) { $env:JAVA_HOME = $JavaHome }
Push-Location $android
try {
  # --no-daemon: fonda qoladigan Gradle daemon chaqiruvchining chiqish oqimini ochiq ushlab, skriptni "osiltirmasin"
  .\gradlew.bat assembleDebug --console=plain --no-daemon
  if ($LASTEXITCODE -ne 0) { throw 'Gradle build xato' }
} finally { Pop-Location }
Write-Host "APK: $apk ($([math]::Round((Get-Item $apk).Length / 1MB, 1)) MB)"

if ($NoInstall) { Write-Host "`nO'rnatish o'tkazib yuborildi (-NoInstall)."; exit 0 }

Step "4/4 Planshetga o'rnatish"
if (-not (Test-Path $Adb)) { throw "adb topilmadi: $Adb" }
$ErrorActionPreference = 'Continue'
# adb serverini alohida (handle meros qilmaydigan) jarayonda ishga tushiramiz: aks holda fonda qoladigan adb
# server skript chiqishini ochiq ushlab, chaqiruvchi tugashini kutib qolardi
Start-Process -FilePath $Adb -ArgumentList 'start-server' -WindowStyle Hidden -Wait
$devices = & $Adb devices | Select-String -Pattern '\tdevice$'
if (-not $devices) { throw "Planshet ulanmagan yoki USB debugging ruxsati berilmagan (adb devices)" }

# cmd orqali: adb stderr ga yozadigan "Performing Streamed Install" PowerShell 5.1 da xato deb to'xtatmasin
$out = cmd /c "`"$Adb`" install -r -g `"$apk`" 2>&1" | Out-String
Write-Host $out.Trim()
if ($out -notmatch 'Success') {
  # MIUI: ekrandagi tasdiq bosilmasa USB o'rnatish bekor qilinadi. Faylni planshetga qo'yamiz
  & $Adb push $apk /sdcard/Download/Qalqon.apk | Out-Null
  Write-Host "`nMIUI o'rnatishni rad etdi. Planshetda: Fayllar -> Download -> Qalqon.apk -> O'rnatish." -ForegroundColor Yellow
  Write-Host "O'rnatgach skriptni qayta ishga tushiring (yoki ekrandagi 'O'rnatish' ni bosishga tayyor turing)."
  exit 2
}

# adb ba'zi xabarlarni stderr ga yozadi: PowerShell 5.1 ularni xato deb to'xtamasligi uchun
$ErrorActionPreference = 'Continue'
foreach ($p in 'CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION') {
  & $Adb shell pm grant $pkg "android.permission.$p" | Out-Null
}
# MIUI: ilovani old planga chiqarishga ruxsat
& $Adb shell appops set $pkg 10021 allow | Out-Null
& $Adb shell appops set $pkg 10020 allow | Out-Null
& $Adb shell am force-stop $pkg | Out-Null
& $Adb shell "monkey -p $pkg -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1"

Write-Host "`nTayyor: web va APK bir xil build ($webHash). Planshetda Qalqon ishga tushirildi." -ForegroundColor Green
