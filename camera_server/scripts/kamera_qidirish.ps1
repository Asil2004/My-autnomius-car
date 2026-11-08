# Kamerani LAN kabelidan keladigan paketlar orqali topish (Administrator sifatida ishga tushiring)
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$etl = Join-Path $dir "kamera.etl"
$txt = Join-Path $dir "kamera.txt"
pktmon stop 2>$null | Out-Null
pktmon filter remove | Out-Null
Write-Host "60 soniya tinglanmoqda... Shu vaqt ichida kamerani o'chirib-yoqing (quvvatini uzib ulang)." -ForegroundColor Yellow
pktmon start --capture --comp nics --pkt-size 0 -f $etl | Out-Null
Start-Sleep -Seconds 60
pktmon stop | Out-Null
pktmon etl2txt $etl -o $txt | Out-Null
Write-Host "Tayyor: $txt" -ForegroundColor Green
Read-Host "Yopish uchun Enter bosing"
