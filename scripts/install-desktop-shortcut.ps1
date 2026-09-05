$ErrorActionPreference = 'Stop'
$browserCandidates = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$studioBrowser = $browserCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $studioBrowser) { throw 'Install Chrome or Edge to create the Creative Studio desktop window.' }
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath 'Creative Studio.lnk'
$shortcutShell = New-Object -ComObject WScript.Shell
$studioShortcut = $shortcutShell.CreateShortcut($shortcutPath)
$studioShortcut.TargetPath = $studioBrowser
$studioShortcut.Arguments = '--app=http://127.0.0.1:8787/'
$studioShortcut.WorkingDirectory = Split-Path -Parent $studioBrowser
$studioShortcut.Description = 'Creative Studio — your private PC creative workstation'
$studioShortcut.Save()
if (-not (Test-Path -LiteralPath $shortcutPath)) { throw 'The desktop shortcut was not created.' }
Write-Output "Creative Studio desktop shortcut installed: $shortcutPath"
