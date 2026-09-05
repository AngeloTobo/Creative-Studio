param(
  [string]$ConfigPath = "",
  [string]$TaskName = "Creative Studio PC Host",
  [switch]$PathValidationSelfTest,
  [switch]$ProcessIdentitySelfTest,
  [switch]$NodeRuntimeSelfTest
)

$ErrorActionPreference = "Stop"

function Test-FullyQualifiedWindowsPath {
  param([string]$Candidate)

  if ([String]::IsNullOrWhiteSpace($Candidate)) { return $false }
  $normalized = $Candidate.Replace([char]47, [char]92)
  if ($normalized -match '(^|\\)\.\.(\\|$)') { return $false }
  if ($normalized.StartsWith('\\?\', [StringComparison]::Ordinal) -or $normalized.StartsWith('\\.\', [StringComparison]::Ordinal)) {
    return $false
  }

  try {
    # GetFullPath performs the .NET Framework validation available in Windows
    # PowerShell 5.1; IsPathRooted alone would accept C:relative and \relative.
    [void][IO.Path]::GetFullPath($normalized)
    $root = [IO.Path]::GetPathRoot($normalized)
    if ([String]::IsNullOrWhiteSpace($root)) { return $false }
    $root = $root.Replace([char]47, [char]92)
    if ($root -match '^[A-Za-z]:\\$') {
      return $normalized -match '^[A-Za-z]:\\'
    }
    if ($root -match '^\\\\[^\\]+\\[^\\]+\\?$') {
      return $normalized -match '^\\\\[^\\]+\\[^\\]+'
    }
  } catch {
    return $false
  }

  return $false
}

function ConvertTo-CanonicalWindowsPath {
  param([string]$Candidate)

  if (-not (Test-FullyQualifiedWindowsPath -Candidate $Candidate)) {
    throw "Path must use a fully qualified Windows drive or UNC root without traversal."
  }
  $fullPath = [IO.Path]::GetFullPath($Candidate).Replace([char]47, [char]92)
  $pathRoot = [IO.Path]::GetPathRoot($fullPath).Replace([char]47, [char]92)
  if ($fullPath.Length -gt $pathRoot.Length) {
    $fullPath = $fullPath.TrimEnd([char]92)
  }
  return $fullPath
}

function Test-PathInsideRoot {
  param(
    [string]$Root,
    [string]$Candidate
  )

  try {
    $canonicalRoot = ConvertTo-CanonicalWindowsPath -Candidate $Root
    $canonicalCandidate = ConvertTo-CanonicalWindowsPath -Candidate $Candidate
  } catch {
    return $false
  }

  if ([String]::Equals($canonicalCandidate, $canonicalRoot, [StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }
  $rootPrefix = if ($canonicalRoot.EndsWith('\', [StringComparison]::Ordinal)) {
    $canonicalRoot
  } else {
    $canonicalRoot + '\'
  }
  return $canonicalCandidate.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)
}

function Test-SameProcessIdentity {
  param(
    $Snapshot,
    $Current
  )

  if ($null -eq $Snapshot -or $null -eq $Current) { return $false }
  return (
    [String]::Equals([string]$Current.CreationDate, [string]$Snapshot.CreationDate, [StringComparison]::Ordinal) -and
    [String]::Equals([string]$Current.Name, [string]$Snapshot.Name, [StringComparison]::OrdinalIgnoreCase) -and
    [String]::Equals([string]$Current.ExecutablePath, [string]$Snapshot.ExecutablePath, [StringComparison]::OrdinalIgnoreCase)
  )
}

function Test-NodeSqliteRuntime {
  $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
  & $nodePath (Join-Path $PSScriptRoot "check-node-sqlite.mjs")
  if ($LASTEXITCODE -ne 0) {
    throw "Creative Studio PC Host requires Node.js 24 or newer with node:sqlite backup support."
  }
  return $nodePath
}

if ($PathValidationSelfTest) {
  $assertions = @(
    @{ Name = "drive child"; Root = 'C:\root'; Candidate = 'C:\root\child'; Expected = $true },
    @{ Name = "sibling"; Root = 'C:\root'; Candidate = 'C:\sibling'; Expected = $false },
    @{ Name = "prefix collision"; Root = 'C:\root'; Candidate = 'C:\rooted\child'; Expected = $false },
    @{ Name = "drive relative"; Root = 'C:\root'; Candidate = 'C:relative'; Expected = $false },
    @{ Name = "root relative"; Root = 'C:\root'; Candidate = '\root-relative'; Expected = $false },
    @{ Name = "traversal escape"; Root = 'C:\root'; Candidate = 'C:\root\child\..\..\escape'; Expected = $false },
    @{ Name = "UNC child"; Root = '\\server\share\root'; Candidate = '\\server\share\root\child'; Expected = $true },
    @{ Name = "UNC prefix collision"; Root = '\\server\share\root'; Candidate = '\\server\share\rooted\child'; Expected = $false }
  )
  foreach ($assertion in $assertions) {
    $actual = Test-PathInsideRoot -Root $assertion.Root -Candidate $assertion.Candidate
    if ($actual -ne $assertion.Expected) {
      throw "Path validation assertion failed: $($assertion.Name)."
    }
  }
  Write-Host "PC host installer path validation assertions passed."
  return
}

if ($ProcessIdentitySelfTest) {
  $original = [pscustomobject]@{
    CreationDate = '20260903090000.000000-300'
    Name = 'node.exe'
    ExecutablePath = 'C:\Program Files\nodejs\node.exe'
  }
  $same = [pscustomobject]@{
    CreationDate = '20260903090000.000000-300'
    Name = 'NODE.EXE'
    ExecutablePath = 'c:\program files\nodejs\NODE.exe'
  }
  $reused = [pscustomobject]@{
    CreationDate = '20260903090001.000000-300'
    Name = 'node.exe'
    ExecutablePath = 'C:\Program Files\nodejs\node.exe'
  }
  if (-not (Test-SameProcessIdentity -Snapshot $original -Current $same)) {
    throw "Process identity assertion failed for the same process."
  }
  if (Test-SameProcessIdentity -Snapshot $original -Current $reused) {
    throw "Process identity assertion failed for a reused PID."
  }
  Write-Host "PC host installer process identity assertions passed."
  return
}

if ($NodeRuntimeSelfTest) {
  [void](Test-NodeSqliteRuntime)
  Write-Host "PC host Node.js SQLite runtime assertion passed."
  return
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$hostRoot = Join-Path $env:LOCALAPPDATA "Creative Studio Host"
$expectedTaskName = "Creative Studio PC Host"
if (-not [String]::Equals($TaskName, $expectedTaskName, [StringComparison]::Ordinal)) {
  throw "The PC host Scheduled Task name is fixed at $expectedTaskName."
}
$expectedConfigPath = Join-Path $hostRoot "config.json"
if (-not $ConfigPath) { $ConfigPath = $expectedConfigPath }
$ConfigPath = [IO.Path]::GetFullPath($ConfigPath)
if (-not [String]::Equals($ConfigPath, [IO.Path]::GetFullPath($expectedConfigPath), [StringComparison]::OrdinalIgnoreCase)) {
  throw "The PC host configuration must remain pinned to $expectedConfigPath."
}
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw "Run npm run host:migrate before installing the PC host." }
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "dist\index.html") -PathType Leaf)) { throw "Run npm run build:host before installing the PC host." }

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
function Test-PathInsideHostRoot {
  param([string]$Candidate)
  return Test-PathInsideRoot -Root $hostRoot -Candidate $Candidate
}
$configIssues = @(
  $config.schemaVersion -ne "creative-studio-pc-host/1.0"
  ([string]$config.ownerId) -notmatch '^user_[a-z0-9-]{20,100}$'
  ([string]$config.internalToken) -notmatch '^[A-Za-z0-9_-]{40,100}$'
  ([string]$config.sessionSecret) -notmatch '^[A-Za-z0-9_-]{40,100}$'
  ([Uri]::CheckHostName([string]$config.publicHostname)) -ne [UriHostNameType]::Dns
  ([string]$config.accessEmail).Length -gt 320
  ([string]$config.accessEmail) -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$'
  -not [String]::IsNullOrWhiteSpace([string]$config.testHostname)
  -not (Test-FullyQualifiedWindowsPath -Candidate ([string]$config.archiveRoot))
  -not (Test-PathInsideHostRoot -Candidate ([string]$config.stateRoot))
  -not (Test-PathInsideHostRoot -Candidate ([string]$config.runnerConfigPath))
  -not (Test-PathInsideHostRoot -Candidate ([string]$config.migrationReceipt))
  -not (Test-Path -LiteralPath $config.stateRoot -PathType Container)
  -not (Test-Path -LiteralPath $config.archiveRoot -PathType Container)
  -not (Test-Path -LiteralPath $config.runnerConfigPath -PathType Leaf)
  -not (Test-Path -LiteralPath $config.migrationReceipt -PathType Leaf)
)
if ($configIssues -contains $true) {
  throw "The protected PC host configuration is incomplete or invalid."
}
$receipt = Get-Content -LiteralPath $config.migrationReceipt -Raw | ConvertFrom-Json
$receiptIssues = @(
  $receipt.schemaVersion -ne "creative-studio-cloud-to-pc-migration/2.0"
  -not [String]::Equals([IO.Path]::GetFullPath([string]$receipt.destination.stateRoot), [IO.Path]::GetFullPath([string]$config.stateRoot), [StringComparison]::OrdinalIgnoreCase)
  ([string]$receipt.destination.runnerId) -notmatch '^runner_pc_[a-f0-9]{32}$'
  $receipt.source.ownerId -ne $config.ownerId
  ([int]$receipt.r2.objects) -ne 233
  ([long]$receipt.r2.bytes) -ne 315823973
  $receipt.preservation.cloudWritesPerformed -ne $false
  $receipt.preservation.cloudDataDeleted -ne $false
)
if ($receiptIssues -contains $true) {
  throw "The protected PC migration receipt does not authorize this host state."
}

# This must run before a healthy installed host or legacy Runner is stopped. The
# entrypoint imports node:sqlite's online-backup API before it can acquire/log.
[void](Test-NodeSqliteRuntime)

$legacyTaskName = "Creative Studio Local Runner"
$legacyTask = Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
$legacyWasEnabled = [bool]($legacyTask -and $legacyTask.Settings.Enabled)
$legacyWasRunning = [bool]($legacyTask -and $legacyTask.State -eq "Running")
$legacyRollbackXml = if ($legacyTask) { Export-ScheduledTask -TaskName $legacyTaskName } else { $null }

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$existingWasEnabled = [bool]($existingTask -and $existingTask.Settings.Enabled)
$existingWasRunning = [bool]($existingTask -and $existingTask.State -eq "Running")
$existingTaskXml = if ($existingTask) { Export-ScheduledTask -TaskName $TaskName } else { $null }
if (-not $existingTask -and $receipt.writerFreeze.initialState.exists) {
  $preservedLegacyXmlPath = [string]$receipt.writerFreeze.preservedTaskXml
  if (-not (Test-PathInsideHostRoot -Candidate $preservedLegacyXmlPath) -or -not (Test-Path -LiteralPath $preservedLegacyXmlPath -PathType Leaf)) {
    throw "The preserved legacy Runner task definition is missing; first-install rollback cannot be guaranteed."
  }
  $legacyRollbackXml = Get-Content -LiteralPath $preservedLegacyXmlPath -Raw
  $legacyWasEnabled = [bool]$receipt.writerFreeze.initialState.enabled
  $legacyWasRunning = [bool]$receipt.writerFreeze.initialState.running
}
if ($existingTaskXml) {
  [IO.File]::WriteAllText((Join-Path $hostRoot "pc-host-task-before-install.xml"), $existingTaskXml, (New-Object Text.UTF8Encoding($false)))
}
if ($legacyTask) {
  [IO.File]::WriteAllText((Join-Path $hostRoot "legacy-runner-task-before-install.xml"), $legacyRollbackXml, (New-Object Text.UTF8Encoding($false)))
}

function Wait-ForProcessExit {
  param([string]$CommandPattern, [int]$TimeoutSeconds = 30)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $running = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
      $_.CommandLine -and $_.CommandLine -like $CommandPattern
    })
    if ($running.Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "A managed Creative Studio process did not stop cleanly."
}

function Stop-ExactLegacyRunnerProcesses {
  $expectedScript = [IO.Path]::GetFullPath((Join-Path $repoRoot "runner\index.mjs")).Replace([char]47, [char]92).ToLowerInvariant()
  $runnerProcesses = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine -match 'runner[\\/]index\.mjs'
  })
  foreach ($runnerProcess in $runnerProcesses) {
    $normalizedCommand = ([string]$runnerProcess.CommandLine).Trim().Replace([char]47, [char]92).ToLowerInvariant()
    if (-not ($normalizedCommand.EndsWith('"' + $expectedScript + '"', [StringComparison]::Ordinal) -or
      $normalizedCommand.EndsWith($expectedScript, [StringComparison]::Ordinal))) {
      throw "A different runner/index.mjs process is active; refusing to stop a process this installer does not own."
    }
  }
  foreach ($runnerProcess in $runnerProcesses) {
    $processId = [int]$runnerProcess.ProcessId
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
    if ($null -eq $current) { continue }
    $currentCommand = ([string]$current.CommandLine).Trim().Replace([char]47, [char]92).ToLowerInvariant()
    if (-not ($currentCommand.EndsWith('"' + $expectedScript + '"', [StringComparison]::Ordinal) -or
      $currentCommand.EndsWith($expectedScript, [StringComparison]::Ordinal))) {
      throw "The legacy Runner PID changed ownership before termination."
    }
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
    } catch {
      if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { throw }
      # The Runner can finish between the ownership recheck and termination.
    }
  }
  Wait-ForProcessExit -CommandPattern "*Creative Studio*runner\index.mjs*"
}

function Stop-ExactPcHostProcessTree {
  $entryScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "start-pc-host.mjs"))
  $hosts = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.IndexOf($entryScript, [StringComparison]::OrdinalIgnoreCase) -ge 0
  })
  if ($hosts.Count -eq 0) { return }
  if ($hosts.Count -ne 1) { throw "More than one Creative Studio PC Host process is active; refusing automatic termination." }

  $lockPath = Join-Path $hostRoot "host-instance.lock"
  if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
    throw "The PC host process has no ownership lock; refusing automatic termination."
  }
  $lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
  $hostProcess = $hosts[0]
  if ([int]$lock.pid -ne [int]$hostProcess.ProcessId -or
    -not [String]::Equals((ConvertTo-CanonicalWindowsPath -Candidate ([string]$lock.repoRoot)), (ConvertTo-CanonicalWindowsPath -Candidate $repoRoot), [StringComparison]::OrdinalIgnoreCase) -or
    -not [String]::Equals((ConvertTo-CanonicalWindowsPath -Candidate ([string]$lock.configPath)), (ConvertTo-CanonicalWindowsPath -Candidate $ConfigPath), [StringComparison]::OrdinalIgnoreCase)) {
    throw "The PC host ownership lock does not authorize automatic termination."
  }

  $snapshot = @(Get-CimInstance Win32_Process)
  $owned = @{ ([string]$hostProcess.ProcessId) = $true }
  $depth = @{ ([string]$hostProcess.ProcessId) = 0 }
  do {
    $added = $false
    foreach ($candidate in $snapshot) {
      $candidateKey = [string]$candidate.ProcessId
      $parentKey = [string]$candidate.ParentProcessId
      if (-not $owned.ContainsKey($candidateKey) -and $owned.ContainsKey($parentKey)) {
        $owned[$candidateKey] = $true
        $depth[$candidateKey] = [int]$depth[$parentKey] + 1
        $added = $true
      }
    }
  } while ($added)

  # Stop the owned root before its children so it cannot react to a child exit
  # by starting a replacement while the verified process tree is being drained.
  $ownedProcesses = @($snapshot | Where-Object { $owned.ContainsKey([string]$_.ProcessId) } |
    Sort-Object @{ Expression = { $depth[[string]$_.ProcessId] }; Descending = $false })
  foreach ($ownedProcess in $ownedProcesses) {
    $processId = [int]$ownedProcess.ProcessId
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
    if ($null -eq $current) { continue }
    if (-not (Test-SameProcessIdentity -Snapshot $ownedProcess -Current $current)) {
      # The original child already exited and Windows reused its PID. Skipping the
      # replacement preserves the ownership boundary without turning a normal
      # shutdown race into a failed supported update.
      continue
    }
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
    } catch {
      if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { throw }
      # A child can exit naturally after its parent/worker is stopped.
    }
  }
  Wait-ForProcessExit -CommandPattern "*Creative Studio*scripts\start-pc-host.mjs*"
}

function Test-HostOwnership {
  try {
    $lockPath = Join-Path $hostRoot "host-instance.lock"
    $readyPath = Join-Path $hostRoot "host-ready.json"
    if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) { return $false }
    if (-not (Test-Path -LiteralPath $readyPath -PathType Leaf)) { return $false }
    $lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
    $ready = Get-Content -LiteralPath $readyPath -Raw | ConvertFrom-Json
    $processId = [int]$lock.pid
    if ($processId -le 0) { return $false }
    if ([int]$ready.pid -ne $processId) { return $false }
    if (-not [String]::Equals((ConvertTo-CanonicalWindowsPath -Candidate ([string]$lock.repoRoot)), (ConvertTo-CanonicalWindowsPath -Candidate $repoRoot), [StringComparison]::OrdinalIgnoreCase)) { return $false }
    if (-not [String]::Equals((ConvertTo-CanonicalWindowsPath -Candidate ([string]$lock.configPath)), (ConvertTo-CanonicalWindowsPath -Candidate $ConfigPath), [StringComparison]::OrdinalIgnoreCase)) { return $false }
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction Stop
    $entryScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "start-pc-host.mjs"))
    if (-not $owner.CommandLine -or $owner.CommandLine.IndexOf($entryScript, [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
    $installedTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    return $installedTask.State -eq "Running"
  } catch {
    return $false
  }
}

$startScript = Join-Path $PSScriptRoot "start-pc-host.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`" -ConfigPath `"$ConfigPath`"" -WorkingDirectory $repoRoot
$taskUserId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$triggers = @((New-ScheduledTaskTrigger -AtLogOn -User $taskUserId))
$settings = New-ScheduledTaskSettingsSet -RestartCount 12 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $taskUserId -LogonType Interactive -RunLevel Limited

try {
  if ($existingTask -and $existingTask.State -eq "Running") {
    Stop-ScheduledTask -TaskName $TaskName
    Stop-ExactPcHostProcessTree
  }
  if ($legacyTask) {
    if ($legacyTask.State -eq "Running") { Stop-ScheduledTask -TaskName $legacyTaskName }
    Disable-ScheduledTask -TaskName $legacyTaskName | Out-Null
    Stop-ExactLegacyRunnerProcesses
  }

  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description "Hosts Creative Studio, its local authoritative data, Art Index connector, and the single local Runner. Cloudflare is only the Access-protected tunnel." -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName

  $ready = $false
  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  do {
    try {
      $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
      $probeHeaders = @{ "Accept-Encoding" = "identity" }
      $root = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8787/" -WebSession $session -Headers $probeHeaders -TimeoutSec 5
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/creative-studio/host-health" -WebSession $session -Headers $probeHeaders -TimeoutSec 5
      if ($root.StatusCode -eq 200 -and $health.ok -and $health.authority -eq "this-pc" -and (Test-HostOwnership)) { $ready = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  if (-not $ready) { throw "The PC host did not become healthy after installation." }
} catch {
  $installError = $_
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  try { Stop-ExactPcHostProcessTree }
  catch { Write-Warning "The failed PC host process did not stop cleanly before rollback." }
  if ($existingTaskXml) {
    Register-ScheduledTask -TaskName $TaskName -Xml $existingTaskXml -Force | Out-Null
    if ($existingWasEnabled) { Enable-ScheduledTask -TaskName $TaskName | Out-Null }
    else { Disable-ScheduledTask -TaskName $TaskName | Out-Null }
    if ($existingWasRunning) { Start-ScheduledTask -TaskName $TaskName }
  } else {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  }
  if ($legacyRollbackXml) {
    Register-ScheduledTask -TaskName $legacyTaskName -Xml $legacyRollbackXml -Force | Out-Null
    if ($legacyWasEnabled) { Enable-ScheduledTask -TaskName $legacyTaskName | Out-Null }
    else { Disable-ScheduledTask -TaskName $legacyTaskName | Out-Null }
    if ($legacyWasRunning) { Start-ScheduledTask -TaskName $legacyTaskName }
    elseif ((Get-ScheduledTask -TaskName $legacyTaskName).State -eq "Running") { Stop-ScheduledTask -TaskName $legacyTaskName }
  }
  throw $installError
}

Write-Host "Creative Studio PC Host installed and healthy at http://127.0.0.1:8787."
Write-Host "The legacy cloud-polling Runner task is preserved but disabled for rollback."
Write-Host "Task: $TaskName"
Write-Host "Config: $ConfigPath"
