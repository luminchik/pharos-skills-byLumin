#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skills_root="$repo_root/skills"
target_root="${CODEX_HOME:-$HOME/.codex}/skills"

mkdir -p "$target_root"

for skill_dir in "$skills_root"/*; do
  [ -d "$skill_dir" ] || continue
  [ -f "$skill_dir/SKILL.md" ] || {
    echo "Skipping $(basename "$skill_dir"): SKILL.md not found" >&2
    continue
  }

  target="$target_root/$(basename "$skill_dir")"
  rm -rf "$target"
  cp -R "$skill_dir" "$target_root/"
  echo "Installed $(basename "$skill_dir") -> $target"
done

echo "Done. Restart Codex or run /skills to refresh the skill list."

