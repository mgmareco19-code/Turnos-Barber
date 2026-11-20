# Arma ..\turnos-web.zip con lo que se publica en el bucket de Oracle Cloud.
# No incluye el superadmin (usalo desde tu Live Server), ni los scripts de Oracle ni el README.
# Uso: clic derecho -> "Ejecutar con PowerShell", o en una terminal:  powershell -File armar-zip.ps1
$ErrorActionPreference = "Stop"
$src = $PSScriptRoot
$tmp = Join-Path $env:TEMP "turnos-web"
$zip = Join-Path (Split-Path $src -Parent) "turnos-web.zip"
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Force (Join-Path $tmp "js") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $tmp "css") | Out-Null
"index.html", "admin.html", "ventas.html", "terminos.html", "privacidad.html" | ForEach-Object { Copy-Item (Join-Path $src $_) $tmp }
Copy-Item (Join-Path $src "css\*") (Join-Path $tmp "css")
Get-ChildItem (Join-Path $src "js") -Filter *.js | Where-Object { $_.Name -ne "superadmin.js" } | ForEach-Object { Copy-Item $_.FullName (Join-Path $tmp "js") }
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path (Join-Path $tmp "*") -DestinationPath $zip
Write-Host "Listo: $zip"
Get-ChildItem -Recurse $tmp -File | ForEach-Object { Write-Host ("  " + $_.FullName.Substring($tmp.Length + 1)) }
