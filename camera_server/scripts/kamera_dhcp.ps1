param([int]$Seconds = 180, [string]$CamMac = '00-55-7B-11-C6-15')
$udp = New-Object System.Net.Sockets.UdpClient
$udp.Client.SetSocketOption([System.Net.Sockets.SocketOptionLevel]::Socket, [System.Net.Sockets.SocketOptionName]::ReuseAddress, $true)
$udp.Client.Bind((New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Parse('192.168.1.10'), 67)))
$udp.EnableBroadcast = $true
$udp.Client.ReceiveTimeout = 2000
$end = (Get-Date).AddSeconds($Seconds)
$dst = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Parse('192.168.1.255'),68)
Write-Output "DHCP server listening on 192.168.1.10 for $CamMac"
while ((Get-Date) -lt $end) {
  try { $ep = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any,0); $req = $udp.Receive([ref]$ep) } catch { continue }
  if ($req.Length -lt 240 -or $req[0] -ne 1) { continue }
  $mac = ($req[28..33] | ForEach-Object { $_.ToString('X2') }) -join '-'
  if ($mac -ne $CamMac) { continue }
  $type = 0; $i = 240
  while ($i -lt $req.Length -and $req[$i] -ne 255) {
    if ($req[$i] -eq 0) { $i++; continue }
    if ($req[$i] -eq 53) { $type = $req[$i+2] }
    $i += 2 + $req[$i+1]
  }
  if ($type -eq 1) { $reply = 2; $name='DISCOVER->OFFER' } elseif ($type -eq 3) { $reply = 5; $name='REQUEST->ACK' } else { continue }
  $r = New-Object System.Collections.Generic.List[byte]
  $hdr = New-Object byte[] 240
  $hdr[0]=2; $hdr[1]=1; $hdr[2]=6
  [Array]::Copy($req,4,$hdr,4,4)
  $hdr[10]=0x80
  $hdr[16]=192;$hdr[17]=168;$hdr[18]=1;$hdr[19]=100
  $hdr[20]=192;$hdr[21]=168;$hdr[22]=1;$hdr[23]=10
  [Array]::Copy($req,28,$hdr,28,16)
  $hdr[236]=99;$hdr[237]=130;$hdr[238]=83;$hdr[239]=99
  $r.AddRange($hdr)
  $r.AddRange([byte[]](53,1,$reply))
  $r.AddRange([byte[]](54,4,192,168,1,10))
  $r.AddRange([byte[]](51,4,0,1,81,128))
  $r.AddRange([byte[]](1,4,255,255,255,0))
  $r.AddRange([byte[]](3,4,192,168,1,10))
  $r.AddRange([byte[]](6,4,192,168,1,10))
  $r.Add(255)
  while ($r.Count -lt 300) { $r.Add(0) }
  $b = $r.ToArray()
  [void]$udp.Send($b,$b.Length,$dst)
  Write-Output "$(Get-Date -f HH:mm:ss) $name $mac -> 192.168.1.100"
}
$udp.Close()
Write-Output "DHCP server stopped"
