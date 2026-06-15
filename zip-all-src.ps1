<#
.SYNOPSIS
  Bundle the src/ folder of every service into ONE shareable zip.

.DESCRIPTION
  Zips JUST the src/ folder of each service -- source code only, no
  node_modules, no target/ or build output, no other dependencies -- into a
  single zip at the repo root. Run it, then copy/paste the one resulting file
  (e.g. into an AI chat) to share the source of every microservice at once.

  Two layouts:
    * default (zip-of-zips): the parent contains one "<service>-src.zip" per
      service, each holding that service's src/ tree. Matches the manual
      convention.
    * -Flat: a single flat archive holding "<service>/src/..." for every
      service -- one extraction instead of two; usually easier for an AI to
      browse.

  The service list mirrors install-run-all.ps1 (the same 9 folders). Files are
  read with shared (read/write) access, so a service that is currently running
  still zips cleanly; any genuinely unreadable file is skipped with a warning
  instead of aborting.

.PARAMETER Exclude
  Comma-separated service folder names to skip (same names as install-run-all.ps1).

.PARAMETER OutFile
  Output zip name written at the repo root. Default: all-services-src.zip

.PARAMETER Flat
  Produce a single flat archive ("<service>/src/...") instead of a zip-of-zips.

.EXAMPLES
  ./zip-all-src.ps1
  ./zip-all-src.ps1 -Flat
  ./zip-all-src.ps1 -e architecture-read-service,jira-service
  ./zip-all-src.ps1 -o haikai-src.zip -Flat
#>
param(
  [Alias('e')]
  [string[]]$Exclude = @(),

  [Alias('o')]
  [string]$OutFile = 'all-services-src.zip',

  [Alias('f')]
  [switch]$Flat
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression | Out-Null

$repoRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }

# Same service folders as install-run-all.ps1 (kept in the same order).
$services = @(
  'architecture-model-service',
  'architecture-read-service',
  'jira-service',
  'sybase-discovery-sidecar',
  'gateway',
  'discovery-service',
  'api-migration-validation-service',
  'mcp-server',
  'frontend'
)

# ---------------------------------------------------------------------------
# Add every file under $SourceDir to the already-open $Zip, prefixing entry
# names with $Prefix (e.g. "src" or "frontend/src"). Files are opened with
# shared read/write access so a file held open by a running service still
# copies. Returns the count of files skipped (unreadable).
# ---------------------------------------------------------------------------
function Add-DirToZip {
  param(
    [System.IO.Compression.ZipArchive]$Zip,
    [string]$SourceDir,
    [string]$Prefix = ''
  )
  $base = (Resolve-Path -LiteralPath $SourceDir).Path
  $skipped = 0
  foreach ($f in (Get-ChildItem -LiteralPath $base -Recurse -File -Force)) {
    $rel = $f.FullName.Substring($base.Length).TrimStart('\', '/').Replace('\', '/')
    $entryName = if ($Prefix) { "$Prefix/$rel" } else { $rel }
    try {
      $in = [System.IO.File]::Open(
        $f.FullName,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::ReadWrite)
      try {
        $entry = $Zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
        $out = $entry.Open()
        try { $in.CopyTo($out) } finally { $out.Dispose() }
      }
      finally { $in.Dispose() }
    }
    catch {
      Write-Host "    (skipped unreadable file: $entryName)" -ForegroundColor DarkGray
      $skipped++
    }
  }
  return $skipped
}

# Create a fresh zip at $ZipPath holding $SourceDir under $RootName. Returns
# the count of skipped files.
function New-RobustZip {
  param([string]$SourceDir, [string]$ZipPath, [string]$RootName = '')
  if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
  $fs = [System.IO.File]::Open($ZipPath, [System.IO.FileMode]::CreateNew)
  $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
  try { return (Add-DirToZip -Zip $zip -SourceDir $SourceDir -Prefix $RootName) }
  finally { $zip.Dispose(); $fs.Dispose() }
}

# --- Resolve -Exclude (accepts comma-separated and/or repeated values) -------
$excludeSet = @()
if ($Exclude -and $Exclude.Count -gt 0) {
  $excludeSet = $Exclude |
    ForEach-Object { $_ -split ',' } |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ }
}
foreach ($x in $excludeSet) {
  if ($services -notcontains $x) {
    Write-Host "ERROR: unknown service '$x' in -exclude." -ForegroundColor Red
    Write-Host "Valid service names: $($services -join ', ')" -ForegroundColor Yellow
    exit 1
  }
}

$selected = @($services | Where-Object { $excludeSet -notcontains $_ })
if ($selected.Count -eq 0) {
  Write-Host "ERROR: all services excluded; nothing to do." -ForegroundColor Red
  exit 1
}

$exNote = if ($excludeSet.Count) { " (excluded: $($excludeSet -join ', '))" } else { '' }
Write-Host ''
Write-Host "Repo root : $repoRoot"
Write-Host "Layout    : $(if ($Flat) { 'flat (<service>/src/...)' } else { 'zip-of-zips (<service>-src.zip)' })"
Write-Host "Services  : $($selected.Count) selected$exNote"
Write-Host ''

$out = Join-Path $repoRoot $OutFile
$included = @()
$missing  = @()

if ($Flat) {
  # --- One flat archive: <service>/src/... for every service ----------------
  if (Test-Path $out) { Remove-Item $out -Force }
  $fs = [System.IO.File]::Open($out, [System.IO.FileMode]::CreateNew)
  $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($svc in $selected) {
      $src = Join-Path $repoRoot (Join-Path $svc 'src')
      if (-not (Test-Path $src)) {
        Write-Host ("  SKIP {0,-40} (no src/ folder)" -f $svc) -ForegroundColor DarkYellow
        $missing += $svc
        continue
      }
      $skipped = Add-DirToZip -Zip $zip -SourceDir $src -Prefix "$svc/src"
      $skipNote = if ($skipped) { " ($skipped file(s) skipped)" } else { '' }
      Write-Host ("  OK   {0,-40}{1}" -f $svc, $skipNote) -ForegroundColor Green
      $included += $svc
    }
  }
  finally { $zip.Dispose(); $fs.Dispose() }
}
else {
  # --- Zip-of-zips: stage one <service>-src.zip each, then bundle ------------
  $staging = Join-Path ([System.IO.Path]::GetTempPath()) ('src-zips-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $staging -Force | Out-Null
  try {
    foreach ($svc in $selected) {
      $src = Join-Path $repoRoot (Join-Path $svc 'src')
      if (-not (Test-Path $src)) {
        Write-Host ("  SKIP {0,-40} (no src/ folder)" -f $svc) -ForegroundColor DarkYellow
        $missing += $svc
        continue
      }
      $zipPath = Join-Path $staging "$svc-src.zip"
      $skipped = New-RobustZip -SourceDir $src -ZipPath $zipPath -RootName 'src'
      $sizeKb = [math]::Round((Get-Item $zipPath).Length / 1KB)
      $skipNote = if ($skipped) { " ($skipped file(s) skipped)" } else { '' }
      Write-Host ("  OK   {0,-40} {1,8} KB{2}" -f $svc, $sizeKb, $skipNote) -ForegroundColor Green
      $included += $svc
    }
    if ($included.Count -eq 0) {
      Write-Host 'ERROR: nothing zipped (no src/ folders found).' -ForegroundColor Red
      exit 1
    }
    New-RobustZip -SourceDir $staging -ZipPath $out -RootName '' | Out-Null
  }
  finally {
    if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
  }
}

if ($included.Count -eq 0) {
  Write-Host 'ERROR: nothing zipped (no src/ folders found).' -ForegroundColor Red
  exit 1
}

$outSizeMb = [math]::Round((Get-Item $out).Length / 1MB, 2)
Write-Host ''
Write-Host "Created: $out" -ForegroundColor Cyan
Write-Host "  $($included.Count) service(s), $outSizeMb MB -- share this single file." -ForegroundColor Cyan
if ($missing.Count) {
  Write-Host "  Skipped (no src/): $($missing -join ', ')" -ForegroundColor DarkYellow
}
