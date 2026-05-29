param(
    [ValidateSet("codex", "claude", "openclaw", "all")]
    [string]$Target = "codex",
    [string]$TargetRoot = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$skillsRoot = Join-Path $repoRoot "skills"

function Get-DefaultTargetRoot {
    param([string]$Name)

    switch ($Name) {
        "codex" {
            $homeDir = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
            return (Join-Path $homeDir "skills")
        }
        "claude" {
            $homeDir = if ($env:CLAUDE_HOME) { $env:CLAUDE_HOME } else { Join-Path $HOME ".claude" }
            return (Join-Path $homeDir "skills")
        }
        "openclaw" {
            $homeDir = if ($env:OPENCLAW_HOME) { $env:OPENCLAW_HOME } else { Join-Path $HOME ".openclaw" }
            return (Join-Path $homeDir "skills")
        }
        default {
            throw "Unknown target: $Name"
        }
    }
}

function Install-IntoTarget {
    param(
        [string]$Name,
        [string]$Root
    )

    New-Item -ItemType Directory -Force -Path $Root | Out-Null

    Get-ChildItem -Path $skillsRoot -Directory | ForEach-Object {
        $skillMd = Join-Path $_.FullName "SKILL.md"
        if (-not (Test-Path $skillMd)) {
            Write-Warning "Skipping $($_.Name): SKILL.md not found"
            return
        }

        $target = Join-Path $Root $_.Name
        if (Test-Path $target) {
            Remove-Item -LiteralPath $target -Recurse -Force
        }

        Copy-Item -LiteralPath $_.FullName -Destination $Root -Recurse -Force
        Write-Host "Installed $($_.Name) -> $target"
    }

    Write-Host "Done installing for $Name. Restart the agent or refresh its skill list."
}

if (-not (Test-Path $skillsRoot)) {
    throw "skills directory not found: $skillsRoot"
}

if ($TargetRoot -and $Target -eq "all") {
    throw "-TargetRoot can only be used with a single target"
}

if ($Target -eq "all") {
    foreach ($name in @("codex", "claude", "openclaw")) {
        Install-IntoTarget -Name $name -Root (Get-DefaultTargetRoot $name)
    }
} else {
    $root = if ($TargetRoot) { $TargetRoot } else { Get-DefaultTargetRoot $Target }
    Install-IntoTarget -Name $Target -Root $root
}
