# Changelog 

## v2.4.0
### New features
- Live RTT histogram generation
  - Range for histogram and number of bins is configurable on a per-port basis
    - Configuration is available in the frontend in Settings
  - Packets are matched in the data plane based on configured histogram settings (no sampling)
  - .25, .50, .75, and .90 percentiles are calculated based on the histogram data
  - Histogram is rendered in frontend
- New API endpoints for histogram configuration: `POST:api/histogram` for histogram configuration and `GET:api/histogram` to retrieve configuration

### Bug fixes
- Fixed text color in Modals in dark mode
- Fixed frontend crash if controller goes offline
- Added missing API docs for `online` endpoint

## v2.3.3
### Bug Fixes
- Fixed a crash of the P4TG controller after several hours
- Fixed text color for InfoModals in dark mode

### Other
- Updated dependencies for backend in `Controller/Cargo.toml` and frontend in `Configuration GUI/package.json`

## v2.3.2
### New Features
- Add IPv6 support
  - Randomization with least-significant 48-bits in source / destination address
- Add CI for data plane build.
- Add dark mode.
- Add SRv6 support.
  - Tofino 2 only.
  - Up to 3 SIDs.
  - Add IP tunneling toggle for SRv6.
- Introduce loopback mode per controller flag.
- Add configuration option to increase burstiness of traffic in rate mode for achieving a more accurate rate.
- Add configuration option to set the duration of a test in seconds.

### Bug Fixes
- Fix StreamSettings rendering in frontend if Controller API was used directly.
- Fix "Sum of stream rates" error in frontend for inactive streams
- Fix bug on settings import if no port mapping is configured.
- Fix bug on settings import if not all ports are defined in JSON file.
- Fix validation of port settings on import in frontend.
- Fix backwards compatibility on config import from older P4TG versions.
- Fix compilation on SDE 9.13.4 for Tofino 1.
- Fix MPLS Encapsulation bug in frontend.
- Fix frame type monitor for IPv6 traffic.
- Fix CI issues.
- Fix field validation for stream settings.
- Fix IP settings being shown if no IP tunneling is used with SRv6.
- Fix UDP checksum calculation for SRv6 with multiple SIDs.
- Fix SRv6 compilation on Tofino 1.
- Fix traffic generation for 64-byte frames with IPv6 on Tofino 2.
- Fix traffic generation in Mpps mode
- Fix errors in GUI build.
- Fix stream settings related issues when TX port goes down.
- Fix ASIC detection.
- Fix compile flags and README updates.
- Fix IPv6 UDP checksum calculation
- Fix docker build of controller (#22)
- Disallow MPLS with VxLAN on Tofino 1 to enable SDE 9.13.4.
- Add missing API documentation.
- Add config validation for available TX/RX ports.
- Automatically disable active stream setting if port goes down.

## v2.3.0
- Add support for Intel Tofino2 (data plane / control plane / configuration UI)
  - supports traffic generation with up to 4 Tb/s (10x 400 Gb/s)
- Update `/api/online` endpoint that now returns ASIC version (Tofino1 / Tofino2) and version number
- Update stream settings ui to allow to disable a stream if port is not up
  
## v2.2.1
- Better support for 4-pipe Tofino
  - Increase meter entries & register entries to 512 to be able to use ports with PID > 255
- Bug in analyze mode that returned an error when no streams / stream settings were provided
- Preliminary import/export function for settings
- Fix bug that prevents that ARP replies are always generated in ANALYZE mode

## v2.2.0
- Added VxLAN support
- Added infobox in UI to get further information on features
- Random Ethernet src addresses are now always unicast
- Detection mechanism that clears local storage if stored streams do not have all required properties
  - This may be the case if an update introduces new properties, but the old stored values in local storage dont have them
- Refactor Configuration GUI code
- Switch to utoipa + swagger-ui for REST-API docs
- Add `config.json` file that can be used to specify the traffic generation (front panel) ports
- Add `ARP Reply` option in UI. If enabled, the switch answers all ARP requests that it receives on that port.

### Refactor REST-API endpoint `/api/trafficgen` 
- Endpoint `/api/trafficgen` refactored to better reflect encapsulation methods
- Streamsettings are now grouped according to protocol (see `/api/docs` for examples)
  - Ethernet related configuration (src & dst mac) are now under `ethernet`
  - VLAN & QinQ related configuration are now under `vlan`
  - IP related configuration are now under `ip`
  - Fields (`vlan`, `mpls_stack`, `vxlan`) are only required if corresponding encapsulation is active
- `number_of_lse` in stream description is now only required if MPLS encapsulation is used
  
## v2.1.2
- Added RTT visualization
- Cleaner monitoring routine in controller
- Add "port clearance" before P4TG starts. May be needed if other systems configure the switch (e.g., SONiC). See https://github.com/uni-tue-kn/P4TG/issues/6

## v2.1.1

- UI bug-fix total TX/RX frame tpes
- Remove "non-unicast" from frame chart

## v2.1.0

- Added MPLS support with up to 15 MPLS labels
- Integrated configuration GUI webserver in controller
  - The configuration GUI is now also served at `http://ip-of-controller:controller-port`
- Moved REST-API to `/api` endpoint of the controller. It is now served at `http://ip-of-controller:controller-port/api`
- Added visualization on the GUI for traffic rates, packet loss & out of order, frame statistics
## v2.0.0 

### Have you considered Rewriting It In Rust?

v.2.0.0 includes several improvements over v1.0.0.

- Added VLAN & QinQ encapsulation
- Added Ethernet type counter (VLAN, QinQ, IPv4, IPv6, Unknown)
- Switched to data plane mean IAT & MAE (mean absolute error) measurement
  - Sample mode (as in v.1.0.0) available via Controller environment variable (`SAMPLE=1`)
  - Data plane mode (`SAMPLE=0`) is more accurate and the default
- Configuration GUI re-design & enhancements / bug fixes
- **Rewrite of the control plane in Rust**
- REST-API endpoint documentation
