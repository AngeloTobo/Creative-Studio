param(
  [string]$ConfigPath = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction Stop).Source
& $node (Join-Path $PSScriptRoot "check-node-sqlite.mjs")
if ($LASTEXITCODE -ne 0) { throw "Creative Studio PC Host requires Node.js 24 or newer with node:sqlite backup support." }
if (-not $ConfigPath) { $ConfigPath = Join-Path $env:LOCALAPPDATA "Creative Studio Host\config.json" }
$env:CS_HOST_CONFIG = $ConfigPath
Set-Location -LiteralPath $repoRoot
& $node (Join-Path $PSScriptRoot "start-pc-host.mjs")
exit $LASTEXITCODE
