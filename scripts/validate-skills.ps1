$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$skillsRoot = Join-Path $repoRoot "skills"
$errors = New-Object System.Collections.Generic.List[string]

if (-not (Test-Path $skillsRoot)) {
    throw "skills directory not found: $skillsRoot"
}

Get-ChildItem -Path $skillsRoot -Directory | Sort-Object Name | ForEach-Object {
    $skillName = $_.Name
    $skillMd = Join-Path $_.FullName "SKILL.md"

    if (-not (Test-Path $skillMd)) {
        $errors.Add("${skillName}: missing SKILL.md")
        return
    }

    $content = Get-Content -Raw -Path $skillMd
    if (-not $content.StartsWith("---")) {
        $errors.Add("${skillName}: missing YAML frontmatter")
        return
    }

    $match = [regex]::Match($content, "(?ms)^---\s*.*?^name:\s*(?<name>[A-Za-z0-9_.-]+)\s*.*?^description:\s*(?<description>.+?)^---")
    if (-not $match.Success) {
        $errors.Add("${skillName}: frontmatter must include name and description")
        return
    }

    $frontmatterName = $match.Groups["name"].Value.Trim()
    if ($frontmatterName -ne $skillName) {
        $errors.Add("${skillName}: frontmatter name '$frontmatterName' does not match folder")
    }

    Write-Host "OK metadata: $skillName"
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    Get-ChildItem -Path $skillsRoot -Recurse -Filter "*.mjs" | Sort-Object FullName | ForEach-Object {
        & node --check $_.FullName | Out-Null
        if ($LASTEXITCODE -ne 0) {
            $errors.Add("node --check failed: $($_.FullName)")
        } else {
            Write-Host "OK js: $($_.FullName.Substring($repoRoot.Path.Length + 1))"
        }
    }

    Get-ChildItem -Path $skillsRoot -Recurse -Filter "*.mjs" |
        Where-Object { $_.FullName -notmatch "\\lib\\" } |
        Sort-Object FullName |
        ForEach-Object {
            $content = Get-Content -Raw -Path $_.FullName
            if ($content -match "args\.help|args\.h|--help") {
                & node $_.FullName --help | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    $errors.Add("help smoke failed: $($_.FullName)")
                } else {
                    Write-Host "OK help: $($_.FullName.Substring($repoRoot.Path.Length + 1))"
                }
            }
        }
} else {
    Write-Warning "Node.js not found; skipped JavaScript syntax validation"
}

$assetManifest = Join-Path $repoRoot "shared\assets\asset-drift.json"
if (Test-Path $assetManifest) {
    $manifest = Get-Content -Raw -Path $assetManifest | ConvertFrom-Json
    foreach ($group in $manifest.groups) {
        $canonical = Join-Path $repoRoot $group.canonical
        if (-not (Test-Path $canonical)) {
            $errors.Add("canonical asset missing: $($group.canonical)")
            continue
        }
        $canonicalHash = (Get-FileHash -Algorithm SHA256 -Path $canonical).Hash
        foreach ($copy in $group.copies) {
            $copyPath = Join-Path $repoRoot $copy
            if (-not (Test-Path $copyPath)) {
                $errors.Add("asset copy missing: $copy")
                continue
            }
            $copyHash = (Get-FileHash -Algorithm SHA256 -Path $copyPath).Hash
            if ($copyHash -ne $canonicalHash) {
                $errors.Add("asset drift: $copy differs from $($group.canonical). Run scripts\sync-shared-assets.ps1")
            } else {
                Write-Host "OK asset: $copy"
            }
        }
    }
}

$secretFile = Join-Path $HOME ".codex\secrets\pharos_private_key.txt"
if (Test-Path $secretFile) {
    $secret = (Get-Content -Raw -Path $secretFile).Trim()
    if ($secret) {
        $scanFiles = Get-ChildItem -Path $repoRoot -Recurse -File |
            Where-Object { $_.FullName -notmatch "\\.git\\|\\out\\" }
        $hits = $scanFiles | Select-String -SimpleMatch $secret -ErrorAction SilentlyContinue
        if ($hits) {
            foreach ($hit in $hits) {
                $errors.Add("secret hit: $($hit.Path):$($hit.LineNumber)")
            }
        } else {
            Write-Host "OK secret scan: local private key not found in repo files"
        }
    }
}

if ($errors.Count -gt 0) {
    Write-Error ("Validation failed:`n" + ($errors -join "`n"))
}

Write-Host "All skills validated."
