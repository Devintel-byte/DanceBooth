# Installs the Mixamo characters downloaded on 2026-11-04 and retires the old ones.
#  - waits until each download in Downloads is complete (size stable, file not locked)
#  - moves Ch26_nonPBR.fbx -> Elizabeth.fbx, Ch28_nonPBR.fbx -> David.fbx, Ch12_nonPBR.fbx -> Lewis.fbx
#  - sends Kaya, Ty and Sophie (models and portraits) to the Recycle Bin
#  - renders the character-select portraits
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
$root = Split-Path -Parent $PSScriptRoot
$chars = Join-Path $root 'assets\characters'
$downloads = Join-Path $env:USERPROFILE 'Downloads'
$map = [ordered]@{ 'Ch26_nonPBR.fbx' = 'Elizabeth.fbx'; 'Ch28_nonPBR.fbx' = 'David.fbx'; 'Ch12_nonPBR.fbx' = 'Lewis.fbx' }

function Wait-Complete($path) {
  $last = -1
  while ($true) {
    if (-not (Test-Path $path)) { throw "Not found: $path" }
    $size = (Get-Item $path).Length
    $locked = $false
    try { $s = [System.IO.File]::Open($path, 'Open', 'Read', 'None'); $s.Close() } catch { $locked = $true }
    if (-not $locked -and $size -eq $last -and $size -gt 0) { return }
    Write-Host ("  waiting for {0} ({1:N1} MB so far)" -f (Split-Path $path -Leaf), ($size / 1MB))
    $last = $size
    Start-Sleep -Seconds 5
  }
}

foreach ($src in $map.Keys) {
  $from = Join-Path $downloads $src
  $to = Join-Path $chars $map[$src]
  if (Test-Path $to) { Write-Host "$($map[$src]) already installed"; continue }
  Write-Host "Installing $($map[$src]) from $src"
  Wait-Complete $from
  Move-Item -LiteralPath $from -Destination $to
}

foreach ($old in @('kaya.fbx', 'Ty.fbx', 'Sophie.fbx', 'thumbs\kaya.png', 'thumbs\ty.png', 'thumbs\sophie.png')) {
  $p = Join-Path $chars $old
  if (Test-Path $p) {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
    Write-Host "Moved to Recycle Bin: $old"
  }
}

Push-Location $root
try {
  Write-Host 'Rendering portraits...'
  pnpm assets:portraits
  pnpm check
} finally { Pop-Location }
Write-Host ''
Write-Host 'Done. Restart the booth with: pnpm dev:clean'
