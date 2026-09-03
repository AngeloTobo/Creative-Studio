param(
  [Parameter(Mandatory = $true)]
  [string]$PlanPath,
  [string]$ArchiveRoot = "",
  [string]$ReceiptId = "",
  [switch]$Resume
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object Text.UTF8Encoding($false)

function Get-NormalizedFullPath([string]$Path) {
  $fullPath = [IO.Path]::GetFullPath($Path)
  $pathRoot = [IO.Path]::GetPathRoot($fullPath)
  if ($fullPath.Length -gt $pathRoot.Length) { return $fullPath.TrimEnd('\') }
  return $fullPath
}

function Test-PathAtOrInside([string]$Root, [string]$Candidate) {
  if ($Candidate.Equals($Root, [StringComparison]::OrdinalIgnoreCase)) { return $true }
  return $Candidate.StartsWith(($Root.TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)
}

function Test-PathInside([string]$Root, [string]$Candidate) {
  return (-not $Candidate.Equals($Root, [StringComparison]::OrdinalIgnoreCase)) -and
    $Candidate.StartsWith(($Root.TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)
}

function Assert-NoReparsePath([string]$Root, [string]$Target, [bool]$IncludeTarget) {
  $normalizedRoot = Get-NormalizedFullPath $Root
  $normalizedTarget = Get-NormalizedFullPath $Target
  if (-not (Test-PathAtOrInside $normalizedRoot $normalizedTarget)) { throw "protected_path_outside_archive" }
  $volumeRoot = [IO.Path]::GetPathRoot($normalizedTarget)
  $volumeItem = Get-Item -LiteralPath $volumeRoot -Force
  if (($volumeItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "destination_reparse_point" }
  $relative = $normalizedTarget.Substring($volumeRoot.Length).TrimStart('\')
  $segments = @($relative.Split('\'))
  $lastIndex = if ($IncludeTarget) { $segments.Count - 1 } else { $segments.Count - 2 }
  $current = $volumeRoot
  for ($index = 0; $index -le $lastIndex; $index += 1) {
    $current = Join-Path $current $segments[$index]
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "destination_reparse_point" }
    }
  }
}

function Ensure-SafeDirectory([string]$Root, [string]$Directory) {
  $normalizedRoot = Get-NormalizedFullPath $Root
  $normalizedDirectory = Get-NormalizedFullPath $Directory
  if (-not (Test-PathAtOrInside $normalizedRoot $normalizedDirectory)) { throw "destination_directory_outside_archive" }
  Assert-NoReparsePath $normalizedRoot $normalizedDirectory $true
  if ($normalizedDirectory.Equals($normalizedRoot, [StringComparison]::OrdinalIgnoreCase)) { return }

  $relative = $normalizedDirectory.Substring($normalizedRoot.Length).TrimStart('\')
  $current = $normalizedRoot
  foreach ($segment in $relative.Split('\')) {
    $current = Join-Path $current $segment
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (-not $item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
        throw "destination_ancestor_not_regular_directory"
      }
    } else {
      $parent = Split-Path -Parent $current
      Assert-NoReparsePath $normalizedRoot $parent $true
      [void][IO.Directory]::CreateDirectory($current)
      $created = Get-Item -LiteralPath $current -Force
      if (-not $created.PSIsContainer -or (($created.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
        throw "destination_directory_create_failed"
      }
    }
  }
}

function Enter-ArchiveLock([string]$Root) {
  $recordsDirectory = Join-Path $Root "00_Archive_Records"
  Ensure-SafeDirectory $Root $recordsDirectory
  $lockPath = Join-Path $recordsDirectory ".art-index-increment.lock"
  Assert-NoReparsePath $Root $lockPath $true
  try {
    return [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  } catch {
    throw "Another Art Index plan or ingest owns the archive-wide incremental lock."
  }
}

function Get-RowText([object]$Row, [string]$Name) {
  $property = $Row.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value) { return "" }
  return ([string]$property.Value).Trim()
}

function Get-UtcDate([string]$Value, [string]$ErrorCode) {
  try {
    return [datetime]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
  } catch { throw $ErrorCode }
}

function Get-MetadataId([string]$SourcePath, [long]$Size, [datetime]$ModifiedUtc) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $payload = "{0}`n{1}`n{2}" -f $SourcePath.ToLowerInvariant(), $Size, $ModifiedUtc.ToString("o")
    $hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($payload))
    return "INC-{0}" -f ([BitConverter]::ToString($hash).Replace('-', '').Substring(0, 20))
  } finally { $sha.Dispose() }
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Write-DurableNewText([string]$Path, [string]$Content) {
  $bytes = $utf8NoBom.GetBytes($Content)
  $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    if ($bytes.Length) { $stream.Write($bytes, 0, $bytes.Length) }
    $stream.Flush($true)
  } finally { $stream.Dispose() }
}

function Convert-ToCsvText([object[]]$Rows) {
  $lines = @($Rows | ConvertTo-Csv -NoTypeInformation)
  if (-not $lines.Count) { return "" }
  return ($lines -join "`r`n") + "`r`n"
}

function Write-NewTextAtomically([string]$Content, [string]$Path, [string]$Root) {
  Assert-NoReparsePath $Root $Path $true
  if (Test-Path -LiteralPath $Path) { throw "immutable_receipt_file_exists" }
  $temporaryPath = "$Path.partial-$PID-$([Guid]::NewGuid().ToString('N'))"
  Assert-NoReparsePath $Root $temporaryPath $true
  try {
    Write-DurableNewText $temporaryPath $Content
    Assert-NoReparsePath $Root $Path $true
    if (Test-Path -LiteralPath $Path) { throw "immutable_receipt_file_appeared" }
    [IO.File]::Move($temporaryPath, $Path)
  } finally {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) { Remove-Item -LiteralPath $temporaryPath -Force }
  }
}

function Write-TextAtomically([string]$Content, [string]$Path, [string]$Root) {
  Assert-NoReparsePath $Root $Path $true
  $temporaryPath = "$Path.partial-$PID-$([Guid]::NewGuid().ToString('N'))"
  Assert-NoReparsePath $Root $temporaryPath $true
  Write-DurableNewText $temporaryPath $Content
  $backupPath = "$Path.previous"
  try {
    for ($attempt = 1; $attempt -le 5; $attempt += 1) {
      try {
        Assert-NoReparsePath $Root $Path $true
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
          Assert-NoReparsePath $Root $backupPath $true
          if (Test-Path -LiteralPath $backupPath) {
            $backup = Get-Item -LiteralPath $backupPath -Force
            if ($backup.PSIsContainer -or (($backup.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
              throw "atomic_backup_not_regular_file"
            }
            Remove-Item -LiteralPath $backupPath -Force
          }
          [IO.File]::Replace($temporaryPath, $Path, $backupPath, $true)
          if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
            try { Remove-Item -LiteralPath $backupPath -Force } catch { }
          }
        } elseif (Test-Path -LiteralPath $Path) {
          throw "atomic_target_not_regular_file"
        } else {
          [IO.File]::Move($temporaryPath, $Path)
        }
        return
      } catch {
        if ($attempt -eq 5) { throw }
        Start-Sleep -Milliseconds (50 * $attempt)
      }
    }
  } finally {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) { Remove-Item -LiteralPath $temporaryPath -Force }
  }
}

function Write-StateAtomically([object[]]$Rows, [string]$Path, [string]$Root) {
  Write-TextAtomically (Convert-ToCsvText $Rows) $Path $Root
}

function Write-NewCsv([object[]]$Rows, [string]$Path, [string]$Root) {
  Write-NewTextAtomically (Convert-ToCsvText $Rows) $Path $Root
}

function Write-NewOrValidateCsv([object[]]$Rows, [string]$Path, [string]$Root) {
  $expectedContent = Convert-ToCsvText $Rows
  Assert-NoReparsePath $Root $Path $true
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    if ([IO.File]::ReadAllText($Path) -cne $expectedContent) { throw "existing_verified_files_disagrees_with_state" }
    return
  }
  if (Test-Path -LiteralPath $Path) { throw "verified_files_path_not_regular_file" }
  Write-NewTextAtomically $expectedContent $Path $Root
}

function Add-MigrationLog([string]$Path, [object]$Row, [string]$Root) {
  Assert-NoReparsePath $Root $Path $true
  $line = @($Row | ConvertTo-Csv -NoTypeInformation | Select-Object -Skip 1)
  [IO.File]::AppendAllText($Path, (($line -join "`r`n") + "`r`n"), $utf8NoBom)
}

function Get-RelativeDestination([string]$Value) {
  $relative = $Value.Trim().Replace('/', '\')
  if (-not $relative -or [IO.Path]::IsPathRooted($relative) -or $relative.StartsWith('\')) {
    throw "relative_destination_not_relative"
  }
  $segments = @($relative.Split('\'))
  if ($segments.Count -lt 2 -or -not $segments[0].Equals("07_Inbox", [StringComparison]::OrdinalIgnoreCase)) {
    throw "relative_destination_outside_inbox"
  }
  foreach ($segment in $segments) {
    if (-not $segment -or $segment -ne $segment.Trim() -or $segment.EndsWith('.') -or
      $segment -eq "." -or $segment -eq ".." -or $segment.IndexOf(':') -ge 0) {
      throw "relative_destination_unsafe_segment"
    }
    if ($segment.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) {
      throw "relative_destination_invalid_segment"
    }
  }
  return ($segments -join '\')
}

function Resolve-Destination([string]$Root, [string]$RelativeDestination, [string]$StoredDestination) {
  $relative = Get-RelativeDestination $RelativeDestination
  $destination = Get-NormalizedFullPath (Join-Path $Root $relative)
  if (-not (Test-PathInside $Root $destination)) { throw "destination_outside_archive" }
  if ($StoredDestination) {
    if (-not [IO.Path]::IsPathRooted($StoredDestination)) { throw "stored_destination_not_absolute" }
    $stored = Get-NormalizedFullPath $StoredDestination
    if (-not $stored.Equals($destination, [StringComparison]::OrdinalIgnoreCase)) {
      throw "stored_destination_disagrees_with_relative_destination"
    }
  }
  Assert-NoReparsePath $Root $destination $true
  return [pscustomobject]@{ Relative = $relative; Path = $destination }
}

function Get-RegularFile([string]$Path, [string]$ErrorCode) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw $ErrorCode }
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw $ErrorCode }
  return $item
}

function Assert-FileSnapshot([IO.FileInfo]$Item, [long]$ExpectedSize, [datetime]$ExpectedModifiedUtc, [string]$ErrorCode) {
  if ($Item.Length -ne $ExpectedSize -or $Item.LastWriteTimeUtc.Ticks -ne $ExpectedModifiedUtc.Ticks) { throw $ErrorCode }
}

function Get-ValidatedFinalizedReceipt([string]$ReceiptDirectory, [string]$Root) {
  Assert-NoReparsePath $Root $ReceiptDirectory $true
  $receiptPath = Join-Path $ReceiptDirectory "receipt.json"
  $candidatePath = Join-Path $ReceiptDirectory "candidate_manifest.csv"
  $verifiedPath = Join-Path $ReceiptDirectory "verified_files.csv"
  $statePath = Join-Path $ReceiptDirectory "state.csv"
  $migrationPath = Join-Path $ReceiptDirectory "migration_log.csv"
  $exceptionsPath = Join-Path $ReceiptDirectory "exceptions.csv"
  foreach ($requiredPath in @($receiptPath, $candidatePath, $verifiedPath, $statePath, $migrationPath, $exceptionsPath)) {
    Assert-NoReparsePath $Root $requiredPath $true
    [void](Get-RegularFile $requiredPath "finalized_receipt_file_missing")
  }
  if ((Get-Item -LiteralPath $migrationPath -Force).Length -eq 0 -or
    (Get-Item -LiteralPath $exceptionsPath -Force).Length -ne 0) {
    throw "finalized_receipt_ledgers_invalid"
  }
  $expectedMigrationHeader = '"OccurredAtUTC","ActionID","Event","ExpectedSizeBytes","DestinationSizeBytes","Detail"'
  if ((Get-Content -LiteralPath $migrationPath -TotalCount 1) -cne $expectedMigrationHeader) {
    throw "finalized_migration_log_header_invalid"
  }
  $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  $schema = [string]$receipt.schemaVersion
  if ($schema -ne "angelo-art-index-incremental-receipt/1.0" -and
    $schema -ne "angelo-art-index-incremental-receipt/1.1") { throw "unsupported_incremental_receipt_schema" }
  if ([string]$receipt.receiptId -ne (Split-Path -Leaf $ReceiptDirectory)) { throw "receipt_id_directory_mismatch" }
  if ((Get-Sha256 $candidatePath) -ne ([string]$receipt.candidateManifestSha256).ToUpperInvariant()) {
    throw "candidate_manifest_hash_mismatch"
  }
  if ($schema -eq "angelo-art-index-incremental-receipt/1.1") {
    if ((Get-Sha256 $verifiedPath) -ne ([string]$receipt.verifiedFilesSha256).ToUpperInvariant()) {
      throw "verified_files_hash_mismatch"
    }
    foreach ($hashFile in @(
      @($statePath, "stateSha256"),
      @($migrationPath, "migrationLogSha256"),
      @($exceptionsPath, "exceptionsSha256")
    )) {
      $path = $hashFile[0]
      Assert-NoReparsePath $Root $path $true
      [void](Get-RegularFile $path "finalized_receipt_ledger_missing")
      $expectedHash = [string]$receipt.($hashFile[1])
      if ((Get-Sha256 $path) -ne $expectedHash.ToUpperInvariant()) { throw "finalized_receipt_ledger_hash_mismatch" }
    }
  }

  $candidates = @(Import-Csv -LiteralPath $candidatePath)
  $verifiedRows = @(Import-Csv -LiteralPath $verifiedPath)
  $states = @(Import-Csv -LiteralPath $statePath)
  if ([long]$receipt.failed -ne 0 -or $candidates.Count -ne [long]$receipt.planned -or
    $verifiedRows.Count -ne [long]$receipt.verified -or $verifiedRows.Count -ne $candidates.Count -or
    $states.Count -ne $candidates.Count) {
    throw "finalized_receipt_count_mismatch"
  }
  $candidateByAction = @{}
  $expectedBytes = 0L
  for ($index = 0; $index -lt $candidates.Count; $index += 1) {
    $candidate = $candidates[$index]
    $actionId = Get-RowText $candidate "ActionID"
    if (-not $actionId -or $candidateByAction.ContainsKey($actionId)) { throw "duplicate_finalized_action_id" }
    $resolved = Resolve-Destination $Root (Get-RowText $candidate "RelativeDestination") (Get-RowText $candidate "DestinationPath")
    $size = 0L
    if (-not [long]::TryParse((Get-RowText $candidate "ExpectedSizeBytes"), [ref]$size) -or $size -lt 0) {
      throw "invalid_finalized_expected_size"
    }
    [void](Get-UtcDate (Get-RowText $candidate "ExpectedModifiedUTC") "invalid_finalized_modified_time")
    $expectedBytes += $size
    $candidateByAction[$actionId] = $candidate
    $state = $states[$index]
    $verificationStatus = Get-RowText $state "VerificationStatus"
    if ((Get-RowText $state "ActionID") -ne $actionId -or (Get-RowText $state "Status") -ne "VERIFIED" -or
      (Get-RowText $state "SourcePreserved") -ne "YES" -or
      (Get-RowText $state "DestinationSizeBytes") -ne ([string]$size) -or
      ($verificationStatus -ne "SIZE_MATCH" -and $verificationStatus -ne "SIZE_AND_MODIFIED_UTC_MATCH")) {
      throw "finalized_state_row_mismatch"
    }
  }
  $verifiedBytes = 0L
  $verifiedActionIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($verified in $verifiedRows) {
    $actionId = Get-RowText $verified "ActionID"
    if (-not $verifiedActionIds.Add($actionId) -or -not $candidateByAction.ContainsKey($actionId) -or
      (Get-RowText $verified "Status") -ne "VERIFIED" -or (Get-RowText $verified "SourcePreserved") -ne "YES") {
      throw "unbacked_finalized_verified_row"
    }
    $candidate = $candidateByAction[$actionId]
    foreach ($field in @("RecordID", "SourcePath", "ExpectedSizeBytes", "ExpectedModifiedUTC", "RelativeDestination")) {
      if ((Get-RowText $verified $field) -ne (Get-RowText $candidate $field)) {
        throw "finalized_verified_row_mismatch"
      }
    }
    [void](Resolve-Destination $Root (Get-RowText $verified "RelativeDestination") (Get-RowText $verified "DestinationPath"))
    $destinationBytes = 0L
    if (-not [long]::TryParse((Get-RowText $verified "DestinationSizeBytes"), [ref]$destinationBytes) -or
      $destinationBytes -ne [long](Get-RowText $candidate "ExpectedSizeBytes")) {
      throw "invalid_finalized_destination_size"
    }
    $verifiedBytes += $destinationBytes
  }
  if ($expectedBytes -ne [long]$receipt.expectedBytes -or $verifiedBytes -ne [long]$receipt.verifiedBytes) {
    throw "finalized_receipt_byte_mismatch"
  }
  return [pscustomobject]@{ Receipt = $receipt; Candidates = $candidates; VerifiedRows = $verifiedRows }
}

function New-KnownIndex {
  return [pscustomobject]@{
    Sources = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    RecordIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    Destinations = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    IncompleteReceiptIds = [Collections.Generic.List[string]]::new()
  }
}

function Add-KnownRow([object]$Row, [object]$Known) {
  $sourcePath = Get-RowText $Row "SourcePath"
  if ($sourcePath) {
    try { $sourcePath = Get-NormalizedFullPath $sourcePath } catch { }
    [void]$Known.Sources.Add($sourcePath)
  }
  $recordId = Get-RowText $Row "RecordID"
  if ($recordId) { [void]$Known.RecordIds.Add($recordId) }
  $relative = Get-RowText $Row "RelativeDestination"
  if ($relative) {
    $relative = $relative.Replace('/', '\').TrimStart('\')
    [void]$Known.Destinations.Add($relative)
  }
}

function Get-KnownIndex([string]$Root, [string]$CurrentReceiptId) {
  $known = New-KnownIndex
  $baselinePath = Join-Path $Root "00_Archive_Records\completion_manifest.csv"
  Assert-NoReparsePath $Root $baselinePath $true
  [void](Get-RegularFile $baselinePath "baseline_completion_manifest_missing")
  foreach ($row in (Import-Csv -LiteralPath $baselinePath)) { Add-KnownRow $row $known }

  $incrementalRoot = Join-Path $Root "00_Archive_Records\Incremental"
  Ensure-SafeDirectory $Root $incrementalRoot
  foreach ($directory in (Get-ChildItem -LiteralPath $incrementalRoot -Directory -Force | Sort-Object Name)) {
    if (($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "incremental_receipt_reparse_point" }
    if ($directory.Name -eq $CurrentReceiptId) { continue }
    $finalMarker = Join-Path $directory.FullName "receipt.json"
    if (Test-Path -LiteralPath $finalMarker -PathType Leaf) {
      $validated = Get-ValidatedFinalizedReceipt $directory.FullName $Root
      foreach ($row in $validated.VerifiedRows) { Add-KnownRow $row $known }
    } elseif ($directory.Name -match '^CAI-') {
      $known.IncompleteReceiptIds.Add($directory.Name)
    }
  }
  return $known
}

function Assert-NotKnown([object]$Candidate, [object]$Known, [int]$Position) {
  $sourcePath = Get-NormalizedFullPath (Get-RowText $Candidate "SourcePath")
  $recordId = Get-RowText $Candidate "RecordID"
  if ($Known.Sources.Contains($sourcePath) -or ($recordId -and $Known.RecordIds.Contains($recordId))) {
    throw "Plan row $Position is already represented by the baseline or a finalized incremental receipt."
  }
}

function Assert-LiveCandidate([object]$Candidate, [string]$Root) {
  $expectedSize = [long](Get-RowText $Candidate "ExpectedSizeBytes")
  $expectedModifiedUtc = Get-UtcDate (Get-RowText $Candidate "ExpectedModifiedUTC") "invalid_expected_modified_time"
  $sourcePath = Get-NormalizedFullPath (Get-RowText $Candidate "SourcePath")
  $source = Get-RegularFile $sourcePath "source_original_missing_or_unsafe"
  Assert-FileSnapshot $source $expectedSize $expectedModifiedUtc "source_original_changed"
  $resolved = Resolve-Destination $Root (Get-RowText $Candidate "RelativeDestination") (Get-RowText $Candidate "DestinationPath")
  $destination = Get-RegularFile $resolved.Path "verified_destination_missing_or_unsafe"
  Assert-FileSnapshot $destination $expectedSize $expectedModifiedUtc "verified_destination_changed"
}

function Remove-ExactPartial([string]$PartialPath, [string]$Root) {
  if (-not (Test-Path -LiteralPath $PartialPath)) { return $false }
  if (-not (Test-PathInside $Root (Get-NormalizedFullPath $PartialPath))) { throw "partial_path_outside_archive" }
  Assert-NoReparsePath $Root $PartialPath $true
  $partial = Get-Item -LiteralPath $PartialPath -Force
  if ($partial.PSIsContainer -or (($partial.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
    throw "stale_partial_not_regular_file"
  }
  Remove-Item -LiteralPath $PartialPath -Force
  return $true
}

if (-not $ArchiveRoot) {
  if ($env:CS_ARCHIVE_ROOT) { $ArchiveRoot = $env:CS_ARCHIVE_ROOT }
  else { throw "ArchiveRoot is required when CS_ARCHIVE_ROOT is not configured." }
}
if (-not $ReceiptId) { $ReceiptId = "CAI-{0}" -f (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ") }
if (-not (Test-Path -LiteralPath $PlanPath -PathType Leaf)) { throw "Ingest plan not found: $PlanPath" }
if (-not [IO.Path]::IsPathRooted($ArchiveRoot)) { throw "ArchiveRoot must be an absolute path." }
if (-not (Test-Path -LiteralPath $ArchiveRoot -PathType Container)) { throw "ArchiveRoot does not exist: $ArchiveRoot" }
if ($ReceiptId -notmatch '^CAI-[0-9]{8}T[0-9]{6}Z(?:-[A-Za-z0-9_-]+)?$') { throw "ReceiptId is invalid." }

$resolvedArchiveRoot = Get-NormalizedFullPath (Resolve-Path -LiteralPath $ArchiveRoot).Path
$resolvedPlanPath = Get-NormalizedFullPath (Resolve-Path -LiteralPath $PlanPath).Path
Assert-NoReparsePath $resolvedArchiveRoot $resolvedArchiveRoot $true
$receiptDirectory = Join-Path $resolvedArchiveRoot "00_Archive_Records\Incremental\$ReceiptId"
$candidateManifestPath = Join-Path $receiptDirectory "candidate_manifest.csv"
$statePath = Join-Path $receiptDirectory "state.csv"
$migrationLogPath = Join-Path $receiptDirectory "migration_log.csv"
$verifiedPath = Join-Path $receiptDirectory "verified_files.csv"
$exceptionsPath = Join-Path $receiptDirectory "exceptions.csv"
$receiptPath = Join-Path $receiptDirectory "receipt.json"

$archiveLock = $null
try {
  $archiveLock = Enter-ArchiveLock $resolvedArchiveRoot
  $receiptExists = Test-Path -LiteralPath $receiptDirectory -PathType Container
  if ($receiptExists) {
    Assert-NoReparsePath $resolvedArchiveRoot $receiptDirectory $true
    if (-not $Resume) { throw "Receipt already exists; use -Resume after inspecting it: $receiptDirectory" }
    if (Test-Path -LiteralPath $receiptPath -PathType Leaf) {
      $finalized = Get-ValidatedFinalizedReceipt $receiptDirectory $resolvedArchiveRoot
      foreach ($candidate in $finalized.Candidates) { Assert-LiveCandidate $candidate $resolvedArchiveRoot }
      Write-Host "Validated completed incremental Art Index receipt without rewriting it: $ReceiptId"
      Write-Host "Receipt: $receiptDirectory"
      return
    }
  } elseif ($Resume) {
    throw "There is no receipt to resume: $receiptDirectory"
  }

  $known = Get-KnownIndex $resolvedArchiveRoot $ReceiptId
  if ($known.IncompleteReceiptIds.Count) {
    throw "Another unfinished incremental receipt must be resumed or resolved first: $($known.IncompleteReceiptIds -join ', ')"
  }

  $candidates = [Collections.Generic.List[object]]::new()
  $states = [Collections.Generic.List[object]]::new()
  if ($receiptExists) {
    if ((-not (Test-Path -LiteralPath $candidateManifestPath -PathType Leaf)) -or
      (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) -or
      (-not (Test-Path -LiteralPath $migrationLogPath -PathType Leaf))) {
      throw "The existing receipt is incomplete and cannot be resumed safely."
    }
    foreach ($path in @($candidateManifestPath, $statePath, $migrationLogPath)) {
      Assert-NoReparsePath $resolvedArchiveRoot $path $true
      [void](Get-RegularFile $path "active_receipt_file_missing_or_unsafe")
    }
    foreach ($candidate in (Import-Csv -LiteralPath $candidateManifestPath)) { $candidates.Add($candidate) }
    foreach ($state in (Import-Csv -LiteralPath $statePath)) { $states.Add($state) }
    if ($candidates.Count -ne $states.Count -or $candidates.Count -eq 0) { throw "The existing receipt ledgers disagree." }
    for ($index = 0; $index -lt $candidates.Count; $index += 1) {
      if ((Get-RowText $candidates[$index] "ActionID") -ne (Get-RowText $states[$index] "ActionID")) {
        throw "The existing receipt ordering is invalid."
      }
      $resolved = Resolve-Destination $resolvedArchiveRoot (Get-RowText $candidates[$index] "RelativeDestination") (Get-RowText $candidates[$index] "DestinationPath")
      $candidates[$index].DestinationPath = $resolved.Path
      Assert-NotKnown $candidates[$index] $known ($index + 1)
    }
  } else {
    $plan = @(Import-Csv -LiteralPath $resolvedPlanPath | Where-Object { (Get-RowText $_ "Include").ToUpperInvariant() -eq "YES" })
    if (-not $plan.Count) { throw "The ingest plan contains no Include=YES rows." }
    $reservedDestinations = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $knownDestinationPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($knownRelativeDestination in $known.Destinations) {
      $normalizedKnownRelative = $knownRelativeDestination.Replace('/', '\').TrimStart('\')
      if ($normalizedKnownRelative.StartsWith("07_Inbox\", [StringComparison]::OrdinalIgnoreCase)) {
        $knownDestinationPath = Get-NormalizedFullPath (Join-Path $resolvedArchiveRoot $normalizedKnownRelative)
        if (Test-PathInside $resolvedArchiveRoot $knownDestinationPath) {
          [void]$knownDestinationPaths.Add($knownDestinationPath)
          [void]$reservedDestinations.Add($knownDestinationPath)
        }
      }
    }
    $reservedRecordIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $reservedSources = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $position = 0
    foreach ($row in $plan) {
      $position += 1
      $sourceText = Get-RowText $row "SourcePath"
      if (-not $sourceText -or -not [IO.Path]::IsPathRooted($sourceText)) { throw "Plan row $position has an invalid source path." }
      $sourcePath = Get-NormalizedFullPath $sourceText
      if (Test-PathInside $resolvedArchiveRoot $sourcePath) { throw "Plan row $position points inside the archive." }
      $source = Get-RegularFile $sourcePath "plan_source_not_regular_file"
      $expectedSize = 0L
      if (-not [long]::TryParse((Get-RowText $row "SourceSizeBytes"), [ref]$expectedSize) -or $expectedSize -lt 0) {
        throw "Plan row $position has an invalid frozen size."
      }
      $expectedModifiedUtc = Get-UtcDate (Get-RowText $row "SourceLastWriteUTC") "plan_modified_time_invalid"
      Assert-FileSnapshot $source $expectedSize $expectedModifiedUtc "plan_source_changed_after_discovery"

      $recordId = Get-RowText $row "RecordID"
      if (-not $recordId) { $recordId = Get-MetadataId $sourcePath $expectedSize $expectedModifiedUtc }
      if ($recordId -notmatch '^[A-Za-z0-9_-]{3,80}$' -or -not $reservedRecordIds.Add($recordId)) {
        throw "Plan row $position has an invalid or duplicate RecordID."
      }
      if (-not $reservedSources.Add($sourcePath)) { throw "Plan row $position repeats a source file." }
      $relativeDestination = Get-RelativeDestination (Get-RowText $row "RelativeDestination")
      $provisional = [pscustomobject]@{
        SourcePath = $sourcePath
        RecordID = $recordId
        ExpectedSizeBytes = $expectedSize
        RelativeDestination = $relativeDestination
      }
      Assert-NotKnown $provisional $known $position

      $resolved = Resolve-Destination $resolvedArchiveRoot $relativeDestination ""
      $destinationPath = $resolved.Path
      $destinationDirectory = Split-Path -Parent $destinationPath
      $stem = [IO.Path]::GetFileNameWithoutExtension($destinationPath)
      $extension = [IO.Path]::GetExtension($destinationPath)
      $suffix = 0
      $hadDestinationCollision = $knownDestinationPaths.Contains($destinationPath) -or
        $reservedDestinations.Contains($destinationPath) -or (Test-Path -LiteralPath $destinationPath)
      while ((Test-Path -LiteralPath $destinationPath) -or -not $reservedDestinations.Add($destinationPath)) {
        $suffix += 1
        $leaf = if ($suffix -eq 1) { "${stem}__${recordId}${extension}" } else { "${stem}__${recordId}_${suffix}${extension}" }
        $destinationPath = Get-NormalizedFullPath (Join-Path $destinationDirectory $leaf)
        if (-not (Test-PathInside $resolvedArchiveRoot $destinationPath)) { throw "collision_destination_outside_archive" }
        Assert-NoReparsePath $resolvedArchiveRoot $destinationPath $true
      }
      $relativeDestination = $destinationPath.Substring($resolvedArchiveRoot.Length).TrimStart('\')
      $disposition = (Get-RowText $row "ArchiveDisposition").ToUpperInvariant()
      if ($hadDestinationCollision) { $disposition = "REVIEW_REQUIRED" }
      if ($disposition -ne "READY_REFERENCE") { $disposition = "REVIEW_REQUIRED" }
      $workBucket = if ($disposition -eq "READY_REFERENCE") { "INCREMENTAL_VERIFIED" } else { "INCREMENTAL_REVIEW" }
      $observedYear = 0
      if (-not [int]::TryParse((Get-RowText $row "ObservedYear"), [ref]$observedYear) -or $observedYear -lt 1) {
        $observedYear = $expectedModifiedUtc.Year
      }
      $actionId = "{0}-{1:D6}" -f $ReceiptId, $position
      $candidate = [pscustomobject][ordered]@{
        ActionID = $actionId
        RecordType = "INCREMENTAL_DISCOVERY"
        RecordID = $recordId
        InventoryRecordID = ""
        SourcePath = $sourcePath
        SourceRootAlias = Get-RowText $row "SourceRootAlias"
        SourceStatus = "AVAILABLE_SIZE_MATCH"
        ExpectedSizeBytes = $expectedSize
        ExpectedModifiedUTC = $expectedModifiedUtc.ToString("o")
        RelativeDestination = $relativeDestination
        DestinationPath = $destinationPath
        TechnicalCategory = Get-RowText $row "TechnicalCategory"
        WorkBucket = $workBucket
        ArchiveDisposition = $disposition
        ObservedYear = $observedYear
        DiscoveredAtUTC = Get-RowText $row "DiscoveredAtUTC"
        CollisionPolicy = if ($suffix) { "DETERMINISTIC_RECORD_SUFFIX" } else { "UNIQUE_AS_MAPPED" }
      }
      $candidates.Add($candidate)
      $states.Add([pscustomobject][ordered]@{
        ActionID = $actionId
        Status = "PLANNED"
        AttemptCount = 0
        LastAttemptUTC = ""
        DestinationSizeBytes = ""
        VerificationStatus = "PENDING"
        VerificationMethod = "EXACT_SIZE_AND_MODIFIED_UTC_STABILITY"
        SourcePreserved = "PENDING"
        ErrorMessage = ""
      })
    }

    Ensure-SafeDirectory $resolvedArchiveRoot $receiptDirectory
    Write-NewCsv $candidates $candidateManifestPath $resolvedArchiveRoot
    [IO.File]::SetAttributes($candidateManifestPath, [IO.FileAttributes]::ReadOnly)
    Write-StateAtomically $states $statePath $resolvedArchiveRoot
    $migrationHeader = '"OccurredAtUTC","ActionID","Event","ExpectedSizeBytes","DestinationSizeBytes","Detail"' + "`r`n"
    Write-NewTextAtomically $migrationHeader $migrationLogPath $resolvedArchiveRoot
  }

  $expectedTotalBytes = [long](($candidates | Measure-Object ExpectedSizeBytes -Sum).Sum)
  $archiveDrive = New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($resolvedArchiveRoot))
  if ($archiveDrive.AvailableFreeSpace -lt ($expectedTotalBytes + 100MB)) { throw "Archive drive free space is below the safe ingest threshold." }

  $verified = 0
  $failed = 0
  for ($index = 0; $index -lt $candidates.Count; $index += 1) {
    $candidate = $candidates[$index]
    $state = $states[$index]
    $resolved = Resolve-Destination $resolvedArchiveRoot (Get-RowText $candidate "RelativeDestination") (Get-RowText $candidate "DestinationPath")
    $candidate.DestinationPath = $resolved.Path
    $partialPath = "$($resolved.Path).partial-$($candidate.ActionID)"
    if (Remove-ExactPartial $partialPath $resolvedArchiveRoot) {
      Add-MigrationLog $migrationLogPath ([pscustomobject][ordered]@{
        OccurredAtUTC = (Get-Date).ToUniversalTime().ToString("o"); ActionID = $candidate.ActionID; Event = "STALE_PARTIAL_REMOVED"
        ExpectedSizeBytes = $candidate.ExpectedSizeBytes; DestinationSizeBytes = ""; Detail = "EXACT_CONTAINED_PARTIAL_RETRYING"
      }) $resolvedArchiveRoot
    }
    if ((Get-RowText $state "Status") -eq "VERIFIED") {
      Assert-LiveCandidate $candidate $resolvedArchiveRoot
      $verified += 1
      continue
    }

    $state.AttemptCount = [int]$state.AttemptCount + 1
    $state.LastAttemptUTC = (Get-Date).ToUniversalTime().ToString("o")
    try {
      $expectedSize = [long](Get-RowText $candidate "ExpectedSizeBytes")
      $expectedModifiedUtc = Get-UtcDate (Get-RowText $candidate "ExpectedModifiedUTC") "invalid_expected_modified_time"
      $sourcePath = Get-NormalizedFullPath (Get-RowText $candidate "SourcePath")
      $before = Get-RegularFile $sourcePath "source_missing_before_copy"
      Assert-FileSnapshot $before $expectedSize $expectedModifiedUtc "source_changed_before_copy"

      Assert-NoReparsePath $resolvedArchiveRoot $resolved.Path $true
      if (Test-Path -LiteralPath $resolved.Path -PathType Leaf) {
        $existingDestination = Get-RegularFile $resolved.Path "existing_destination_unverified"
        Assert-FileSnapshot $existingDestination $expectedSize $expectedModifiedUtc "existing_destination_unverified"
        $sourceProof = Get-RegularFile $sourcePath "source_missing_during_recovery"
        Assert-FileSnapshot $sourceProof $expectedSize $expectedModifiedUtc "source_changed_during_recovery"
        $state.Status = "VERIFIED"
        $state.DestinationSizeBytes = $existingDestination.Length
        $state.VerificationStatus = "SIZE_AND_MODIFIED_UTC_MATCH"
        $state.SourcePreserved = "YES"
        $state.ErrorMessage = ""
        $verified += 1
        Add-MigrationLog $migrationLogPath ([pscustomobject][ordered]@{
          OccurredAtUTC = (Get-Date).ToUniversalTime().ToString("o"); ActionID = $candidate.ActionID; Event = "RECOVERED_VERIFIED"
          ExpectedSizeBytes = $candidate.ExpectedSizeBytes; DestinationSizeBytes = $existingDestination.Length; Detail = "EXACT_SIZE_MODIFIED_UTC_SOURCE_PRESERVED"
        }) $resolvedArchiveRoot
        continue
      }
      if (Test-Path -LiteralPath $resolved.Path) { throw "destination_appeared_after_freeze" }
      Ensure-SafeDirectory $resolvedArchiveRoot (Split-Path -Parent $resolved.Path)
      Assert-NoReparsePath $resolvedArchiveRoot $partialPath $true
      $input = [IO.File]::Open($sourcePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      try {
        $output = [IO.File]::Open($partialPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
          $input.CopyTo($output, 4MB)
          $output.Flush($true)
        } finally { $output.Dispose() }
      } finally { $input.Dispose() }

      Assert-NoReparsePath $resolvedArchiveRoot $partialPath $true
      $temporary = Get-RegularFile $partialPath "partial_copy_missing_or_unsafe"
      $after = Get-RegularFile $sourcePath "source_missing_after_copy"
      Assert-FileSnapshot $temporary $expectedSize $temporary.LastWriteTimeUtc "partial_size_mismatch"
      Assert-FileSnapshot $after $expectedSize $expectedModifiedUtc "source_changed_during_copy"
      $temporary.CreationTimeUtc = $before.CreationTimeUtc
      $temporary.LastWriteTimeUtc = $expectedModifiedUtc
      $temporary = Get-RegularFile $partialPath "partial_copy_missing_before_commit"
      Assert-FileSnapshot $temporary $expectedSize $expectedModifiedUtc "partial_snapshot_mismatch"

      Assert-NoReparsePath $resolvedArchiveRoot (Split-Path -Parent $resolved.Path) $true
      Assert-NoReparsePath $resolvedArchiveRoot $resolved.Path $true
      if (Test-Path -LiteralPath $resolved.Path) { throw "destination_appeared_before_commit" }
      [IO.File]::Move($partialPath, $resolved.Path)
      Assert-NoReparsePath $resolvedArchiveRoot $resolved.Path $true
      $destination = Get-RegularFile $resolved.Path "destination_missing_after_commit"
      Assert-FileSnapshot $destination $expectedSize $expectedModifiedUtc "destination_snapshot_mismatch"
      $sourceProof = Get-RegularFile $sourcePath "source_missing_after_commit"
      Assert-FileSnapshot $sourceProof $expectedSize $expectedModifiedUtc "source_preservation_unconfirmed"

      $state.Status = "VERIFIED"
      $state.DestinationSizeBytes = $destination.Length
      $state.VerificationStatus = "SIZE_AND_MODIFIED_UTC_MATCH"
      $state.SourcePreserved = "YES"
      $state.ErrorMessage = ""
      $verified += 1
      Add-MigrationLog $migrationLogPath ([pscustomobject][ordered]@{
        OccurredAtUTC = (Get-Date).ToUniversalTime().ToString("o"); ActionID = $candidate.ActionID; Event = "VERIFIED"
        ExpectedSizeBytes = $candidate.ExpectedSizeBytes; DestinationSizeBytes = $destination.Length; Detail = "COPY_ATOMIC_SOURCE_PRESERVED"
      }) $resolvedArchiveRoot
    } catch {
      $failureMessage = $_.Exception.Message
      $state.Status = "FAILED"
      $state.VerificationStatus = "FAILED"
      try {
        $sourceProof = Get-RegularFile (Get-NormalizedFullPath (Get-RowText $candidate "SourcePath")) "source_unavailable"
        $expectedModifiedUtc = Get-UtcDate (Get-RowText $candidate "ExpectedModifiedUTC") "invalid_expected_modified_time"
        Assert-FileSnapshot $sourceProof ([long](Get-RowText $candidate "ExpectedSizeBytes")) $expectedModifiedUtc "source_changed"
        $state.SourcePreserved = "YES"
      } catch { $state.SourcePreserved = "UNKNOWN" }
      $state.ErrorMessage = if ($failureMessage -match '^[a-z0-9_]+$') { $failureMessage } else { "incremental_ingest_failed" }
      $failed += 1
      Add-MigrationLog $migrationLogPath ([pscustomobject][ordered]@{
        OccurredAtUTC = (Get-Date).ToUniversalTime().ToString("o"); ActionID = $candidate.ActionID; Event = "FAILED"
        ExpectedSizeBytes = $candidate.ExpectedSizeBytes; DestinationSizeBytes = ""; Detail = $state.ErrorMessage
      }) $resolvedArchiveRoot
    } finally {
      if (Test-Path -LiteralPath $partialPath) { [void](Remove-ExactPartial $partialPath $resolvedArchiveRoot) }
      Write-StateAtomically $states $statePath $resolvedArchiveRoot
    }
  }

  $verifiedRows = [Collections.Generic.List[object]]::new()
  $exceptionRows = [Collections.Generic.List[object]]::new()
  for ($index = 0; $index -lt $candidates.Count; $index += 1) {
    $candidate = $candidates[$index]
    $state = $states[$index]
    $combined = [ordered]@{}
    foreach ($property in $candidate.PSObject.Properties) { $combined[$property.Name] = $property.Value }
    foreach ($property in $state.PSObject.Properties) {
      if ($property.Name -ne "ActionID") { $combined[$property.Name] = $property.Value }
    }
    if ((Get-RowText $state "Status") -eq "VERIFIED") { $verifiedRows.Add([pscustomobject]$combined) }
    else { $exceptionRows.Add([pscustomobject]$combined) }
  }
  if ($failed -or $exceptionRows.Count) {
    Write-TextAtomically (Convert-ToCsvText $exceptionRows) $exceptionsPath $resolvedArchiveRoot
    throw "Incremental ingest completed with $($exceptionRows.Count) failure(s); inspect the private active receipt."
  }

  foreach ($candidate in $candidates) { Assert-LiveCandidate $candidate $resolvedArchiveRoot }
  Write-NewOrValidateCsv $verifiedRows $verifiedPath $resolvedArchiveRoot
  Write-TextAtomically "" $exceptionsPath $resolvedArchiveRoot
  $verifiedBytes = [long](($verifiedRows | Measure-Object DestinationSizeBytes -Sum).Sum)
  $receipt = [ordered]@{
    schemaVersion = "angelo-art-index-incremental-receipt/1.1"
    receiptId = $ReceiptId
    candidateManifestSha256 = Get-Sha256 $candidateManifestPath
    verifiedFilesSha256 = Get-Sha256 $verifiedPath
    stateSha256 = Get-Sha256 $statePath
    migrationLogSha256 = Get-Sha256 $migrationLogPath
    exceptionsSha256 = Get-Sha256 $exceptionsPath
    planned = $candidates.Count
    verified = $verifiedRows.Count
    failed = 0
    expectedBytes = $expectedTotalBytes
    verifiedBytes = $verifiedBytes
    completedAtUTC = (Get-Date).ToUniversalTime().ToString("o")
    sourcePolicy = "COPY_ATOMIC_EXACT_SIZE_MODIFIED_UTC_STABLE_SOURCE_PRESERVED_NO_OVERWRITE"
  }
  Write-NewTextAtomically (($receipt | ConvertTo-Json -Depth 4) + "`r`n") $receiptPath $resolvedArchiveRoot
  Write-Host "Verified $($verifiedRows.Count) incremental Art Index item(s) / $verifiedBytes bytes. Originals remain unchanged."
  Write-Host "Receipt: $receiptDirectory"
} finally {
  if ($null -ne $archiveLock) { $archiveLock.Dispose() }
}
