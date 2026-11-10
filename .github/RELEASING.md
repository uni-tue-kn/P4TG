# P4TG release automation

Every successfully tested pull request merge on `main` is released by
[`release.yml`](workflows/release.yml). Direct pushes and fork workflows are not
eligible. The workflow performs these steps:

1. Verify that the exact SHA tested by the `Tests` workflow belongs to one
   merged pull request targeting this repository's `main` branch.
2. Determine the semantic-version bump and changelog category from labels.
3. Update `VERSION.md`, the controller and GUI package versions (including
   both lockfiles), the README badge, and `docs/CHANGELOG.md` in one generated
   release commit.
4. Push that commit and its `vX.Y.Z` tag atomically, build the controller image
   as both `unituekn/p4tg-controller:X.Y.Z` and `:latest`, then create or update
   the GitHub Release.

Entries under `## Unreleased` are promoted into the new version and copied to
the GitHub Release. The pull request title is also added as a release-facing
entry, so keep it concise and meaningful to users; its PR number and link are
appended automatically. A fresh empty `Unreleased` section is retained for the
next change. Do not also describe the same change under `Unreleased`, or it
appears twice in the release.

## Labels

All labels are optional. With no labels, the workflow makes a patch release and
places the entry under `Changes`.

| Purpose | Supported labels |
| --- | --- |
| Version bump (at most one) | `release:major`, `release:minor`, `release:patch` |
| Changelog category (at most one) | `changelog:feature`, `changelog:fix`, `changelog:change`, `changelog:security` |
| Force data-plane instructions | `release:data-plane` |

A change below `P4-Implementation/` is detected automatically. Such releases
include both Tofino 1 and Tofino 2 `make compile`/`make start` commands. The
override label is useful only when the changed-file path does not reveal that a
data-plane rebuild is necessary.

## Repository settings

- Install the dedicated `P4TG Release` GitHub App only on this repository, with
  read/write Contents and read Pull requests permissions. Store its App ID and
  private key as `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` Actions secrets.
  Add only this app to the bypass list for the `main` branch ruleset and, if
  present, the release-tag ruleset. The normal workflow token remains read-only.
- `DOCKER_USERNAME` and `DOCKER_PASSWORD` must be configured as Actions
  secrets for the stable controller image.
- Create the labels above in the repository if maintainers want to select
  non-default behavior. Missing labels do not block patch releases.

The release workflow uses a non-cancelling concurrency group. A rerun recognizes
its own release commit and tag and repairs the image or GitHub Release instead
of incrementing the version again. If `main` advances beyond the tested SHA
before a release is reserved, that stale run exits without changing anything.
The subsequent tested merge is then eligible; its release contains the stale
merge's changes, but that pull request's title is not added to the changelog.
Wait for the release of one merge before merging the next, or add the missing
entry under `Unreleased` by hand.

Retrying an older reserved release always repairs its versioned image and
release, but it does not move Docker's `latest` tag or GitHub's latest-release
marker backwards once a newer version is present on `main`.

Stable image publication does not happen on the initial `main` push: at that
point `VERSION.md` still contains the preceding version. The generated release
commit uses `[skip ci]`, and the stable image is built directly by `release.yml`
after the version is reserved. The conditional nightly-image job in `tests.yml`
publishes `:nightly` only after the complete test matrix passes on `nightly`.

## Dependency updates

Dependabot checks Cargo, npm, GitHub Actions, and Docker dependencies weekly.
Version-update pull requests target `nightly`. Patch and minor updates are
configured for squash auto-merge after all ruleset requirements pass; major
updates remain open for manual review. Dependabot security updates target the
default branch (`main`) and follow its normal review and release process.

Periodically promote the accumulated changes with a reviewed `nightly` to
`main` pull request. The normal release workflow makes the patch release after
that PR passes and is merged. Merge the generated release commit from `main`
back into `nightly` afterward so application versions and changelog history do
not diverge.

## Local validation

Run the deterministic release tests without publishing anything:

```bash
tests/ci/test-release.sh
```

`prepare-release.sh` also defaults to dry-run mode. Production explicitly uses
`--commit`; even then it only creates a local commit and tag. Network mutation
is confined to the release workflow's atomic `git push`, Docker push, and
`gh release` steps.
