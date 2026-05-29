$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$manifestPath = Join-Path $repoRoot "shared\assets\asset-drift.json"

if (-not (Test-Path $manifestPath)) {
    throw "asset drift manifest not found: $manifestPath"
}

$manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json

foreach ($group in $manifest.groups) {
    $canonical = Join-Path $repoRoot $group.canonical
    if (-not (Test-Path $canonical)) {
        throw "canonical asset not found: $($group.canonical)"
    }

    foreach ($copy in $group.copies) {
        $target = Join-Path $repoRoot $copy
        $targetDir = Split-Path -Parent $target
        New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
        Copy-Item -LiteralPath $canonical -Destination $target -Force
        Write-Host "Synced $($group.canonical) -> $copy"
    }
}
