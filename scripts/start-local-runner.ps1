param(
  [string]$ConfigPath = "$env:LOCALAPPDATA\Creative Studio Runner\config.json"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $repoRoot "runner\index.mjs"
if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Runner config not found: $ConfigPath" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is required for Creative Studio Local Runner." }
$env:CS_RUNNER_CONFIG = $ConfigPath
& node $runner
exit $LASTEXITCODE
