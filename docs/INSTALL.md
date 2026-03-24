## SDE Installation

- [Edgecore devices](edgecore.md)
- [Asterfusion devices](asterfusion.md)

## Build P4TG

The provided `p4tg.sh` script automates the installation of the data and control plane on Debian- / Ubuntu-based systems, provided that the SDE is installed correctly.
Make sure that the environment variables `$SDE` and `$SDE_INSTALL` are set. Run with `sudo -E` to pass environment variables.

### Manual instructions
1. git clone https://github.com/uni-tue-kn/P4TG.git (optional: git checkout nightly)

#### Data Plane
```bash
cd P4TG/P4-Implementation
```

- **Tofino 1:**  
  ```bash
  make compile TARGET=tofino
  make start TARGET=tofino
  ```
- **Tofino 2:**  
  ```bash
  make compile TARGET=tofino2
  make start TARGET=tofino2
  ```

**Tested on:**
- SDE 9.9.0 (up to v2.0.0)  
- SDE 9.13.{0,...,4}  

Systemd unit file to manage data plane program for convenience:

```bash
[Unit]
Description=P4TG Dataplane
After=network.target
StartLimitIntervalSec=0
[Service]
Type=simple
Restart=always
RestartSec=1
Environment="SDE=/opt/bf-sde-9.13.4" # CHANGE ME
Environment="SDE_INSTALL=/opt/bf-sde-9.13.4/install" # CHANGE ME
ExecStart=/opt/bf-sde-9.13.4/run_switchd.sh -p traffic_gen
#ExecStart=/opt/bf-sde-9.13.0/run_switchd.sh -p traffic_gen --arch tf2 #TOFINO 2
```

#### Control Plane
```bash
cd P4TG/Controller
docker compose up
```

6. Start controller: `cd P4TG/Controller && docker compose up -d`