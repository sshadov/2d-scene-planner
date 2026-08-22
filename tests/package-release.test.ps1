$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$packager = Join-Path $repositoryRoot "scripts\package-release.ps1"
if (-not (Test-Path -LiteralPath $packager -PathType Leaf)) {
  throw "Release packager not found: $packager"
}

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testRoot = [IO.Path]::GetFullPath((Join-Path $tempBase ("scene-planner-package-test-" + [guid]::NewGuid().ToString("N"))))
if (-not $testRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe test output path: $testRoot"
}

New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
  & $packager -OutputDirectory $testRoot

  Add-Type -AssemblyName System.IO.Compression
  $expectations = @{
    "2D-Scene-Planner.zip" = @(
      "2D Scene Planner/app.js",
      "2D Scene Planner/d3plugin.json",
      "2D Scene Planner/designer-adapter.js",
      "2D Scene Planner/index.html",
      "2D Scene Planner/styles.css"
    )
    "2D-Scene-Planner-Offline.zip" = @(
      "2D Scene Planner Offline/app.js",
      "2D Scene Planner Offline/index.html",
      "2D Scene Planner Offline/styles.css"
    )
  }

  foreach ($archiveName in $expectations.Keys) {
    $archivePath = Join-Path $testRoot $archiveName
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
      throw "Expected archive was not created: $archiveName"
    }
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
      $actual = @($archive.Entries | ForEach-Object { $_.FullName } | Sort-Object)
      $expected = @($expectations[$archiveName] | Sort-Object)
      if (Compare-Object $expected $actual) {
        throw "Archive entries do not match the release whitelist: $archiveName"
      }
    }
    finally {
      $archive.Dispose()
    }
  }

  Write-Output "release packaging contract test: ok"
}
finally {
  if ((Test-Path -LiteralPath $testRoot) -and ([IO.Path]::GetFullPath($testRoot)).StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
    [IO.Directory]::Delete($testRoot, $true)
  }
}
