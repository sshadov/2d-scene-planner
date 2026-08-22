param(
  [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) "dist")
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null

Add-Type -AssemblyName System.IO.Compression

function Write-ReleaseArchive {
  param(
    [string]$ArchiveName,
    [string]$RootFolder,
    [System.Collections.IDictionary]$Files
  )

  $archivePath = Join-Path $outputPath $ArchiveName
  if (Test-Path -LiteralPath $archivePath) {
    [IO.File]::Delete($archivePath)
  }

  $fileStream = [IO.File]::Open($archivePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $archive = [IO.Compression.ZipArchive]::new($fileStream, [IO.Compression.ZipArchiveMode]::Create, $false)
    try {
      foreach ($entryName in $Files.Keys) {
        $sourcePath = Join-Path $repositoryRoot $Files[$entryName]
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
          throw "Release source file not found: $sourcePath"
        }
        $entryPath = "$RootFolder/$entryName"
        $entry = $archive.CreateEntry($entryPath, [IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        $sourceStream = [IO.File]::OpenRead($sourcePath)
        try {
          $sourceStream.CopyTo($entryStream)
        }
        finally {
          $sourceStream.Dispose()
          $entryStream.Dispose()
        }
      }
    }
    finally {
      $archive.Dispose()
    }
  }
  finally {
    $fileStream.Dispose()
  }

  Get-Item -LiteralPath $archivePath
}

$pluginFiles = [ordered]@{
  "app.js" = "plugin\app.js"
  "d3plugin.json" = "plugin\d3plugin.json"
  "designer-adapter.js" = "plugin\designer-adapter.js"
  "index.html" = "plugin\index.html"
  "styles.css" = "plugin\styles.css"
}

$offlineFiles = [ordered]@{
  "app.js" = "plugin\app.js"
  "index.html" = "plugin\offline.html"
  "styles.css" = "plugin\styles.css"
}

$archives = @(
  Write-ReleaseArchive -ArchiveName "2D-Scene-Planner.zip" -RootFolder "2D Scene Planner" -Files $pluginFiles
  Write-ReleaseArchive -ArchiveName "2D-Scene-Planner-Offline.zip" -RootFolder "2D Scene Planner Offline" -Files $offlineFiles
)

$archives | ForEach-Object { Write-Output "Created $($_.FullName) ($($_.Length) bytes)" }
