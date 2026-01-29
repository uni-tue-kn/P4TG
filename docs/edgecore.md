# SDE Installation on Edgecore Devices

Tested on Ubuntu 22.04 with python3.10 and Ubuntu 20.04 with python3.8. Ubuntu 24.04 is currently not supported.
⚠️ Building the SDE for the hardware ASIC works best on Ubuntu 20.04.

1. Install Ubuntu 20.04. You may also try Ubuntu 22.04, but you will have to downgrade your Kernel.
2. Aquire the BSP (Board Support Package) for your device. Reach out to Intel (intel.tofino.contact@intel.com) for the BSP package.
   - Place the BSP reference .tgz archive in `/opt`
3. Aquire the bf-SDE package from the Intel RDC (under NDA)
     - Apply for an Intel Developer Premier Zone Account and request access to the bf-SDE. https://www.intel.com/content/www/us/en/secure/forms/developer/premier-registration.html, or contact intel.tofino.contact@intel.com
4. Extract the bf-SDE package to `/opt`
5. In `bf-sde-9.13.4/p4studio/dependencies/dependencies.yaml` change the URL of the boost library in line 278 from `https://boostorg.jfrog.io/artifactory/main/release/1.67.0/source/boost_1_67_0.tar.bz2` to `https://archives.boost.io/release/1.67.0/source/boost_1_67_0.tar.bz2`
6. Copy the following file to `p4studio/profiles/my-profile.yaml`.

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

7.  On Ubuntu 20.04, manually install python3-dev and libpython3.8-dev with apt if not installed.
8.  Start compilation of p4studio: `p4studio/p4studio profile apply my-profile`. Compilation may take several hours.
9.  When compilation is done, set the env variables: `export SDE= ~/open-p4studio; export SDE_INSTALL=~/open-p4studio/install`. Add them to `/etc/profile` for convenience.
10. Load the kernel modules
     - Tofino 1: `cd $SDE_INSTALL/bin; sudo ./bf_kdrv_mod_load $SDE_INSTALL`
     - Tofino 2: `cd $SDE_INSTALL/bin; sudo ./bf_kdrv_mod_load $SDE_INSTALL; sudo ./bf_fpga_mod_load $SDE_INSTALL`
11. Done!