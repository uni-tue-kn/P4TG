#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
tmp_root=$(mktemp -d /tmp/p4tg-ci-release-test-XXXXXX)
trap 'rm -rf "$tmp_root"' EXIT

fail() {
  printf 'release test: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  local needle=$1 file=$2
  grep -Fq -- "$needle" "$file" || fail "$file does not contain: $needle"
}

repo=$tmp_root/repo
mkdir -p "$repo/Controller" "$repo/docs" "$repo/Configuration GUI"
git -C "$repo" init -q -b main
git -C "$repo" config user.name test
git -C "$repo" config user.email test@example.invalid
printf '1.2.3\n' > "$repo/VERSION.md"
printf '# P4TG\n![Version](https://img.shields.io/badge/v-1.2.3-yellow)\n' > "$repo/README.md"
cat > "$repo/Controller/Cargo.toml" <<'EOF'
[package]
name = "p4tg-controller"
version = "1.2.3"
EOF
cat > "$repo/Configuration GUI/package.json" <<'EOF'
{
  "name": "frontend",
  "version": "1.2.3"
}
EOF
cat > "$repo/Configuration GUI/package-lock.json" <<'EOF'
{
  "name": "frontend",
  "version": "1.2.3",
  "lockfileVersion": 3,
  "packages": {
    "": {
      "name": "frontend",
      "version": "1.2.3"
    }
  }
}
EOF
cat > "$repo/docs/CHANGELOG.md" <<'EOF'
# Changelog

## v1.2.3
### Bug fixes
- Previous release.
EOF
git -C "$repo" add .
git -C "$repo" commit -qm initial
tested_sha=$(git -C "$repo" rev-parse HEAD)

cat > "$tmp_root/prs.json" <<EOF
[
  {
    "number": 17,
    "title": "Exercise release generation",
    "html_url": "https://github.com/uni-tue-kn/P4TG/pull/17",
    "merged_at": "2026-11-10T10:00:00Z",
    "merge_commit_sha": "$tested_sha",
    "base": {"ref": "main", "repo": {"full_name": "uni-tue-kn/P4TG"}},
    "labels": [{"name": "changelog:fix"}, {"name": "release:data-plane"}]
  }
]
EOF
printf 'P4-Implementation/traffic_gen.p4\nController/src/main.rs\n' > "$tmp_root/files.txt"

dry_output=$tmp_root/dry.out
RELEASE_DATE=2026-11-10 "$script_dir/prepare-release.sh" \
  --repo "$repo" --tested-sha "$tested_sha" --merged-prs "$tmp_root/prs.json" \
  --repository uni-tue-kn/P4TG --changed-files "$tmp_root/files.txt" \
  --dry-run --output "$dry_output" >/dev/null
assert_contains 'version=1.2.4' "$dry_output"
assert_contains 'data_plane_changed=true' "$dry_output"
[[ $(git -C "$repo" rev-parse HEAD) == "$tested_sha" ]] || fail 'dry-run created a commit'
[[ -z $(git -C "$repo" status --porcelain) ]] || fail 'dry-run changed files'

jq '.[0].labels += [{"name": "release:minor"}]' "$tmp_root/prs.json" > "$tmp_root/minor-pr.json"
minor_output=$tmp_root/minor.out
"$script_dir/prepare-release.sh" \
  --repo "$repo" --tested-sha "$tested_sha" --merged-prs "$tmp_root/minor-pr.json" \
  --repository uni-tue-kn/P4TG --dry-run --output "$minor_output" >/dev/null
assert_contains 'version=1.3.0' "$minor_output"

jq '.[0].labels += [{"name": "release:major"}]' "$tmp_root/prs.json" > "$tmp_root/major-pr.json"
major_output=$tmp_root/major.out
"$script_dir/prepare-release.sh" \
  --repo "$repo" --tested-sha "$tested_sha" --merged-prs "$tmp_root/major-pr.json" \
  --repository uni-tue-kn/P4TG --dry-run --output "$major_output" >/dev/null
assert_contains 'version=2.0.0' "$major_output"

output=$tmp_root/release.out
RELEASE_DATE=2026-11-10 "$script_dir/prepare-release.sh" \
  --repo "$repo" --tested-sha "$tested_sha" --merged-prs "$tmp_root/prs.json" \
  --repository uni-tue-kn/P4TG --changed-files "$tmp_root/files.txt" \
  --commit --output "$output" >/dev/null
release_commit=$(git -C "$repo" rev-parse HEAD)
[[ $release_commit != "$tested_sha" ]] || fail 'release commit was not created'
[[ $(git -C "$repo" rev-parse 'v1.2.4^{commit}') == "$release_commit" ]] || fail 'release tag is missing'
assert_contains '1.2.4' "$repo/VERSION.md"
assert_contains 'version = "1.2.4"' "$repo/Controller/Cargo.toml"
[[ $(jq -r '.version' "$repo/Configuration GUI/package.json") == 1.2.4 ]] \
  || fail 'frontend package version was not updated'
[[ $(jq -r '.version' "$repo/Configuration GUI/package-lock.json") == 1.2.4 ]] \
  || fail 'frontend lockfile version was not updated'
[[ $(jq -r '.packages[""].version' "$repo/Configuration GUI/package-lock.json") == 1.2.4 ]] \
  || fail 'frontend root lockfile package version was not updated'
assert_contains '## v1.2.4 — 2026-11-10' "$repo/docs/CHANGELOG.md"
assert_contains '### Bug fixes' "$repo/docs/CHANGELOG.md"
assert_contains '- Exercise release generation ([#17](https://github.com/uni-tue-kn/P4TG/pull/17))' "$repo/docs/CHANGELOG.md"

notes=$tmp_root/notes.md
"$script_dir/release-notes.sh" --version 1.2.4 --changelog "$repo/docs/CHANGELOG.md" \
  --data-plane-changed true --output "$notes"
assert_contains 'sudo -E ./p4tg.sh --stable install' "$notes"
assert_contains 'sudo -E ./p4tg.sh --stable update' "$notes"
assert_contains 'make compile TARGET=tofino' "$notes"
assert_contains 'make compile TARGET=tofino2' "$notes"
assert_contains 'Exercise release generation' "$notes"

idempotent=$tmp_root/idempotent.out
RELEASE_DATE=2026-11-10 "$script_dir/prepare-release.sh" \
  --repo "$repo" --tested-sha "$tested_sha" --merged-prs "$tmp_root/prs.json" \
  --repository uni-tue-kn/P4TG --changed-files "$tmp_root/files.txt" \
  --commit --output "$idempotent" >/dev/null
[[ $(git -C "$repo" rev-parse HEAD) == "$release_commit" ]] || fail 'idempotent retry created another commit'
assert_contains 'reused=true' "$idempotent"
assert_contains 'reserve_needed=false' "$idempotent"

notes_without_dp=$tmp_root/notes-no-dp.md
"$script_dir/release-notes.sh" --version 1.2.4 --changelog "$repo/docs/CHANGELOG.md" \
  --data-plane-changed false --output "$notes_without_dp"
if grep -Fq 'make compile TARGET=' "$notes_without_dp"; then
  fail 'non-data-plane notes contain manual make commands'
fi

mkdir -p "$tmp_root/bin"
cat > "$tmp_root/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$GH_LOG"
if [[ $1 == release && $2 == view ]]; then
  [[ ${GH_RELEASE_EXISTS:-false} == true ]]
fi
EOF
chmod +x "$tmp_root/bin/gh"

gh_log=$tmp_root/gh.log
GH_LOG=$gh_log PATH="$tmp_root/bin:$PATH" TAG=v1.2.4 VERSION=1.2.4 LATEST=false \
  RELEASE_NOTES=$notes "$script_dir/publish-release.sh"
assert_contains 'release create v1.2.4' "$gh_log"
assert_contains '--latest=false' "$gh_log"

: > "$gh_log"
GH_LOG=$gh_log GH_RELEASE_EXISTS=true PATH="$tmp_root/bin:$PATH" TAG=v1.2.4 VERSION=1.2.4 \
  LATEST=false RELEASE_NOTES=$notes "$script_dir/publish-release.sh"
assert_contains 'release edit v1.2.4' "$gh_log"
if grep -Eq '(^| )--latest($| )' "$gh_log"; then
  fail 'repairing an older release moved the latest marker'
fi

: > "$gh_log"
GH_LOG=$gh_log GH_RELEASE_EXISTS=true PATH="$tmp_root/bin:$PATH" TAG=v1.2.4 VERSION=1.2.4 \
  LATEST=true RELEASE_NOTES=$notes "$script_dir/publish-release.sh"
assert_contains '--latest' "$gh_log"

printf 'release automation tests passed\n'
