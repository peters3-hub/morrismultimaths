# MMM - Morris Multi Maths - certificate generator (Windows)
#
#   Right-click this file > Run with PowerShell
#   or:  powershell -ExecutionPolicy Bypass -File make-cert.ps1
#   or:  powershell -ExecutionPolicy Bypass -File make-cert.ps1 -ExtraIPs 10.0.1.42
#
# Creates certs\ca.crt (the file IT installs on student devices) and the
# server's own certificate signed by it.

param([string[]]$ExtraIPs = @())

$ErrorActionPreference = "Stop"
$root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$certs  = Join-Path $root "certs"
New-Item -ItemType Directory -Force -Path $certs | Out-Null

# --- names this server will be reached by -----------------------------------
$hostShort = $env:COMPUTERNAME
$ips = @(Get-NetIPAddress -AddressFamily IPv4 |
         Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
         Select-Object -ExpandProperty IPAddress)
$ips += $ExtraIPs
$names = @("localhost", $hostShort, "$hostShort.local", "127.0.0.1") + $ips | Select-Object -Unique

Write-Host "Certificate will cover:" -ForegroundColor Cyan
$names | ForEach-Object { Write-Host "  $_" }
Write-Host ""

# --- the school authority (created once) ------------------------------------
$caPath = Join-Path $certs "ca.pfx"
if (Test-Path $caPath) {
  Write-Host "Reusing the existing school certificate authority."
  $ca = Get-PfxCertificate -FilePath $caPath
  $ca = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Thumbprint -eq $ca.Thumbprint } | Select-Object -First 1
  if (-not $ca) { Remove-Item $caPath -Force; }
}
if (-not $ca) {
  Write-Host "Creating the school certificate authority..."
  $ca = New-SelfSignedCertificate `
        -Subject "CN=Morris Multi Maths School Authority, O=Morris Multi Maths" `
        -KeyUsage CertSign, CRLSign, DigitalSignature `
        -KeyLength 4096 -KeyAlgorithm RSA -HashAlgorithm SHA256 `
        -NotAfter (Get-Date).AddYears(10) `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -TextExtension @("2.5.29.19={text}CA=true&pathlength=0")
  Export-PfxCertificate -Cert $ca -FilePath $caPath `
        -Password (ConvertTo-SecureString -String "mmm" -AsPlainText -Force) | Out-Null
}
Export-Certificate -Cert $ca -FilePath (Join-Path $certs "ca.crt") -Type CERT | Out-Null

# --- the server certificate --------------------------------------------------
Write-Host "Creating the server certificate..."
$leaf = New-SelfSignedCertificate `
        -Subject "CN=Morris Multi Maths, O=$hostShort" `
        -DnsName $names `
        -Signer $ca `
        -KeyLength 2048 -KeyAlgorithm RSA -HashAlgorithm SHA256 `
        -NotAfter (Get-Date).AddDays(825) `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.1")

# Node needs PEM files, so export the pair and convert.
$pfx = Join-Path $certs "server.pfx"
$pw  = ConvertTo-SecureString -String "mmm" -AsPlainText -Force
Export-PfxCertificate -Cert $leaf -FilePath $pfx -Password $pw | Out-Null

$openssl = Get-Command openssl -ErrorAction SilentlyContinue
if ($openssl) {
  & openssl pkcs12 -in $pfx -nocerts -nodes -passin pass:mmm -out (Join-Path $certs "server.key") 2>$null
  & openssl pkcs12 -in $pfx -clcerts -nokeys -passin pass:mmm -out (Join-Path $certs "server.crt") 2>$null
  Remove-Item $pfx -Force
  Write-Host ""
  Write-Host "Done. Files are in: $certs" -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "Certificate created, but OpenSSL was not found, so it could not be" -ForegroundColor Yellow
  Write-Host "converted to the .key/.crt files Node needs." -ForegroundColor Yellow
  Write-Host "Install Git for Windows (which includes openssl) and run this again," -ForegroundColor Yellow
  Write-Host "or convert $pfx yourself with:" -ForegroundColor Yellow
  Write-Host "  openssl pkcs12 -in server.pfx -nocerts -nodes -passin pass:mmm -out server.key"
  Write-Host "  openssl pkcs12 -in server.pfx -clcerts -nokeys -passin pass:mmm -out server.crt"
  exit 1
}

Write-Host ""
Write-Host "  ca.crt      -> give this ONE file to your IT team. They install it as a"
Write-Host "                 trusted root certificate on student devices. After that,"
Write-Host "                 students see no warnings at all."
Write-Host "  server.crt  -> used by the server. Nothing to do with it."
Write-Host "  server.key  -> the private key. Never share this file."
Write-Host ""
Write-Host "Next:  node server.js"
Write-Host "Then open the https:// address it prints."
Write-Host ""
Write-Host "If this laptop's IP changes, run this script again and restart the server."
Write-Host "Students do NOT need anything reinstalled - ca.crt stays valid."
