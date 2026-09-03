param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [string]$ArchiveRoot = "",
  [datetime]$SinceUtc = [datetime]::MinValue,
  [datetime]$UntilUtc = [datetime]::UtcNow,
  [string[]]$DiscoveryRoots = @(),
  [string[]]$DiscoveryRootAliases = @(),
  [long]$ExpectedCount = -1,
  [long]$ExpectedBytes = -1,
  [string]$DestinationDate = ""
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
  if (-not (Test-PathAtOrInside $normalizedRoot $normalizedTarget)) { throw "A protected archive path escapes ArchiveRoot." }
  $volumeRoot = [IO.Path]::GetPathRoot($normalizedTarget)
  $volumeItem = Get-Item -LiteralPath $volumeRoot -Force
  if (($volumeItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "An archive destination ancestor is a reparse point or junction."
  }
  $relative = $normalizedTarget.Substring($volumeRoot.Length).TrimStart('\')
  $segments = @($relative.Split('\'))
  $lastIndex = if ($IncludeTarget) { $segments.Count - 1 } else { $segments.Count - 2 }
  $current = $volumeRoot
  for ($index = 0; $index -le $lastIndex; $index += 1) {
    $current = Join-Path $current $segments[$index]
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "An archive destination ancestor is a reparse point or junction."
      }
    }
  }
}

function Ensure-SafeDirectory([string]$Root, [string]$Directory) {
  $normalizedRoot = Get-NormalizedFullPath $Root
  $normalizedDirectory = Get-NormalizedFullPath $Directory
  if (-not (Test-PathAtOrInside $normalizedRoot $normalizedDirectory)) { throw "A protected archive directory escapes ArchiveRoot." }
  Assert-NoReparsePath $normalizedRoot $normalizedDirectory $true
  if ($normalizedDirectory.Equals($normalizedRoot, [StringComparison]::OrdinalIgnoreCase)) { return }

  $relative = $normalizedDirectory.Substring($normalizedRoot.Length).TrimStart('\')
  $current = $normalizedRoot
  foreach ($segment in $relative.Split('\')) {
    $current = Join-Path $current $segment
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (-not $item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
        throw "An archive destination ancestor is not a regular directory."
      }
    } else {
      $parent = Split-Path -Parent $current
      Assert-NoReparsePath $normalizedRoot $parent $true
      [void][IO.Directory]::CreateDirectory($current)
      $created = Get-Item -LiteralPath $current -Force
      if (-not $created.PSIsContainer -or (($created.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
        throw "A safe archive directory could not be created."
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

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Get-RelativeDestination([string]$Value) {
  $relative = $Value.Trim().Replace('/', '\')
  if (-not $relative -or [IO.Path]::IsPathRooted($relative) -or $relative.StartsWith('\')) {
    throw "A finalized receipt contains an invalid relative destination."
  }
  $segments = @($relative.Split('\'))
  if ($segments.Count -lt 2 -or -not $segments[0].Equals("07_Inbox", [StringComparison]::OrdinalIgnoreCase)) {
    throw "A finalized receipt destination is outside 07_Inbox."
  }
  foreach ($segment in $segments) {
    if (-not $segment -or $segment -ne $segment.Trim() -or $segment.EndsWith('.') -or
      $segment -eq "." -or $segment -eq ".." -or $segment.IndexOf(':') -ge 0) {
      throw "A finalized receipt contains an unsafe destination segment."
    }
    if ($segment.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) {
      throw "A finalized receipt contains an invalid destination segment."
    }
  }
  return ($segments -join '\')
}

function Get-ValidatedFinalizedRows([string]$ReceiptDirectory, [string]$Root) {
  $receiptPath = Join-Path $ReceiptDirectory "receipt.json"
  $candidatePath = Join-Path $ReceiptDirectory "candidate_manifest.csv"
  $verifiedPath = Join-Path $ReceiptDirectory "verified_files.csv"
  $statePath = Join-Path $ReceiptDirectory "state.csv"
  if ((-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) -or
    (-not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) -or
    (-not (Test-Path -LiteralPath $verifiedPath -PathType Leaf)) -or
    (-not (Test-Path -LiteralPath $statePath -PathType Leaf))) {
    throw "A finalized incremental receipt is missing required files."
  }
  $migrationPath = Join-Path $ReceiptDirectory "migration_log.csv"
  $exceptionsPath = Join-Path $ReceiptDirectory "exceptions.csv"
  if ((-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) -or
    (-not (Test-Path -LiteralPath $exceptionsPath -PathType Leaf)) -or
    (Get-Item -LiteralPath $exceptionsPath -Force).Length -ne 0 -or
    (Get-Content -LiteralPath $migrationPath -TotalCount 1) -cne '"OccurredAtUTC","ActionID","Event","ExpectedSizeBytes","DestinationSizeBytes","Detail"') {
    throw "A finalized incremental receipt has invalid final ledgers."
  }
  $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  $schema = [string]$receipt.schemaVersion
  if ($schema -ne "angelo-art-index-incremental-receipt/1.0" -and
    $schema -ne "angelo-art-index-incremental-receipt/1.1") {
    throw "A finalized incremental receipt has an unsupported schema."
  }
  if ([string]$receipt.receiptId -ne (Split-Path -Leaf $ReceiptDirectory)) {
    throw "A finalized incremental receipt ID disagrees with its directory."
  }
  if ((Get-Sha256 $candidatePath) -ne ([string]$receipt.candidateManifestSha256).ToUpperInvariant()) {
    throw "A finalized incremental candidate manifest hash is invalid."
  }
  if ($schema -eq "angelo-art-index-incremental-receipt/1.1") {
    if ((Get-Sha256 $verifiedPath) -ne ([string]$receipt.verifiedFilesSha256).ToUpperInvariant()) {
      throw "A finalized incremental verified-files hash is invalid."
    }
    foreach ($hashFile in @(
      @("state.csv", "stateSha256"),
      @("migration_log.csv", "migrationLogSha256"),
      @("exceptions.csv", "exceptionsSha256")
    )) {
      $path = Join-Path $ReceiptDirectory $hashFile[0]
      $expectedHash = [string]$receipt.($hashFile[1])
      if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
        (Get-Sha256 $path) -ne $expectedHash.ToUpperInvariant()) {
        throw "A finalized incremental receipt ledger hash is invalid."
      }
    }
  }

  $candidates = @(Import-Csv -LiteralPath $candidatePath)
  $verifiedRows = @(Import-Csv -LiteralPath $verifiedPath)
  $states = @(Import-Csv -LiteralPath $statePath)
  if ([long]$receipt.failed -ne 0 -or $candidates.Count -ne [long]$receipt.planned -or
    $verifiedRows.Count -ne [long]$receipt.verified -or $verifiedRows.Count -ne $candidates.Count -or
    $states.Count -ne $candidates.Count) {
    throw "A finalized incremental receipt has inconsistent counts."
  }
  $candidateByAction = @{}
  $expectedBytes = 0L
  for ($index = 0; $index -lt $candidates.Count; $index += 1) {
    $candidate = $candidates[$index]
    $actionId = Get-RowText $candidate "ActionID"
    if (-not $actionId -or $candidateByAction.ContainsKey($actionId)) { throw "A finalized receipt has duplicate action IDs." }
    $relative = Get-RelativeDestination (Get-RowText $candidate "RelativeDestination")
    $destination = Get-NormalizedFullPath (Join-Path $Root $relative)
    if (-not (Test-PathInside $Root $destination)) { throw "A finalized receipt destination escapes ArchiveRoot." }
    $storedDestination = Get-RowText $candidate "DestinationPath"
    if ($storedDestination -and -not (Get-NormalizedFullPath $storedDestination).Equals($destination, [StringComparison]::OrdinalIgnoreCase)) {
      throw "A finalized receipt absolute destination disagrees with its relative destination."
    }
    $size = 0L
    if (-not [long]::TryParse((Get-RowText $candidate "ExpectedSizeBytes"), [ref]$size) -or $size -lt 0) {
      throw "A finalized receipt contains an invalid expected size."
    }
    $expectedBytes += $size
    $candidateByAction[$actionId] = $candidate
    $state = $states[$index]
    $verificationStatus = Get-RowText $state "VerificationStatus"
    if ((Get-RowText $state "ActionID") -ne $actionId -or (Get-RowText $state "Status") -ne "VERIFIED" -or
      (Get-RowText $state "SourcePreserved") -ne "YES" -or
      (Get-RowText $state "DestinationSizeBytes") -ne ([string]$size) -or
      ($verificationStatus -ne "SIZE_MATCH" -and $verificationStatus -ne "SIZE_AND_MODIFIED_UTC_MATCH")) {
      throw "A finalized incremental state row disagrees with its candidate manifest."
    }
  }
  $verifiedBytes = 0L
  $verifiedActionIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($verified in $verifiedRows) {
    $actionId = Get-RowText $verified "ActionID"
    if (-not $verifiedActionIds.Add($actionId) -or -not $candidateByAction.ContainsKey($actionId) -or
      (Get-RowText $verified "Status") -ne "VERIFIED" -or (Get-RowText $verified "SourcePreserved") -ne "YES") {
      throw "A finalized verified-files row is not backed by its candidate manifest."
    }
    $candidate = $candidateByAction[$actionId]
    foreach ($field in @("RecordID", "SourcePath", "ExpectedSizeBytes", "ExpectedModifiedUTC", "RelativeDestination")) {
      if ((Get-RowText $verified $field) -ne (Get-RowText $candidate $field)) {
        throw "A finalized verified-files row disagrees with its candidate manifest."
      }
    }
    $destinationBytes = 0L
    if (-not [long]::TryParse((Get-RowText $verified "DestinationSizeBytes"), [ref]$destinationBytes) -or
      $destinationBytes -ne [long](Get-RowText $candidate "ExpectedSizeBytes")) {
      throw "A finalized verified-files row has an invalid destination size."
    }
    $verifiedBytes += $destinationBytes
  }
  if ($expectedBytes -ne [long]$receipt.expectedBytes -or $verifiedBytes -ne [long]$receipt.verifiedBytes) {
    throw "A finalized incremental receipt has inconsistent byte totals."
  }
  return $verifiedRows
}

function Add-KnownRow(
  [object]$Row,
  [Collections.Generic.HashSet[string]]$KnownSources,
  [Collections.Generic.HashSet[string]]$KnownRecordIds,
  [Collections.Generic.HashSet[string]]$KnownDestinations
) {
  $sourcePath = Get-RowText $Row "SourcePath"
  if ($sourcePath) {
    try { $sourcePath = Get-NormalizedFullPath $sourcePath } catch { }
    [void]$KnownSources.Add($sourcePath)
  }
  $recordId = Get-RowText $Row "RecordID"
  if ($recordId) { [void]$KnownRecordIds.Add($recordId) }
  $relative = Get-RowText $Row "RelativeDestination"
  if ($relative) {
    $relative = $relative.Replace('/', '\').TrimStart('\')
    [void]$KnownDestinations.Add($relative)
  }
}

if (-not $ArchiveRoot) {
  if ($env:CS_ARCHIVE_ROOT) { $ArchiveRoot = $env:CS_ARCHIVE_ROOT }
  else { throw "ArchiveRoot is required when CS_ARCHIVE_ROOT is not configured." }
}
if (-not [IO.Path]::IsPathRooted($ArchiveRoot)) { throw "ArchiveRoot must be an absolute path." }
if (-not (Test-Path -LiteralPath $ArchiveRoot -PathType Container)) { throw "ArchiveRoot does not exist." }
$resolvedArchiveRoot = Get-NormalizedFullPath (Resolve-Path -LiteralPath $ArchiveRoot).Path
Assert-NoReparsePath $resolvedArchiveRoot $resolvedArchiveRoot $true

$since = $SinceUtc.ToUniversalTime()
$until = $UntilUtc.ToUniversalTime()
if ($since -ge $until) { throw "SinceUtc must be earlier than UntilUtc." }
if (-not $DestinationDate) { $DestinationDate = $until.ToString("yyyy-MM-dd") }
$parsedDestinationDate = [datetime]::MinValue
if (-not [datetime]::TryParseExact($DestinationDate, "yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture,
  [Globalization.DateTimeStyles]::None, [ref]$parsedDestinationDate)) {
  throw "DestinationDate must use yyyy-MM-dd."
}

$rootDefinitions = [Collections.Generic.List[object]]::new()
if ($DiscoveryRoots.Count -eq 0) {
  $documents = [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments)
  if ($documents) {
    $rootDefinitions.Add([pscustomobject]@{ Path = Join-Path $documents "ComfyUI\output"; Alias = "documents-comfyui-output" })
  }
  $repositoryRoot = Split-Path -Parent $PSScriptRoot
  $rootDefinitions.Add([pscustomobject]@{ Path = Join-Path $repositoryRoot "output"; Alias = "creative-studio-output" })
  if ($env:CS_ART_DISCOVERY_ROOTS) {
    $configuredIndex = 0
    foreach ($configuredRoot in $env:CS_ART_DISCOVERY_ROOTS.Split([IO.Path]::PathSeparator)) {
      if ($configuredRoot.Trim()) {
        $configuredIndex += 1
        $rootDefinitions.Add([pscustomobject]@{
          Path = $configuredRoot.Trim()
          Alias = "configured-output-{0:D2}" -f $configuredIndex
        })
      }
    }
  }
} else {
  if ($DiscoveryRootAliases.Count -ne 0 -and $DiscoveryRootAliases.Count -ne $DiscoveryRoots.Count) {
    throw "DiscoveryRootAliases must be empty or match DiscoveryRoots one-for-one."
  }
  for ($index = 0; $index -lt $DiscoveryRoots.Count; $index += 1) {
    $alias = if ($DiscoveryRootAliases.Count) { $DiscoveryRootAliases[$index] } else { "source-{0:D2}" -f ($index + 1) }
    $rootDefinitions.Add([pscustomobject]@{ Path = $DiscoveryRoots[$index]; Alias = $alias })
  }
}
if (-not $rootDefinitions.Count) { throw "No discovery roots were configured." }
$aliasSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($root in $rootDefinitions) {
  if ($root.Alias -notmatch '^[a-z0-9][a-z0-9-]{0,63}$' -or -not $aliasSet.Add($root.Alias)) {
    throw "Discovery root aliases must be unique lowercase letters, digits, and hyphens."
  }
}

$mediaExtensions = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
@(".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff", ".bmp", ".exr", ".hdr",
  ".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm",
  ".wav", ".aif", ".aiff", ".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus") |
  ForEach-Object { [void]$mediaExtensions.Add($_) }

$archiveLock = $null
try {
  $archiveLock = Enter-ArchiveLock $resolvedArchiveRoot
  $baselineManifest = Join-Path $resolvedArchiveRoot "00_Archive_Records\completion_manifest.csv"
  if (-not (Test-Path -LiteralPath $baselineManifest -PathType Leaf)) { throw "The baseline completion manifest is missing." }
  $knownSources = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $knownRecordIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $knownDestinations = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($record in (Import-Csv -LiteralPath $baselineManifest)) {
    Add-KnownRow $record $knownSources $knownRecordIds $knownDestinations
  }
  $incrementalRoot = Join-Path $resolvedArchiveRoot "00_Archive_Records\Incremental"
  if (Test-Path -LiteralPath $incrementalRoot -PathType Container) {
    Assert-NoReparsePath $resolvedArchiveRoot $incrementalRoot $true
    foreach ($receiptDirectory in (Get-ChildItem -LiteralPath $incrementalRoot -Directory -Force | Sort-Object Name)) {
      if (($receiptDirectory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "An incremental receipt directory cannot be a reparse point or junction."
      }
      if (Test-Path -LiteralPath (Join-Path $receiptDirectory.FullName "receipt.json") -PathType Leaf) {
        foreach ($row in (Get-ValidatedFinalizedRows $receiptDirectory.FullName $resolvedArchiveRoot)) {
          Add-KnownRow $row $knownSources $knownRecordIds $knownDestinations
        }
      }
    }
  }

  $candidates = [Collections.Generic.List[object]]::new()
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $exactSourceDuplicates = 0
  $destinationCollisionsRetained = 0
  foreach ($root in $rootDefinitions) {
    if (-not (Test-Path -LiteralPath $root.Path -PathType Container)) { continue }
    $sourceRoot = Get-NormalizedFullPath (Resolve-Path -LiteralPath $root.Path).Path
    if (Test-PathAtOrInside $resolvedArchiveRoot $sourceRoot -or Test-PathAtOrInside $sourceRoot $resolvedArchiveRoot) {
      throw "A discovery root cannot overlap ArchiveRoot."
    }
    foreach ($item in (Get-ChildItem -LiteralPath $sourceRoot -File -Recurse -Force -ErrorAction SilentlyContinue)) {
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or -not $mediaExtensions.Contains($item.Extension)) { continue }
      if ($item.LastWriteTimeUtc -le $since -or $item.LastWriteTimeUtc -gt $until) { continue }
      $sourcePath = Get-NormalizedFullPath $item.FullName
      $sourceRelativePath = $sourcePath.Substring($sourceRoot.Length).TrimStart('\')
      if (("\$sourceRelativePath") -match '(?i)[\\/]temp[\\/]') { continue }
      if (-not $seen.Add($sourcePath)) {
        $exactSourceDuplicates += 1
        continue
      }
      if ($knownSources.Contains($sourcePath)) {
        $exactSourceDuplicates += 1
        continue
      }
      $kind = switch -Regex ($item.Extension) {
        '(?i)^\.(png|jpe?g|webp|gif|tiff?|bmp|exr|hdr)$' { "Image / Render / Vector"; break }
        '(?i)^\.(mp4|mov|m4v|avi|mkv|webm)$' { "Video / Motion"; break }
        default { "Audio / Music" }
      }
      $relativeDestination = "07_Inbox\$DestinationDate\$($root.Alias)\$sourceRelativePath"
      $destinationCollision = $knownDestinations.Contains($relativeDestination)
      if ($destinationCollision) { $destinationCollisionsRetained += 1 }
      $candidates.Add([pscustomobject][ordered]@{
        Include = "YES"
        SourcePath = $sourcePath
        SourceSizeBytes = [long]$item.Length
        SourceLastWriteUTC = $item.LastWriteTimeUtc.ToString("o")
        SourceRootAlias = $root.Alias
        RecordID = ""
        TechnicalCategory = $kind
        ArchiveDisposition = if ($destinationCollision) { "REVIEW_REQUIRED" } else { "READY_REFERENCE" }
        ObservedYear = $item.LastWriteTimeUtc.Year
        RelativeDestination = $relativeDestination
        DiscoveredAtUTC = $until.ToString("o")
        Eligibility = "ELIGIBLE_INCREMENTAL_COPY"
        Confidence = if ($destinationCollision) { "REVIEW_REQUIRED_DESTINATION_COLLISION" } else { "HIGH" }
      })
    }
  }

  $ordered = @($candidates | Sort-Object SourcePath)
  $totalBytes = [long](($ordered | Measure-Object SourceSizeBytes -Sum).Sum)
  if ($ExpectedCount -ge 0 -and $ordered.Count -ne $ExpectedCount) {
    throw "The incremental cohort drifted: expected $ExpectedCount files, found $($ordered.Count)."
  }
  if ($ExpectedBytes -ge 0 -and $totalBytes -ne $ExpectedBytes) {
    throw "The incremental cohort drifted: expected $ExpectedBytes bytes, found $totalBytes."
  }
  if (-not $ordered.Count) { throw "No new eligible art was found after archive deduplication." }

  $resolvedOutputPath = [IO.Path]::GetFullPath($OutputPath)
  $outputDirectory = Split-Path -Parent $resolvedOutputPath
  if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
    [void](New-Item -ItemType Directory -Path $outputDirectory)
  }
  if (Test-Path -LiteralPath $resolvedOutputPath) { throw "OutputPath already exists; choose a new immutable plan path." }
  $temporaryPath = "$resolvedOutputPath.partial-$PID"
  if (Test-Path -LiteralPath $temporaryPath) { throw "The exact temporary plan path already exists." }
  [IO.File]::WriteAllLines($temporaryPath, @($ordered | ConvertTo-Csv -NoTypeInformation), $utf8NoBom)
  if (Test-Path -LiteralPath $resolvedOutputPath) { throw "OutputPath appeared before the atomic plan commit." }
  [IO.File]::Move($temporaryPath, $resolvedOutputPath)
  Write-Host "Frozen Art Index increment: $($ordered.Count) files / $totalBytes bytes ($exactSourceDuplicates exact source duplicate(s) skipped; $destinationCollisionsRetained destination collision(s) retained for review)."
  Write-Host "Plan: $resolvedOutputPath"
} finally {
  if ($null -ne $archiveLock) { $archiveLock.Dispose() }
}
