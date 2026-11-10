#!/usr/bin/env bash
set -euo pipefail

: "${TAG:?TAG must be set}"
: "${VERSION:?VERSION must be set}"
: "${LATEST:?LATEST must be set}"
: "${RELEASE_NOTES:?RELEASE_NOTES must be set}"

[[ $LATEST == true || $LATEST == false ]] || {
  printf 'publish-release: LATEST must be true or false\n' >&2
  exit 1
}

[[ -s $RELEASE_NOTES ]] || {
  printf 'publish-release: release notes are empty: %s\n' "$RELEASE_NOTES" >&2
  exit 1
}

if gh release view "$TAG" >/dev/null 2>&1; then
  edit=(gh release edit "$TAG" --title "P4TG v$VERSION" --notes-file "$RELEASE_NOTES")
  if [[ $LATEST == true ]]; then
    edit+=(--latest)
  fi
  "${edit[@]}"
else
  gh release create "$TAG" --verify-tag --title "P4TG v$VERSION" \
    --notes-file "$RELEASE_NOTES" --latest="$LATEST"
fi
