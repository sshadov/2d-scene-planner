param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectPath
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repositoryRoot "plugin"
$target = Join-Path $ProjectPath "plugins\2D Scene Planner"
$files = @("app.js", "d3plugin.json", "designer-adapter.js", "index.html", "styles.css")

if (-not (Test-Path -LiteralPath $ProjectPath -PathType Container)) {
  throw "Designer project folder not found: $ProjectPath"
}

New-Item -ItemType Directory -Path $target -Force | Out-Null

foreach ($name in $files) {
  $sourceFile = Join-Path $source $name
  $targetFile = Join-Path $target $name
  Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force

  $sourceHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash
  $targetHash = (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash
  if ($sourceHash -ne $targetHash) {
    throw "Plugin deployment verification failed: $name"
  }
}

Write-Output "Plugin deployed and verified: $target"
