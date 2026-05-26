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
} else {
    Write-Warning "Node.js not found; skipped JavaScript syntax validation"
}

if ($errors.Count -gt 0) {
    Write-Error ("Validation failed:`n" + ($errors -join "`n"))
}

Write-Host "All skills validated."
