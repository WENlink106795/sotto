param(
  [string]$Pfx = "F:\[DSH]\Sotto\build\signing\sotto-selfsigned.pfx",
  [string]$PasswordFile = "F:\[DSH]\Sotto\build\signing\password.txt",
  [string]$Timestamp = "http://timestamp.digicert.com"
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$release = Join-Path $root 'release'
$signtool = 'C:\Users\10679\AppData\Local\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\windows-10\x64\signtool.exe'
if (-not (Test-Path -LiteralPath $signtool)) {
  $signtool = (Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign') -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
}
if (-not $signtool) { throw 'signtool.exe not found (Windows SDK or electron-builder cache)' }
if (-not (Test-Path -LiteralPath $Pfx)) { throw "PFX not found: $Pfx" }
$password = if ($env:CSC_KEY_PASSWORD) { $env:CSC_KEY_PASSWORD } elseif (Test-Path -LiteralPath $PasswordFile) { (Get-Content -LiteralPath $PasswordFile -Raw).Trim() } else { throw 'No signing password' }
$files = Get-ChildItem -LiteralPath $release -Filter '*.exe' -File
if ($files.Count -eq 0) { throw 'No exe files in release/' }
foreach ($file in $files) {
  Write-Host "Signing $($file.Name)"
  & $signtool sign /fd SHA256 /f $Pfx /p $password /tr $Timestamp /td SHA256 /v $file.FullName
  if ($LASTEXITCODE -ne 0) { throw "Signing failed: $($file.Name)" }
  $sig = Get-AuthenticodeSignature -LiteralPath $file.FullName
  Write-Host "  status: $($sig.Status) - $($sig.StatusMessage)"
}
$hashLines = foreach ($file in $files) { $h = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash; "$h  $($file.Name)" }
Set-Content -LiteralPath (Join-Path $release 'SHA256SUMS.txt') -Value $hashLines -Encoding utf8
Write-Host 'Signed and refreshed SHA256SUMS.txt'
