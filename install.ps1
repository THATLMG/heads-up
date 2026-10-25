# Installs Heads Up for this Windows user: copies the app to Documents\Heads Up, adds Desktop and
# Start menu shortcuts, and opens it. Accounts live in %APPDATA%\Heads Up and are never touched.
param(
  [string]$Dest = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) "Heads Up"),
  [switch]$NoShortcuts,
  [switch]$NoLaunch
)
$ErrorActionPreference = "Stop"
$src = Join-Path $PSScriptRoot "app"

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node -and (Test-Path "C:\Program Files\nodejs\node.exe")) { $node = "C:\Program Files\nodejs\node.exe" }
if (-not $node) {
  Write-Host ""
  Write-Host "Heads Up needs Node.js, which is free. Opening its download page now."
  Write-Host "Install the LTS version, then double-click 'Install Heads Up' again."
  Start-Process "https://nodejs.org/en/download"
  Read-Host "Press Enter to close"
  exit 1
}

New-Item -ItemType Directory -Force $Dest | Out-Null
Copy-Item (Join-Path $src "*") $Dest -Force
Get-ChildItem $Dest | Unblock-File   # downloaded files are marked "from the internet"; this stops the warning

if (-not $NoShortcuts) {
  $sh = New-Object -ComObject WScript.Shell
  foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
    $lnk = $sh.CreateShortcut((Join-Path $dir "Heads Up.lnk"))
    $lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
    $lnk.Arguments = '"' + (Join-Path $Dest "Heads Up.vbs") + '"'
    $lnk.WorkingDirectory = $Dest
    $lnk.IconLocation = (Join-Path $Dest "heads-up.ico") + ",0"
    $lnk.Description = "Heads Up: your news, weather and CS2 updates"
    $lnk.Save()
  }
}

Write-Host ""
Write-Host "Heads Up is installed in $Dest"
if (-not $NoShortcuts) { Write-Host "Open it any time from the Heads Up icon on your Desktop or in the Start menu." }
if (-not $NoLaunch) {
  Start-Process "$env:WINDIR\System32\wscript.exe" -ArgumentList ('"' + (Join-Path $Dest "Heads Up.vbs") + '"')
  Start-Sleep -Seconds 2
}
