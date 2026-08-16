param(
  [string]$ApiBase = "https://runner.cs.angelotoborg.com",
  [string]$ComfyUrl = "http://127.0.0.1:8188",
  [string]$RunnerToken = ""
)

$ErrorActionPreference = "Stop"
if (-not $RunnerToken) {
  $secureToken = Read-Host "Paste the one-time token from Creative Studio Settings" -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  try { $RunnerToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
if ($RunnerToken -notmatch '^csr_[A-Za-z0-9_-]{40,80}$') { throw "The Creative Studio runner token is invalid." }
if ($ComfyUrl -notmatch '^http://(127\.0\.0\.1|localhost)(:\d+)?$') { throw "ComfyUI must use a localhost URL." }

$configDirectory = Join-Path $env:LOCALAPPDATA "Creative Studio Runner"
$configPath = Join-Path $configDirectory "config.json"
New-Item -ItemType Directory -Force -Path $configDirectory | Out-Null
$configJson = @{
  apiBase = $ApiBase
  token = $RunnerToken
  comfyUrl = $ComfyUrl
  pollIntervalMs = 5000
} | ConvertTo-Json
[IO.File]::WriteAllText($configPath, $configJson, (New-Object Text.UTF8Encoding($false)))

$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
$userRule = New-Object System.Security.AccessControl.FileSystemAccessRule($env:USERNAME, "FullControl", "Allow")
$systemRule = New-Object System.Security.AccessControl.FileSystemAccessRule("SYSTEM", "FullControl", "Allow")
$acl.AddAccessRule($userRule)
$acl.AddAccessRule($systemRule)
Set-Acl -LiteralPath $configPath -AclObject $acl

$startScript = Join-Path $PSScriptRoot "start-local-runner.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`" -ConfigPath `"$configPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Creative Studio Local Runner" -Action $action -Trigger $trigger -Settings $settings -Description "Runs authenticated Creative Studio ComfyUI jobs and CreativeDNA evidence synthesis without an open browser." -Force | Out-Null
Start-ScheduledTask -TaskName "Creative Studio Local Runner"
Write-Host "Creative Studio Local Runner installed and started."
Write-Host "Config: $configPath"
