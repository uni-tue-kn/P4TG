# P4TG test infrastructure

## Status

The mandatory software-model feasibility spike passes on both targets. Tofino
2 requires a much lower offered load than Tofino 1: at 0.001 Gbit/s its
simulated clock falls far enough behind wall time that digest batches arrive
after the controller watchdog interval. The smoke test therefore defaults to
0.00001 Gbit/s on Tofino 2 and 0.001 Gbit/s on Tofino 1.

## Feasibility spike

Build the test controller image once, then run either target. Docker access is
required; no host ports are published.

```console
tests/ci/build-controller-image.sh
tests/ci/model-smoke.sh tofino
tests/ci/model-smoke.sh tofino2
```

The rate and observation window can be overridden for diagnostics:

```console
P4TG_SMOKE_RATE=0.00001 P4TG_SMOKE_WAIT=25 tests/ci/model-smoke.sh tofino2
```

To reuse an existing bundle and avoid recompilation:

```console
tests/ci/model-smoke.sh tofino /tmp/p4tg-ci-.../bundle
```

`compile-p4.sh` can also be called independently:

```console
out=$(mktemp -d /tmp/p4tg-ci-compile-XXXXXX)
tests/ci/compile-p4.sh tofino "$out"
```

All containers use a `p4tg-ci-` prefix. Model, switchd, and controller share an
isolated network namespace. Every channel of four-way front-panel ports 1 and 2
is connected by a veth pair. Every channel of each manual recirculation port
uses a one-port Linux bridge with hairpin mode to emulate same-port loopback.

## Model capabilities & limitations

| Capability | Tofino 1 | Tofino 2 |
|---|---|---|
| P4 compile | Pass | Pass |
| Model and `bf_switchd` startup | Pass | Pass |
| Controller startup and ASIC detection | Pass | Pass |
| Explicit `config.json` port settings and manual TX/RX recirculation | Pass | Pass |
| Breakout mapping | Pass (2-way `0,2`; 4-way `0,1,2,3`) | Pass (2-way `0,4`; 4-way `0,2,4,6`; 8-way `0`–`7`) |
| Port update, invalid-combination rejection, and per-channel ARP | Pass | Pass |
| `GET /api/online` and `GET /api/ports` | Pass | Pass |
| pktgen at stable smoke rate | Pass (0.001 Gbit/s) | Pass (0.00001 Gbit/s) |
| 1-to-2 veth forwarding | Pass | Pass |
| frame-size/type counters | Pass | Pass |
| `monitor_t` / `iat_rtt_monitor_t` digests | Pass | Pass |
| digest watchdog after 10 seconds | `digests_alive: true` | `digests_alive: true` |

The UniCorn DMA preload is required. Without external recirculation, MAC-near
loopback re-enters the Tofino 1 model on internal device port 68 rather than the
configured front-panel device port 8, so P4TG's recirculation rules never match.
The test-only `P4TG_EXTERNAL_RECIRCULATION=1` option leaves those ports in normal
mode and lets Docker emulate the hardware loopback behavior. The option is off
by default and therefore does not change hardware startup.

At 0.001 Gbit/s the Tofino 2 software model accumulates a substantial
processing backlog. At its 0.00001 Gbit/s smoke rate, the observed Tofino 2
TX/RX frame-size counts were both 198 after 25 seconds and both digest filters
were draining regularly. Counter presence and growth are testable, but the
following remain unsuitable as accuracy assertions on the model:

- rate accuracy;
- equality of instantaneous TX and RX counts or zero loss at a wall-clock
  sampling point;
- RTT and IAT values;
- physical link status and port speed behavior.

### Tofino 2 digest investigation

At 0.001 Gbit/s, an extended Tofino 2 probe produced 432 TX and 230 RX
frame-size samples and triggered the controller watchdog:

```text
No digests received from the switch for 11s. Statistics are stale; restart the controller if this persists.
```

This was initially mistaken for a broken Tofino 2 digest path. The model trace
shows the real behavior: it creates 124 learn quanta, but the first batch drain
does not occur until about 13 wall-clock seconds later. Subsequent drains are
roughly 12 seconds apart. The learn timeout is based on simulated time; the
model is overloaded and advances that clock much more slowly than wall time,
while the controller watchdog correctly uses wall time.

The digest mechanism was isolated from P4TG with a minimal T2NA program and a
Rust `rbfrt` listener. The zero-argument `Digest()` constructor delivered seven
digests from seven injected frames. A two-filter variant using P4TG's
`iat_rtt_monitor_t` layout also passed, as did the complete P4TG pipeline when
forced to emit a known digest for each injected frame. Thus the SDK compiler,
model DMA preload, BfRt server, schema, and Rust client all support Tofino 2
digests.

With the unmodified P4TG program at 0.00001 Gbit/s, the two model filters
recorded 67 and 69 learns and 23 and 24 drains, respectively. The controller
reported `"digests_alive":true`, populated RTT samples, and observed matching
TX/RX counts. No P4 product change is required.

## Test plan

| Test | Layer | Value |
|---|---|---|
| Controller's 3,653 existing Rust tests | controller | Predominantly generated rate-solver cases, plus existing module-level behavior |
| Twenty-four endpoint/response/OpenAPI checks | API/model | Detect route removal, response-shape changes, port/ARP mutation failures, invalid port combinations, crashes, and payload/schema drift |
| Fifty-two named validation regressions | API/model | Exercise real deserialization and semantic validation, including exact 400/422 behavior |
| Eight controller orchestration lifecycle scenarios | API/model | Natural duration/drain completion, duration-zero and stale-monitor replacement, multi-test repetitions/history, skip vs. stop, rejected-request preservation, cooldown cancellation, and idle/active/multi-test restart behavior |
| Breakout and manual recirculation startup | API/model | Programs valid T1 2/4-way and T2 2/4/8-way mappings, verifies explicit speed/FEC/autoneg/MAC settings, and rejects duplicate or traffic-port-overlapping manual TX/RX recirculation ports |
| CBR loopback with counter, digest, histogram, loss, and ordering assertions | model | Complete controller/P4/model/DMA path |
| Mpps, Poisson, Analyze, multiple-stream, per-stream RX, and rejected-request lifecycle | model | Programming paths beyond CBR and proof that invalid requests preserve live traffic |
| IPv4, IPv6, VLAN, QinQ, MPLS, VxLAN, GTP-U, and T2 SRv6 payload lifecycles | model | Exercise controller-to-P4 header programming for every supported profile |
| Direct `rbfrt` table read after controller shutdown | model/BfRt | Verify schema and table access without the REST facade |
| Fifty-six Vitest component/logic tests | GUI | Validators, migrations, full settings/result import-export, tabs, protocol forms, ports/error and retry paths, running state, results/report contracts, rate/IMIX logic, and polling |
| Three Playwright Chromium flows | GUI/browser | Actual JSON download/re-import, rejected-to-successful start lifecycle, and responsive offline behavior |
| Tofino and Tofino 2 compilation | P4 | Compiler and target-specific source coverage |

The OpenAPI check intentionally compares the independently maintained test
payload model with the served schema at the public boundary. It checks that
`TrafficGenData` and all exercised paths remain published. Runtime POSTs then
catch field-level incompatibilities that a schema-name check cannot.

## Running tests

The complete local suite is one command. It builds both P4 targets and runs two
isolated software-model instances sequentially; expect the SDK/compiler and
model portion to take several minutes.

```console
tests/ci/run-all.sh
```

Focused jobs use the exact entrypoints called by GitHub Actions:

```console
tests/ci/controller.sh
tests/ci/gui.sh
tests/ci/test-release.sh
tests/ci/compile-p4.sh tofino /tmp/p4tg-ci-t1
tests/ci/model-smoke.sh tofino /tmp/p4tg-ci-t1
```

Temporary build/results directories are created only below `/tmp/p4tg-ci-*`.
No ports are published to the host. The model, switchd, controller, and Rust
runner share one container network namespace.

GitHub Actions splits this into `controller`, `gui`, `p4-compile`, and
`model-e2e-regression` jobs. The GUI job runs coverage plus Playwright against
a preview server on a random high localhost port. Both P4/model jobs are target
matrices. The SDK is pinned by digest, and the model job removes that compiler
image on the disposable hosted runner before loading the model runtime to stay
within the runner disk limit. Workflow syntax is checked locally with
`actionlint`.

The stable release workflow is documented in [`.github/RELEASING.md`](../.github/RELEASING.md).
After a successfully tested merged PR on `main`, it derives the semantic bump
from labels (patch by default), writes the PR title into `docs/CHANGELOG.md`,
updates all application version manifests, atomically reserves the release
commit/tag, publishes the versioned controller image, and creates the GitHub
Release. Release notes always contain install/update instructions and include
both targets' manual `make compile`/`make start` commands when the data plane
changed. `tests/ci/test-release.sh` validates generation and retry behavior
without using the network.

### Known open issues

`npm audit` reports two high-severity findings in the existing preview-server
dependency chain: `serve` pulls `compression <1.8.2` (GHSA-vc2v-76pw-4v95).
The advisory's automatic fix is a semver-major downgrade of `serve`; the test
work does not silently change that product dependency. The production GUI is
embedded and served by the Rust controller, not by `serve`.

The expanded GUI run covers 41.29% of statements and 33.77% of branches across
all `src/`, including 59.34% of `Settings.tsx`, 61.74% of
`SettingsModal.tsx`, 53.04% of `Ports.tsx`, and 79.45% of `SummaryView.tsx`.
Initial `/ports` GET failures, config-fetch failures, and ARP-update failures
are regression tested; the initial failure now exits loading and offers a
working Retry action. Existing React DOM/key/NaN warnings and Vite's bundle-size/config
warnings remain visible without failing the build.

Controller lifecycle fault injection still needs an internal switch/BfRt test
seam: simulated BfRt failures during start/stop/restart and RFC2544
trial failures cannot be induced reliably through the public API. This does
not depend on, or imply, a controller library refactor. The controller also
documents a known reset/cooldown edge case:
resetting during a multi-test cooldown may allow the pending pre-reset snapshot
to be added back to result history. The black-box suite deliberately does not
encode that incorrect behavior as the expected result.

## Changelog regression inventory

The inventory was derived from every bullet under `### Bug fixes` in
`docs/CHANGELOG.md`, with `git blame`/`git log` used to inspect the fixing
changes. Rows combine entries only where their classification and reason are
identical. Categories are: **T** public API/model test, **G** GUI logic test,
**L** controller-internal unit test, **H** hardware-only, and **N** not a
stable/meaningful automated behavior (documentation, packaging, dependency,
script, security, or purely visual work).

| Version | Changelog entry | Category and coverage |
|---|---|---|
| 2.8.2 | RFC2544 results use measured rather than requested TX rates | L — existing RFC2544/unit coverage; public orchestration still needs an injectable switch/BfRt test seam |
| 2.8.1 | Rate-digest timestamps; IAT pipe bounds; 50k RTT/IAT storage cap; counter-regression rate guard; TX/RX digest jitter | L — monitor/statistics internals |
| 2.8.1 | Large histogram processing; histogram NaN/null for 0/1 samples; unexpected frame table entries | T — model histogram/counter presence plus finite zero-bin results; malformed-table injection remains L |
| 2.8.1 | Unsupported FEC, omitted breakout `channel_count`, T1/T2 layout bounds, four-way channel mapping, manual recirculation, and per-channel ARP MAC | T — both model targets program all four channels and exercise successful/invalid port and ARP mutations; mixed-rate warnings and physical link behavior remain H |
| 2.8.1 | Corrected ports Swagger and ARP docs | T — `schema::public_paths_and_payload` |
| 2.8.1 | Python automation error handling and auto-negotiation constants | N — legacy Python harness intentionally unchanged |
| 2.8.1 | Complete JSON result exports; single-point PDF chart; correct PDF time-series selection | G/T/L — `v2_8_1_complete_json_result_export` and result-tab tests cover full fetch/selection; `v2_8_1_pdf_result_export_contract` plus model PDF covers the public contract, while single-point chart drawing remains controller-internal |
| 2.8.1 | Square low/short-high pattern; pattern meter interval scope | L — pattern construction/data-plane meter internals |
| 2.8.1 | RFC2544 mode/mapping frontend; throughput robustness; stale baselines; settle pacing; no-TX abort; runtime estimate; cooldown floor | L — RFC2544 orchestration internals; hardware accuracy unsuitable for model |
| 2.8.1 | Consistent displayed rate units | N — presentation-only |
| 2.8.1 | `time_statistics?limit=0` division by zero | T — endpoint smoke includes `limit=0` |
| 2.8.1 | GTP-U overhead 36 B | G — `v2_8_1_gtpu_overhead` |
| 2.8.1 | Duplicate RFC2544 dashboard tabs | G — `v2_8_1_duplicate_rfc2544_dashboard_tabs` |
| 2.8.1 | Restart/RFC2544 deadlock | L/H — destructive lifecycle and long RFC run are excluded from model CI |
| 2.8.1 | Minimum 64-byte frame and MPLS/SRv6 underflow | T — `v2_8_1_minimum_frame_size` |
| 2.8.1 | Stream/mapping channel range | T — `v2_8_1_channel_range` |
| 2.8.1 | Device-config read fallback to two pipes | L — requires injected BfRt read failure |
| 2.8.1 | Malformed settings import; corrupt local storage; restored nested defaults; v2.7 migration/cache headers | G — `v2_8_1_malformed_import_is_rejected`, `v2_8_1_corrupt_local_storage`, `v2_8_1_import_restores_defaults`, `v2_8_1_old_channel_layout` |
| 2.8.1 | Configured recirculation-port collision; startup config hardening; recoverable recirc errors | L — startup/config internals; invalid model config would prevent API startup |
| 2.8.1 | Computed `n_packets`, `timeout`, accuracy, pipes and scaled packet count | T — `model::loopback` checks all four served fields; arithmetic remains existing optimization tests |
| 2.8.1 | Correct T1/T2 app ID monitor ranges | T — both target model runs and `v2_8_1_app_id_zero` |
| 2.8.1 | Histogram endpoint uses front-panel/channel map | T — endpoint smoke plus model histogram object assertions |
| Unreleased / 2.8.1 | Ports-page request failures; dashboard rejected-start state | G/T — `unreleased_initial_ports_get_failure_is_recoverable`, `v2_8_1_ports_request_failures`, and Playwright `v2_8_1_rejected_start_state` |
| 2.8.1 | RX fan-in double counting and settings warning | G — `v2_8_1_rx_fan_in`; warning itself is presentation |
| 2.8.1 | IMIX L1 weighting | G — `v2_8_1_imix_l1_weighting`; controller calculation has existing units |
| 2.8.1 | Digest pipeline supervision/watchdog | T — both targets assert `digests_alive` and live digest-derived counters |
| 2.8.1 | App ID 0 crash | T — `v2_8_1_app_id_zero` |
| 2.8.1 | Rejected request cancelled running test/results | T — invalid suite runs during CBR, then `model::loopback` reasserts the same running test |
| 2.8.1 | Pattern sample/period bounds | T — `v2_8_1_pattern_sample_rate`; remaining numeric branches are L |
| 2.8.1 | Serialized frontend polling | G — `v2_8_1_serialized_polling` |
| 2.8.1 | Navbar sizing, focus ring, light selected tab | N — visual CSS |
| 2.8.1 | `p4tg.sh` fixes | N — management/packaging script outside model suite |
| 2.8.1 | Cleared numeric pattern fields; per-tab/clone state leakage | G — `v2_8_1_cleared_numeric_pattern_fields`, `v2_8_1_clone_state_and_tab_lifecycle`, and `v2_8_1_tab_state_isolation` |
| 2.7.1 | Breakout channel calculation; channel ARP/MAC; unsupported T1 startup config | H — physical/breakout startup |
| 2.7.1 | Poisson batching and IAT pipe selection | L/H — solver/data-plane timing; rate accuracy excluded on model |
| 2.7.1 | Post-validation errors reach frontend | T — black-box POST response checks |
| 2.7.1 | Histogram config crashes | T — `v2_8_1_histogram_range` (same public boundary) |
| 2.7.1 | Enable/export controls during generation; visualization limit | G — `v2_7_1_running_stream_controls`, `v2_7_1_running_settings_controls_and_export`, and `v2_7_1_visualization_limit_stable_window` |
| 2.7.1 | Optional `StreamSettings` fields | T/G — valid minimal model payload and `v2_7_1_optional_protocol_fields` |
| 2.7.1 | Missing IPv4 validation | T — `v2_7_1_missing_ipv4` |
| 2.7.1 | Missing SRv6 base header validation | T — Tofino 2 `v2_7_1_missing_srv6_base_header`; valid SRv6 configuration is also programmed in the header-profile lifecycle |
| 2.7.1 | Disabled protocol fields omitted; enabled features get defaults | G — `v2_7_1_optional_protocol_fields` |
| 2.7.1 | RX dashboard aggregation by unique endpoint | G — `v2_8_1_rx_fan_in` |
| 2.6.0 | RX frame/EtherType counters | T — model asserts IPv4 frame-size/type-derived TX/RX counters |
| 2.6.0 | Percentile edge cases | L — statistics math internals |
| 2.6.0 | T2 statistics with more than seven streams | L/T — target supports 15 app IDs; high-load model timing makes a 15-stream digest test unsuitable |
| 2.6.0 | Restart endpoint | H — switch lifecycle intentionally excluded |
| 2.6.0 | T2-only config on T1 | H/L — startup config validation |
| 2.6.0 | Inactive streams in maximum rate | G — `v2_6_0_inactive_stream_rate`; controller calculation has unit coverage |
| 2.6.0 | CVE, API docs, dependencies | N — security/docs/packaging changes |
| 2.5.0 | Ports/multiple-traffic API docs; removed histogram POST; histogram example | T — OpenAPI public path/schema assertions |
| 2.5.0 | Empty TX/RX mapping crash | T — `v2_5_0_missing_tx_rx_mapping` |
| 2.5.0 | Disabled down-port streams; latest/aborted stats; offline crash; test count; direct-API rendering | G — `v2_5_0_disabled_down_port_stream`, `v2_5_0_latest_aborted_result_count`, `v2_5_0_dashboard_test_count`, `v2_5_0_direct_api_multiple_results`, plus the offline browser regression |
| 2.5.0 | Invalid histograms in multiple tests; validation propagation | T — histogram rejection and `v2_5_0_multiple_test_validation` |
| 2.5.0 | Malformed settings import and port/stream import validation | G — migration rejection plus validator tests |
| 2.4.0 | Modal colors | N — visual CSS |
| 2.4.0 | Offline frontend crash | G — Playwright `network failure switches to the responsive offline view` |
| 2.4.0 | Port validation on import | G — `configuration validators` and malformed migration tests |
| 2.4.0 | Missing online API docs | T — OpenAPI asserts `/api/online` |
| 2.4.0 | ARP RX frame display | G — presentation; data-plane frame monitor covered by T2/T1 loopback |
| 2.4.0 | Stream enable button while running | G — component state integration |
| 2.4.0 | Open-P4Studio Makefile | N — build plumbing superseded here by pinned SDK compile tests |

The v2.8.1 changelog was committed as `e6b2afe`, v2.7.1 as `6b3d8fb`,
v2.6.0 as `4a6be83`, v2.5.0 as `f30bd1b`, and v2.4.0 as `5c8a4af`.
The table deliberately calls out UI/component and internal fault-injection gaps
instead of pretending a shallow endpoint smoke covers them.

## Controller-internal coverage gaps

The controller remains a binary crate. Module-local `#[cfg(test)]` tests can be
added without converting it into a library. Tests that must simulate BfRt or
switch failures additionally need a narrow injectable dependency seam. No
controller library refactor is planned or assumed. The priority list derived
from the changelog is:

- RFC2544 measured-rate reporting, baseline reset/correction, pacing, and
  no-TX abort behavior;
- rate-digest timestamp normalization, pipe bounds, sample caps, and counter
  regression;
- pattern period/sample/burst boundaries and square-wave interval generation;
- percentile math for zero/one samples and malformed BfRt table entries;
- ASIC-aware startup/config and recirculation allocation error injection;
- SRv6 missing-header validation, GTP-U overhead, IMIX split, and inactive-rate
  calculation at the controller source level.

These are not duplicated by importing private source files into the integration
crate: doing so would bypass the real binary boundary and tightly couple the
black-box suite to private controller implementation details. They should be
covered with module-local unit tests and focused dependency injection where
hardware failures must be simulated.
