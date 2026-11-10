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

The next layers are the black-box REST API suite, model data-plane suite,
changelog regressions, GUI Vitest suite, and the four-job GitHub Actions
workflow described in the task.

## After lib refactor

The controller remains a binary crate. Internal tests for `optimization.rs`,
`validate.rs`, and other module-private behavior are deferred until the planned
library refactor; black-box validation tests should cover public behavior once
the model foundation is unblocked.
