#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: prepare-release.sh --tested-sha SHA --merged-prs FILE --repository OWNER/REPO
                          [--changed-files FILE] [--output FILE]
                          [--dry-run | --apply | --commit] [--repo DIR]

Derive the next P4TG version from the merged PR, generate its changelog entry,
and optionally create the release commit and tag. The default is --dry-run.
EOF
}

die() {
  printf 'prepare-release: %s\n' "$*" >&2
  exit 1
}

emit() {
  local key=$1 value=${2-}
  printf '%s=%s\n' "$key" "$value"
  if [[ -n "$output_file" ]]; then
    printf '%s=%s\n' "$key" "$value" >> "$output_file"
  fi
}

valid_semver() {
  [[ $1 =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
}

bump_version() {
  local version=$1 bump=$2 major minor patch
  IFS=. read -r major minor patch <<< "$version"
  case "$bump" in
    major) printf '%d.0.0\n' "$((major + 1))" ;;
    minor) printf '%d.%d.0\n' "$major" "$((minor + 1))" ;;
    patch) printf '%d.%d.%d\n' "$major" "$minor" "$((patch + 1))" ;;
    *) die "unsupported version bump '$bump'" ;;
  esac
}

append_release_body() {
  local source=$1 heading=$2 title=$3 number=$4 url=$5 line inserted=false
  if grep -Fxq "### $heading" "$source"; then
    while IFS= read -r line || [[ -n $line ]]; do
      printf '%s\n' "$line"
      if [[ $inserted == false && $line == "### $heading" ]]; then
        printf -- '- %s ([#%s](%s))\n' "$title" "$number" "$url"
        inserted=true
      fi
    done < "$source"
  else
    printf '### %s\n' "$heading"
    printf -- '- %s ([#%s](%s))\n\n' "$title" "$number" "$url"
    cat "$source"
  fi
}

update_release_files() {
  local old=$1 new=$2 heading=$3 title=$4 number=$5 url=$6 released_on=$7
  local tmp unreleased_body history unreleased_count

  [[ $(head -n 1 docs/CHANGELOG.md) == '# Changelog '* || $(head -n 1 docs/CHANGELOG.md) == '# Changelog' ]] \
    || die 'docs/CHANGELOG.md does not start with the expected title'
  if grep -Eq "^## v?${new//./\\.}([[:space:]]|$)" docs/CHANGELOG.md; then
    die "docs/CHANGELOG.md already contains a section for $new"
  fi

  printf '%s\n' "$new" > VERSION.md

  tmp=$(mktemp /tmp/p4tg-ci-release-cargo-XXXXXX)
  sed -E "0,/^version = \"${old//./\\.}\"$/s//version = \"$new\"/" Controller/Cargo.toml > "$tmp"
  grep -Fxq "version = \"$new\"" "$tmp" || die 'could not update Controller/Cargo.toml'
  chmod --reference=Controller/Cargo.toml "$tmp"
  mv "$tmp" Controller/Cargo.toml

  # Keep the lockfile's own package entry in step, or --locked builds fail.
  tmp=$(mktemp /tmp/p4tg-ci-release-cargo-lock-XXXXXX)
  sed -E "/^name = \"p4tg-controller\"$/{n;s/^version = \"${old//./\\.}\"$/version = \"$new\"/}" \
    Controller/Cargo.lock > "$tmp"
  [[ $(grep -A1 '^name = "p4tg-controller"$' "$tmp" | tail -n 1) == "version = \"$new\"" ]] \
    || die 'could not update Controller/Cargo.lock'
  chmod --reference=Controller/Cargo.lock "$tmp"
  mv "$tmp" Controller/Cargo.lock

  for manifest in 'Configuration GUI/package.json' 'Configuration GUI/package-lock.json'; do
    tmp=$(mktemp /tmp/p4tg-ci-release-package-XXXXXX)
    if [[ $manifest == *package-lock.json ]]; then
      jq --arg version "$new" '.version = $version | .packages[""].version = $version' \
        "$manifest" > "$tmp"
    else
      jq --arg version "$new" '.version = $version' "$manifest" > "$tmp"
    fi
    [[ $(jq -r '.version' "$tmp") == "$new" ]] \
      || die "could not update $manifest"
    chmod --reference="$manifest" "$tmp"
    mv "$tmp" "$manifest"
  done

  tmp=$(mktemp /tmp/p4tg-ci-release-readme-XXXXXX)
  sed -E "s#(!\[Version\]\(https://img\.shields\.io/badge/v-)${old//./\\.}(-yellow\))#\\1$new\\2#" README.md > "$tmp"
  grep -Fq "![Version](https://img.shields.io/badge/v-$new-yellow)" "$tmp" \
    || die 'could not update the README version badge'
  chmod --reference=README.md "$tmp"
  mv "$tmp" README.md

  unreleased_count=$(grep -Eci '^## [Uu]nreleased[[:space:]]*$' docs/CHANGELOG.md || true)
  (( unreleased_count <= 1 )) || die 'docs/CHANGELOG.md contains multiple Unreleased sections'
  tmp=$(mktemp /tmp/p4tg-ci-release-changelog-XXXXXX)
  unreleased_body=$(mktemp /tmp/p4tg-ci-release-unreleased-XXXXXX)
  history=$(mktemp /tmp/p4tg-ci-release-history-XXXXXX)

  if (( unreleased_count == 1 )); then
    awk '
      /^## [Uu]nreleased[[:space:]]*$/ { copying = 1; next }
      copying && /^## / { exit }
      copying { print }
    ' docs/CHANGELOG.md > "$unreleased_body"
    awk '
      NR == 1 { next }
      /^## [Uu]nreleased[[:space:]]*$/ { skipping = 1; next }
      skipping && /^## / { skipping = 0 }
      !skipping { print }
    ' docs/CHANGELOG.md > "$history"
  else
    tail -n +2 docs/CHANGELOG.md > "$history"
  fi

  {
    IFS= read -r first_line
    printf '%s\n\n' "$first_line"
    printf '## Unreleased\n\n'
    printf '## v%s — %s\n' "$new" "$released_on"
    append_release_body "$unreleased_body" "$heading" "$title" "$number" "$url"
    cat "$history"
  } < docs/CHANGELOG.md > "$tmp"
  chmod --reference=docs/CHANGELOG.md "$tmp"
  mv "$tmp" docs/CHANGELOG.md
  rm -f "$unreleased_body" "$history"
}

validate_release_commit() {
  local candidate=$1 tested=$2 version=$3 expected_files actual_files subject body
  [[ $(git show -s --format=%P "$candidate") == "$tested" ]] || return 1
  subject=$(git show -s --format=%s "$candidate")
  body=$(git show -s --format=%B "$candidate")
  [[ $subject == "release: v$version [skip ci]" ]] || return 1
  grep -Fxq "P4TG-Release-Of: $tested" <<< "$body" || return 1
  grep -Fxq "P4TG-Release-Version: $version" <<< "$body" || return 1
  [[ $(git show "$candidate:VERSION.md" | tr -d '[:space:]') == "$version" ]] || return 1

  expected_files=$'Configuration GUI/package-lock.json\nConfiguration GUI/package.json\nController/Cargo.lock\nController/Cargo.toml\nREADME.md\nVERSION.md\ndocs/CHANGELOG.md'
  actual_files=$(git diff --name-only "$tested" "$candidate" | sort)
  [[ $actual_files == "$expected_files" ]]
}

repo=.
tested_sha=
merged_prs=
repository=
changed_files=
output_file=
mode=dry-run

while (($#)); do
  case "$1" in
    --repo) repo=${2:?}; shift 2 ;;
    --tested-sha) tested_sha=${2:?}; shift 2 ;;
    --merged-prs) merged_prs=${2:?}; shift 2 ;;
    --repository) repository=${2:?}; shift 2 ;;
    --changed-files) changed_files=${2:?}; shift 2 ;;
    --output) output_file=${2:?}; shift 2 ;;
    --dry-run) mode=dry-run; shift ;;
    --apply) mode=apply; shift ;;
    --commit) mode=commit; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument '$1'" ;;
  esac
done

[[ $tested_sha =~ ^[0-9a-f]{40}$ ]] || die '--tested-sha must be a full lowercase commit SHA'
[[ -f $merged_prs ]] || die '--merged-prs must name a readable JSON file'
[[ $repository =~ ^[^/]+/[^/]+$ ]] || die '--repository must be OWNER/REPO'
[[ -z $changed_files || -f $changed_files ]] || die '--changed-files must name a readable file'
command -v jq >/dev/null || die 'jq is required'

cd "$repo"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$repo is not a Git worktree"
git cat-file -e "$tested_sha^{commit}" 2>/dev/null || die "tested commit $tested_sha is unavailable"
[[ -z $(git status --porcelain --untracked-files=no) ]] \
  || die 'release preparation requires a clean tracked worktree'

pr=$(jq -c --arg sha "$tested_sha" --arg repository "$repository" '
  [ .[] | select(
      .merged_at != null and
      .merge_commit_sha == $sha and
      .base.ref == "main" and
      .base.repo.full_name == $repository
    ) ] | unique_by(.number) |
  if length == 1 then .[0] else empty end
' "$merged_prs")

if [[ -z $pr ]]; then
  emit ready false
  emit reason 'tested commit is not exactly one associated merged PR on main'
  exit 0
fi

pr_number=$(jq -r '.number' <<< "$pr")
pr_title=$(jq -r '.title | gsub("[\\r\\n\\t]+"; " ") | gsub("  +"; " ")' <<< "$pr")
pr_url=$(jq -r '.html_url' <<< "$pr")
[[ -n $pr_title && $pr_title != null ]] || die 'the merged PR has no title'
[[ $pr_url == "https://github.com/$repository/pull/$pr_number" ]] \
  || die 'the merged PR URL does not match the repository and PR number'

mapfile -t bump_labels < <(jq -r '.labels[].name | select(test("^release:(major|minor|patch)$"))' <<< "$pr")
(( ${#bump_labels[@]} <= 1 )) || die 'a PR may have at most one release:major/minor/patch label'
bump='patch'
if (( ${#bump_labels[@]} == 1 )); then
  bump=${bump_labels[0]#release:}
fi

mapfile -t changelog_labels < <(jq -r '.labels[].name | select(test("^changelog:(feature|fix|change|security)$"))' <<< "$pr")
(( ${#changelog_labels[@]} <= 1 )) || die 'a PR may have at most one changelog category label'
category=Changes
if (( ${#changelog_labels[@]} == 1 )); then
  case ${changelog_labels[0]} in
    changelog:feature) category='New features' ;;
    changelog:fix) category='Bug fixes' ;;
    changelog:change) category='Changes' ;;
    changelog:security) category='Security' ;;
  esac
fi

data_plane_changed=false
if [[ -n $changed_files ]] && grep -Eq '^P4-Implementation/' "$changed_files"; then
  data_plane_changed=true
elif jq -e '.labels[].name | select(. == "release:data-plane")' <<< "$pr" >/dev/null; then
  data_plane_changed=true
fi

current_version=$(git show "$tested_sha:VERSION.md" | tr -d '[:space:]')
valid_semver "$current_version" || die "VERSION.md at the tested commit is not a stable semantic version: $current_version"
version=$(bump_version "$current_version" "$bump")
tag=v$version
head=$(git rev-parse HEAD)
release_commit=
reserve_needed=false
reused=false

if git rev-parse --verify --quiet "refs/tags/$tag^{commit}" >/dev/null; then
  release_commit=$(git rev-parse "refs/tags/$tag^{commit}")
  validate_release_commit "$release_commit" "$tested_sha" "$version" \
    || die "existing tag $tag does not reserve this tested merge"
  if [[ $mode == commit && $head != "$release_commit" ]]; then
    git checkout --detach "$release_commit"
  fi
  reused=true
elif [[ $head != "$tested_sha" ]]; then
  if validate_release_commit "$head" "$tested_sha" "$version"; then
    release_commit=$head
    reserve_needed=true
    reused=true
    if [[ $mode == commit ]]; then
      git tag "$tag" "$release_commit"
    fi
  else
    emit ready false
    emit reason 'main has advanced beyond the tested merge'
    exit 0
  fi
elif [[ $mode == dry-run ]]; then
  :
else
  released_on=${RELEASE_DATE:-$(date -u +%F)}
  update_release_files "$current_version" "$version" "$category" "$pr_title" "$pr_number" "$pr_url" "$released_on"
  if [[ $mode == commit ]]; then
    git add VERSION.md README.md Controller/Cargo.toml Controller/Cargo.lock \
      'Configuration GUI/package.json' 'Configuration GUI/package-lock.json' \
      docs/CHANGELOG.md
    git -c user.name=github-actions\[bot\] \
      -c user.email=41898282+github-actions\[bot\]@users.noreply.github.com \
      commit -m "release: v$version [skip ci]" \
      -m "P4TG-Release-Of: $tested_sha" \
      -m "P4TG-Release-Version: $version"
    release_commit=$(git rev-parse HEAD)
    git tag "$tag" "$release_commit"
    reserve_needed=true
  fi
fi

emit ready true
emit reason ''
emit version "$version"
emit tag "$tag"
emit commit "$release_commit"
emit reserve_needed "$reserve_needed"
emit reused "$reused"
emit data_plane_changed "$data_plane_changed"
emit pr_number "$pr_number"
emit bump "$bump"
emit changelog_category "$category"
