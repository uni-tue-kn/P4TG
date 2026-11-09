# P4TG test infrastructure

## Status

The mandatory software-model feasibility spike is implemented, but the broader
test suite and GitHub workflow are intentionally blocked. Tofino 2 forwards
packets on the model but does not deliver either P4TG digest to the controller.
Building digest-dependent end-to-end tests on this foundation would produce a
suite that cannot pass the required two-target matrix.

## Feasibility spike

Build the test controller image once, then run either target. Docker access is
required; no host ports are published.

```console
tests/ci/build-controller-image.sh
tests/ci/model-smoke.sh tofino
tests/ci/model-smoke.sh tofino2
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
| pktgen at 0.001 Gbit/s | Pass | Pass |
| 1-to-2 veth forwarding | Pass | Pass |
| frame-size/type counters | Pass | Pass |
| `monitor_t` / `iat_rtt_monitor_t` digests | Pass | **Blocked** |
| digest watchdog after 10 seconds | `digests_alive: true` | `digests_alive: false` |

The UniCorn DMA preload is required. Without external recirculation, MAC-near
loopback re-enters the Tofino 1 model on internal device port 68 rather than the
configured front-panel device port 8, so P4TG's recirculation rules never match.
The test-only `P4TG_EXTERNAL_RECIRCULATION=1` option leaves those ports in normal
mode and lets Docker emulate the hardware loopback behavior. The option is off
by default and therefore does not change hardware startup.

At 0.001 Gbit/s the software model accumulates a substantial processing
backlog. Counter presence and growth are testable, but the following are not
meaningful assertions on the model:

- rate accuracy;
- equality of instantaneous TX and RX counts or zero loss at a wall-clock
  sampling point;
- RTT and IAT values;
- physical link status and port speed behavior.

### Tofino 2 blocker evidence

The extended 25-second Tofino 2 probe produced 432 TX and 230 RX frame-size
samples, but `/api/online` returned `"digests_alive":false`, RTT data remained
empty, and the controller logged:

```text
No digests received from the switch for 11s. Statistics are stale; restart the controller if this persists.
```

Both compiled schemas contain the expected names
`pipe.SwitchIngressDeparser.digest` and
`pipe.SwitchIngressDeparser.digest_2`. The model trace executes deparser logic
with `digest_type = 2`, but no notification reaches the controller's subscribed
BfRt stream. This currently appears to be a Tofino 2 model/runtime digest issue,
not schema drift.

## Test plan

Deferred until the Tofino 2 digest blocker is resolved. The next layers are the
black-box REST API suite, model data-plane suite, changelog regressions, GUI
Vitest suite, and the four-job GitHub Actions workflow described in the task.

## After lib refactor

The controller remains a binary crate. Internal tests for `optimization.rs`,
`validate.rs`, and other module-private behavior are deferred until the planned
library refactor; black-box validation tests should cover public behavior once
the model foundation is unblocked.
