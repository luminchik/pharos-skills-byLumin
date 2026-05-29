#!/usr/bin/env bash
set -euo pipefail

target="${1:-codex}"
custom_root="${2:-}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skills_root="$repo_root/skills"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/install-skills.sh [codex|claude|openclaw|all] [target_root]

Examples:
  ./scripts/install-skills.sh codex
  ./scripts/install-skills.sh claude
  ./scripts/install-skills.sh openclaw
  ./scripts/install-skills.sh all
EOF
}

default_target_root() {
  case "$1" in
    codex)
      echo "${CODEX_HOME:-$HOME/.codex}/skills"
      ;;
    claude)
      echo "${CLAUDE_HOME:-$HOME/.claude}/skills"
      ;;
    openclaw)
      echo "${OPENCLAW_HOME:-$HOME/.openclaw}/skills"
      ;;
    *)
      echo "Unknown target: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
}

install_into_target() {
  local name="$1"
  local target_root="$2"

  mkdir -p "$target_root"

  for skill_dir in "$skills_root"/*; do
    [ -d "$skill_dir" ] || continue
    [ -f "$skill_dir/SKILL.md" ] || {
      echo "Skipping $(basename "$skill_dir"): SKILL.md not found" >&2
      continue
    }

    local target="$target_root/$(basename "$skill_dir")"
    rm -rf "$target"
    cp -R "$skill_dir" "$target_root/"
    echo "Installed $(basename "$skill_dir") -> $target"
  done

  echo "Done installing for $name. Restart the agent or refresh its skill list."
}

[ -d "$skills_root" ] || {
  echo "skills directory not found: $skills_root" >&2
  exit 1
}

case "$target" in
  codex|claude|openclaw)
    install_into_target "$target" "${custom_root:-$(default_target_root "$target")}"
    ;;
  all)
    [ -z "$custom_root" ] || {
      echo "target_root can only be used with a single target" >&2
      exit 1
    }
    for name in codex claude openclaw; do
      install_into_target "$name" "$(default_target_root "$name")"
    done
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown target: $target" >&2
    usage >&2
    exit 1
    ;;
esac
