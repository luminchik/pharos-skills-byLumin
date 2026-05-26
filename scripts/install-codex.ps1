$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$skillsRoot = Join-Path $repoRoot "skills"
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
$targetRoot = Join-Path $codexHome "skills"

New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null

Get-ChildItem -Path $skillsRoot -Directory | ForEach-Object {
    $skillMd = Join-Path $_.FullName "SKILL.md"
    if (-not (Test-Path $skillMd)) {
        Write-Warning "Skipping $($_.Name): SKILL.md not found"
        return
    }

    $target = Join-Path $targetRoot $_.Name
    if (Test-Path $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }

    Copy-Item -LiteralPath $_.FullName -Destination $targetRoot -Recurse -Force
    Write-Host "Installed $($_.Name) -> $target"
}

Write-Host "Done. Restart Codex or run /skills to refresh the skill list."

