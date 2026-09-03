param(
  [string]$ApiBase = "https://runner.cs.angelotoborg.com",
  [string]$ComfyUrl = "http://127.0.0.1:8188",
  [string]$RunnerToken = "",
  [string]$OvernightRecoveryTime = "21:45"
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
try { $overnightStart = [datetime]::ParseExact($OvernightRecoveryTime, "HH:mm", [Globalization.CultureInfo]::InvariantCulture) }
catch { throw "OvernightRecoveryTime must use 24-hour HH:mm format, such as 21:45." }

$configDirectory = Join-Path $env:LOCALAPPDATA "Creative Studio Runner"
$configPath = Join-Path $configDirectory "config.json"
New-Item -ItemType Directory -Force -Path $configDirectory | Out-Null
$configJson = @{
  apiBase = $ApiBase
  token = $RunnerToken
  comfyUrl = $ComfyUrl
  pollIntervalMs = 60000
} | ConvertTo-Json
[IO.File]::WriteAllText($configPath, $configJson, (New-Object Text.UTF8Encoding($false)))

$currentUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $configPath "/inheritance:r" "/grant:r" "*${currentUserSid}:(F)" "*S-1-5-18:(F)" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not secure the Creative Studio runner config." }

$startScript = Join-Path $PSScriptRoot "start-local-runner.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`" -ConfigPath `"$configPath`""
$triggers = @(
  (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME),
  (New-ScheduledTaskTrigger -Daily -At $overnightStart)
)
$settings = New-ScheduledTaskSettingsSet -RestartCount 12 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew -StartWhenAvailable -WakeToRun
Register-ScheduledTask -TaskName "Creative Studio Local Runner" -Action $action -Trigger $triggers -Settings $settings -Description "Runs authenticated Creative Studio ComfyUI jobs, CreativeDNA evidence synthesis, and bounded overnight sessions without an open browser." -Force | Out-Null
Start-ScheduledTask -TaskName "Creative Studio Local Runner"
Write-Host "Creative Studio Local Runner installed and started."
Write-Host "Config: $configPath"
Write-Host "Recovery trigger: $OvernightRecoveryTime daily (the machine and ComfyUI must be available for rendering)."
