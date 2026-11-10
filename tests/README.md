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
isolated network namespace. Front-panel ports 1 and 2 are connected by a veth
pair. Each recirculation port uses a one-port Linux bridge with hairpin mode to
emulate same-port loopback.

## Model capabilities & limitations

| Capability | Tofino 1 | Tofino 2 |
|---|---|---|
| P4 compile | Pass | Pass |
| Model and `bf_switchd` startup | Pass | Pass |
| Controller startup and ASIC detection | Pass | Pass |
| `config.json` and front-panel mapping | Pass (`1/0 -> 0`, `2/0 -> 4`) | Pass (`1/0 -> 8`, `2/0 -> 16`) |
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
| Controller's 3,653 existing Rust tests | controller | Rate solver and module-level behavior |
| Public endpoint and OpenAPI-path smoke | API/model | Detect route removal, crashes, and schema drift |
| Twelve named validation regressions | API/model | Exercise the real deserializer and validation response |
| CBR loopback with counter, digest, histogram, loss, and ordering assertions | model | Complete controller/P4/model/DMA path |
| Mpps, Poisson, Analyze, multiple-stream, and per-stream RX start/stop | model | Programming paths beyond the CBR smoke case |
| Direct `rbfrt` table read after controller shutdown | model/BfRt | Verify schema and table access without the REST facade |
| Fourteen Vitest assertions | GUI | Validators, storage migration, optional payload fields, rate/IMIX logic, polling |
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
tests/ci/compile-p4.sh tofino /tmp/p4tg-ci-t1
tests/ci/model-smoke.sh tofino /tmp/p4tg-ci-t1
```

Temporary build/results directories are created only below `/tmp/p4tg-ci-*`.
No ports are published to the host. The model, switchd, controller, and Rust
runner share one container network namespace.

GitHub Actions splits this into `controller`, `gui`, `p4-compile`, and
`model-e2e-regression` jobs. Both P4/model jobs are target matrices. The SDK is
pinned by digest, and the model job removes that compiler image on the
disposable hosted runner before loading the model runtime to stay within the
runner disk limit. Workflow syntax is checked locally with `actionlint`.

### Known open issues

`npm audit` reports two high-severity findings in the existing preview-server
dependency chain: `serve` pulls `compression <1.8.2` (GHSA-vc2v-76pw-4v95).
The advisory's automatic fix is a semver-major downgrade of `serve`; the test
work does not silently change that product dependency. The production GUI is
embedded and served by the Rust controller, not by `serve`.

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
| 2.8.2 | RFC2544 results use measured rather than requested TX rates | L — existing RFC2544/unit coverage; see After lib refactor for public orchestration |
| 2.8.1 | Rate-digest timestamps; IAT pipe bounds; 50k RTT/IAT storage cap; counter-regression rate guard; TX/RX digest jitter | L — monitor/statistics internals |
| 2.8.1 | Large histogram processing; histogram NaN/null for 0/1 samples; unexpected frame table entries | T — model histogram/counter presence plus finite zero-bin results; malformed-table injection remains L |
| 2.8.1 | Unsupported FEC, omitted breakout `channel_count`, 1x50G/8x50G FEC, T1 200G, mixed breakout warning, per-channel ARP MAC | H — depends on physical port manager/channel layout |
| 2.8.1 | Corrected ports Swagger and ARP docs | T — `schema::public_paths_and_payload` |
| 2.8.1 | Python automation error handling and auto-negotiation constants | N — legacy Python harness intentionally unchanged |
| 2.8.1 | Complete JSON result exports; single-point PDF chart; correct PDF time-series selection | G/L — export/report UI integration; no isolated stable function, report endpoint is schema-checked |
| 2.8.1 | Square low/short-high pattern; pattern meter interval scope | L — pattern construction/data-plane meter internals |
| 2.8.1 | RFC2544 mode/mapping frontend; throughput robustness; stale baselines; settle pacing; no-TX abort; runtime estimate; cooldown floor | L — RFC2544 orchestration internals; hardware accuracy unsuitable for model |
| 2.8.1 | Consistent displayed rate units | N — presentation-only |
| 2.8.1 | `time_statistics?limit=0` division by zero | T — endpoint smoke includes `limit=0` |
| 2.8.1 | GTP-U overhead 36 B | G — `v2_8_1_gtpu_overhead` |
| 2.8.1 | Duplicate RFC2544 dashboard tabs | G — component rendering integration, not exported logic |
| 2.8.1 | Restart/RFC2544 deadlock | L/H — destructive lifecycle and long RFC run are excluded from model CI |
| 2.8.1 | Minimum 64-byte frame and MPLS/SRv6 underflow | T — `v2_8_1_minimum_frame_size` |
| 2.8.1 | Stream/mapping channel range | T — `v2_8_1_channel_range` |
| 2.8.1 | Device-config read fallback to two pipes | L — requires injected BfRt read failure |
| 2.8.1 | Malformed settings import; corrupt local storage; restored nested defaults; v2.7 migration/cache headers | G — `v2_8_1_malformed_import_is_rejected`, `v2_8_1_corrupt_local_storage`, `v2_8_1_import_restores_defaults`, `v2_8_1_old_channel_layout` |
| 2.8.1 | Configured recirculation-port collision; startup config hardening; recoverable recirc errors | L — startup/config internals; invalid model config would prevent API startup |
| 2.8.1 | Computed `n_packets`, `timeout`, accuracy, pipes and scaled packet count | T — `model::loopback` checks all four served fields; arithmetic remains existing optimization tests |
| 2.8.1 | Correct T1/T2 app ID monitor ranges | T — both target model runs and `v2_8_1_app_id_zero` |
| 2.8.1 | Histogram endpoint uses front-panel/channel map | T — endpoint smoke plus model histogram object assertions |
| 2.8.1 | Ports-page request failures; dashboard rejected-start state | G/T — public rejection is tested; React error rendering is component integration |
| 2.8.1 | RX fan-in double counting and settings warning | G — `v2_8_1_rx_fan_in`; warning itself is presentation |
| 2.8.1 | IMIX L1 weighting | G — `v2_8_1_imix_l1_weighting`; controller calculation has existing units |
| 2.8.1 | Digest pipeline supervision/watchdog | T — both targets assert `digests_alive` and live digest-derived counters |
| 2.8.1 | App ID 0 crash | T — `v2_8_1_app_id_zero` |
| 2.8.1 | Rejected request cancelled running test/results | T — invalid suite runs during CBR, then `model::loopback` reasserts the same running test |
| 2.8.1 | Pattern sample/period bounds | T — `v2_8_1_pattern_sample_rate`; remaining numeric branches are L |
| 2.8.1 | Serialized frontend polling | G — `v2_8_1_serialized_polling` |
| 2.8.1 | Navbar sizing, focus ring, light selected tab | N — visual CSS |
| 2.8.1 | `p4tg.sh` fixes | N — management/packaging script outside model suite |
| 2.8.1 | Cleared numeric pattern fields; per-tab/clone state leakage | G — React state integration; no exported pure logic |
| 2.7.1 | Breakout channel calculation; channel ARP/MAC; unsupported T1 startup config | H — physical/breakout startup |
| 2.7.1 | Poisson batching and IAT pipe selection | L/H — solver/data-plane timing; rate accuracy excluded on model |
| 2.7.1 | Post-validation errors reach frontend | T — black-box POST response checks |
| 2.7.1 | Histogram config crashes | T — `v2_8_1_histogram_range` (same public boundary) |
| 2.7.1 | Enable/export controls during generation; visualization limit | G — component state/presentation integration |
| 2.7.1 | Optional `StreamSettings` fields | T/G — valid minimal model payload and `v2_7_1_optional_protocol_fields` |
| 2.7.1 | Missing IPv4 validation | T — `v2_7_1_missing_ipv4` |
| 2.7.1 | Missing SRv6 base header validation | L/T2 — branch is internal-validation follow-up; valid SRv6 frame checking remains open |
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
| 2.5.0 | Disabled down-port streams; latest/aborted stats; offline crash; test count; direct-API rendering | G — React integration/presentation |
| 2.5.0 | Invalid histograms in multiple tests; validation propagation | T — histogram rejection and `v2_5_0_multiple_test_validation` |
| 2.5.0 | Malformed settings import and port/stream import validation | G — migration rejection plus validator tests |
| 2.4.0 | Modal colors | N — visual CSS |
| 2.4.0 | Offline frontend crash | G — polling/network component integration |
| 2.4.0 | Port validation on import | G — `configuration validators` and malformed migration tests |
| 2.4.0 | Missing online API docs | T — OpenAPI asserts `/api/online` |
| 2.4.0 | ARP RX frame display | G — presentation; data-plane frame monitor covered by T2/T1 loopback |
| 2.4.0 | Stream enable button while running | G — component state integration |
| 2.4.0 | Open-P4Studio Makefile | N — build plumbing superseded here by pinned SDK compile tests |

The v2.8.1 changelog was committed as `e6b2afe`, v2.7.1 as `6b3d8fb`,
v2.6.0 as `4a6be83`, v2.5.0 as `f30bd1b`, and v2.4.0 as `5c8a4af`.
The table deliberately calls out UI/component and internal fault-injection gaps
instead of pretending a shallow endpoint smoke covers them.

## After lib refactor

The controller remains a binary crate. Internal tests for `optimization.rs`,
`validate.rs`, and other module-private behavior are deferred until the planned
library refactor. The priority list derived from the changelog is:

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
crate: doing so would bypass the real binary boundary and create exactly the
coupling the planned `lib.rs` refactor is intended to solve.
