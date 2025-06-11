# Build open-p4studio

Tested on Ubuntu 22.04 with python3.10 and Ubuntu 20.04 with python3.8. Ubuntu 24.04 is currently not supported.

0. Aquire the BSP (Board Support Package) for your device. Reach out to Intel (intel.tofino.contact@intel.com) for the BSP package.
1. git clone https://github.com/p4lang/open-p4studio.git
2. cd open-p4studio
3. Copy the following file to p4studio/profiles/my-profile.yaml. Change the BSP path to your archive.

#### Tofino 1
```yaml
global-options:
  asic: true
features:
  bf-platforms:
    bsp-path: /opt/bf-reference-bsp-9.13.4.tgz # CHANGE ME
  p4-examples:
  - p4-16-programs
architectures:
- tofino
```

#### Tofino 2
```yaml
global-options:
  asic: true
features:
  bf-platforms:
    bsp-path: /opt/bf-reference-bsp-9.13.4.tgz # CHANGE ME
    newport: true
  p4-examples:
  - p4-16-programs
architectures:
- tofino2
```

4. Extract the BSP reference archive somewhere.
5. Set the env variable: `export BSP=9.13.4`
6. Run the `extract_all.sh` script in the extracted BSP reference folder
7. Copy the extracted `bf-platforms` folder into `~/open-p4studio/pkgsrc/bf-platforms`  ([https://github.com/p4lang/open-p4studio/issues/83](https://github.com/p4lang/open-p4studio/issues/83))
8. On Ubuntu 20.04, manually install python3-dev and libpython3.8-dev with apt if not installed.
9. Start compilation of p4studio: `p4studio/p4studio profile apply my-profile`. Compilation may take several hours.
10. When compilation is done, set the env variables: `export SDE= ~/open-p4studio; export SDE_INSTALL=~/open-p4studio/install`. Add them to `/etc/profile` for convenience.
11. Load the kernel modules: `cd $SDE_INSTALL/bin; sudo ./bf_kdrv_mod_load $SDE_INSTALL; sudo ./bf_fpga_mod_load $SDE_INSTALL`
12. Set an alias for bf-p4c: `ln -s $SDE_INSTALL/bin/p4c $SDE_INSTALL/bin/bf-p4c`   ([https://github.com/p4lang/open-p4studio/issues/50](https://github.com/p4lang/open-p4studio/issues/50))

# Build P4TG

1. git clone https://github.com/uni-tue-kn/P4TG.git
2. cd P4TG/P4-Implementation  (optional: git checkout nightly)
3. `make compile TARGET=tofino{2}` make sure to set the target to tofino / tofino2, and ensure that SDE env variables are set
4. `make start`
5. Systemd unit file to manage data plane program for convenience:

```bash
[Unit]
Description=P4TG Dataplane
After=network.target
StartLimitIntervalSec=0
[Service]
Type=simple
Restart=always
RestartSec=1
Environment="SDE=/opt/bf-sde-9.13.0" # CHANGE ME
Environment="SDE_INSTALL=/opt/bf-sde-9.13.0/install" # CHANGE ME
ExecStart=/opt/bf-sde-9.13.0/run_switchd.sh -p traffic_gen
#ExecStart=/opt/bf-sde-9.13.0/run_switchd.sh -p traffic_gen --arch tf2 #TOFINO 2
```

6. Start controller: `cd P4TG/Controller && docker compose up -d`