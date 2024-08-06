# Changelog 

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
