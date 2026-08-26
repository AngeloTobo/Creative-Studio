[CmdletBinding()]
param(
  [string]$InstallRoot = "D:\AI\ACE-Step-1.5",
  [string]$Ref = "14c0211d5a0653b0f63e27686f4c3f151b4d8629",
  [switch]$SkipModels
)

$ErrorActionPreference = "Stop"
$officialRemote = "https://github.com/ace-step/ACE-Step-1.5.git"
$resolvedParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $InstallRoot))
$resolvedRoot = [System.IO.Path]::GetFullPath($InstallRoot)
if ($resolvedRoot -eq [System.IO.Path]::GetPathRoot($resolvedRoot)) {
  throw "Refusing to install into a drive root."
}

$git = (Get-Command git.exe -ErrorAction Stop).Source
$uvCandidate = (Get-Command uv.exe -ErrorAction SilentlyContinue).Source
if (-not $uvCandidate) {
  $uvCandidate = Join-Path $env:USERPROFILE ".local\bin\uv.exe"
}
if (-not (Test-Path -LiteralPath $uvCandidate -PathType Leaf)) {
  throw "uv is required. Install uv, then run this script again."
}

New-Item -ItemType Directory -Path $resolvedParent -Force | Out-Null
if (-not (Test-Path -LiteralPath $resolvedRoot)) {
  & $git clone --filter=blob:none $officialRemote $resolvedRoot
  if ($LASTEXITCODE -ne 0) { throw "ACE-Step clone failed." }
} else {
  $remote = (& $git -C $resolvedRoot remote get-url origin).Trim()
  if ($LASTEXITCODE -ne 0 -or $remote -ne $officialRemote) {
    throw "The target exists but is not the official ACE-Step checkout: $resolvedRoot"
  }
  $dirty = & $git -C $resolvedRoot status --porcelain
  if ($dirty) { throw "The ACE-Step checkout has local changes. Preserve them before updating." }
  & $git -C $resolvedRoot fetch origin $Ref --depth 1
  if ($LASTEXITCODE -ne 0) { throw "ACE-Step fetch failed." }
}

& $git -C $resolvedRoot checkout --detach $Ref
if ($LASTEXITCODE -ne 0) { throw "ACE-Step ref checkout failed." }

Push-Location $resolvedRoot
try {
  & $uvCandidate sync --python 3.11
  if ($LASTEXITCODE -ne 0) { throw "ACE-Step Python environment installation failed." }
  if (-not $SkipModels) {
    & $uvCandidate run acestep-download
    if ($LASTEXITCODE -ne 0) { throw "ACE-Step shared checkpoint download failed." }
    & $uvCandidate run acestep-download --model acestep-v15-base
    if ($LASTEXITCODE -ne 0) { throw "ACE-Step 1.5 Base checkpoint download failed." }
  }
} finally {
  Pop-Location
}

$python = Join-Path $resolvedRoot ".venv\Scripts\python.exe"
$baseWeights = Join-Path $resolvedRoot "checkpoints\acestep-v15-base"
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw "ACE-Step Python environment is incomplete." }
if (-not $SkipModels -and -not (Test-Path -LiteralPath $baseWeights -PathType Container)) { throw "ACE-Step Base checkpoint is incomplete." }

[Environment]::SetEnvironmentVariable("CS_ACESTEP_HOME", $resolvedRoot, "User")
[Environment]::SetEnvironmentVariable("CS_ACESTEP_PYTHON", $python, "User")
[Environment]::SetEnvironmentVariable("CS_ACESTEP_CHECKPOINTS", (Join-Path $resolvedRoot "checkpoints"), "User")
$comfyLoraRoot = Join-Path $env:USERPROFILE "ComfyUI-Shared\models\loras"
New-Item -ItemType Directory -Path $comfyLoraRoot -Force | Out-Null
[Environment]::SetEnvironmentVariable("CS_COMFY_LORA_DIR", $comfyLoraRoot, "User")

Write-Host "ACE-Step training runtime installed at $resolvedRoot"
if ($SkipModels) {
  Write-Host "Models were skipped; the Local Runner will continue to report setup required."
} else {
  Write-Host "Restart the Creative Studio Local Runner so it advertises ace-step-1.5-lora."
}
