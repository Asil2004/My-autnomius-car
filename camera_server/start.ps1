# QALQON kamera serverini ishga tushirish (Windows, noutbuk)
#  1) Kamera noutbukka LAN kabel bilan to'g'ridan-to'g'ri ulangan bo'lsa: DHCP yordamchisi kameraga 192.168.1.100 beradi
#  2) Python virtual muhit (.venv) va kutubxonalar (birinchi marta)
#  3) Server: http://localhost:8090/camera  (HUD shu manzildan video oladi va PTZ ni boshqaradi)
param([int]$Port = 8090, [switch]$NoDhcp)

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

if (-not $NoDhcp) {
  if (Get-NetIPAddress -IPAddress 192.168.1.10 -ErrorAction SilentlyContinue) {
    Write-Host "Kamera uchun DHCP yordamchisi ishga tushdi (192.168.1.100)" -ForegroundColor Cyan
    $dhcp = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList "-ExecutionPolicy Bypass -File `"$dir\scripts\kamera_dhcp.ps1`" -Seconds 86400"
  } else {
    Write-Host "LAN portida 192.168.1.10 yo'q: kamera routerga ulangan deb hisoblanadi (DHCP yordamchisi kerak emas)" -ForegroundColor Yellow
  }
}

if (-not (Test-Path "$dir\.venv\Scripts\python.exe")) {
  Write-Host "Python muhiti yaratilmoqda..." -ForegroundColor Cyan
  # Python ni topish: PATH dagi python, py launcher yoki uv o'rnatgan Python
  $py = $null
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -notmatch 'WindowsApps') { $py = $cmd.Source }
  if (-not $py -and (Get-Command py -ErrorAction SilentlyContinue)) { $py = (& py -3 -c "import sys; print(sys.executable)") }
  if (-not $py) {
    $uvPy = Get-ChildItem "$env:APPDATA\uv\python" -Recurse -Filter python.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match 'cpython-3\.1[0-9]' } | Sort-Object FullName -Descending | Select-Object -First 1
    if ($uvPy) { $py = $uvPy.FullName }
  }
  if (-not $py) { Write-Host "Python 3.10+ topilmadi. https://www.python.org dan o'rnating." -ForegroundColor Red; exit 1 }
  & $py -m venv .venv
  & "$dir\.venv\Scripts\python.exe" -m pip install -r requirements.txt
}
if (-not (Test-Path "$dir\.env")) { Copy-Item "$dir\.env.example" "$dir\.env" }

Write-Host "Kamera serveri: http://localhost:$Port/camera  (to'xtatish: Ctrl+C)" -ForegroundColor Green
try {
  & "$dir\.venv\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port $Port
} finally {
  if ($dhcp) { Stop-Process -Id $dhcp.Id -Force -ErrorAction SilentlyContinue }
}
