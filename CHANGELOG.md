# Changelog 

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
