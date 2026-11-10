#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: release-notes.sh --version X.Y.Z --output FILE [--data-plane-changed true|false] [--changelog FILE]\n'
}

die() {
  printf 'release-notes: %s\n' "$*" >&2
  exit 1
}

version=
output=
changelog=docs/CHANGELOG.md
data_plane_changed=false

while (($#)); do
  case "$1" in
    --version) version=${2:?}; shift 2 ;;
    --output) output=${2:?}; shift 2 ;;
    --changelog) changelog=${2:?}; shift 2 ;;
    --data-plane-changed) data_plane_changed=${2:?}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument '$1'" ;;
  esac
done

[[ $version =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] \
  || die '--version must be a stable semantic version'
[[ -n $output ]] || die '--output is required'
[[ -f $changelog ]] || die "changelog not found: $changelog"
[[ $data_plane_changed == true || $data_plane_changed == false ]] \
  || die '--data-plane-changed must be true or false'
section_count=$(grep -Ec "^## v${version//./\\.}([[:space:]]|$)" "$changelog" || true)
[[ $section_count -eq 1 ]] || die "expected exactly one changelog section for v$version"

section=$(mktemp /tmp/p4tg-ci-release-section-XXXXXX)
trap 'rm -f "$section"' EXIT
awk -v version="$version" '
  BEGIN { wanted = "## v" version }
  /^## / {
    if (copying) exit
    if ($0 == wanted || index($0, wanted " ") == 1) {
      copying = 1
      found = 1
      next
    }
  }
  copying { print }
  END { if (!found) exit 42 }
' "$changelog" > "$section"

{
  printf '# P4TG v%s\n\n' "$version"
  cat <<'EOF'
## Install

P4TG requires a configured Intel/Barefoot SDE with `SDE` and `SDE_INSTALL` exported.

```bash
git clone https://github.com/uni-tue-kn/P4TG.git
cd P4TG
sudo -E ./p4tg.sh --stable install
```

## Update

From an existing P4TG checkout:

```bash
sudo -E ./p4tg.sh --stable update
```
EOF

  if [[ $data_plane_changed == true ]]; then
    cat <<'EOF'

## Data-plane update

The P4 program changed in this release. `p4tg.sh update` recompiles it automatically. For a manual installation, rebuild and restart the matching target:

```bash
# Tofino 1
cd P4-Implementation
make compile TARGET=tofino
make start TARGET=tofino

# Tofino 2 (use instead of the Tofino 1 commands)
make compile TARGET=tofino2
make start TARGET=tofino2
```
EOF
  fi

  printf '\n## Changes\n\n'
  cat "$section"
} > "$output"
