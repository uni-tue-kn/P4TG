# SDE Installation on Asterfusion Devices

1. Install Ubuntu 20.04. You may also try Ubuntu 22.04, but you will have to downgrade your Kernel.
2. Aquire the bf-SDE package from the Intel RDC (under NDA)
  - Apply for an Intel Developer Premier Zone Account and request access to the bf-SDE. https://www.intel.com/content/www/us/en/secure/forms/developer/premier-registration.html, or contact intel.tofino.contact@intel.com
3. Extract the bf-SDE package to `/opt`
4. In `bf-sde-9.13.4/p4studio/dependencies/dependencies.yaml` change the URL of the boost library in line 278 from `https://boostorg.jfrog.io/artifactory/main/release/1.67.0/source/boost_1_67_0.tar.bz2` to `https://archives.boost.io/release/1.67.0/source/boost_1_67_0.tar.bz2`
5. Copy the following file to `p4studio/profiles/my-profile.yaml`.

#### Tofino 1
```yaml
global-options:  
 asic: true  
features:  
 drivers:  
   p4rt: true  
   bfrt: true  
   bfrt-generic-flags: true  
   grpc: true  
   thrift-driver: true  
   tdi: true  
architectures:  
- tofino
```

#### Tofino 2
```yaml
global-options:  
 asic: true  
features:  
 bf-platforms:  
   newport: true  
 drivers:  
   p4rt: true  
   bfrt: true  
   bfrt-generic-flags: true  
   grpc: true  
   thrift-driver: true  
   tdi: true  
architectures:  
- tofino2
```

6. On Ubuntu 20.04, manually install python3-dev and libpython3.8-dev with apt if not installed.
7. Start compilation of p4studio: `p4studio/p4studio profile apply my-profile`. Compilation may take several hours.
8. When compilation is done, set the env variables: `export SDE= /opt/bf-sde-9.13.4; export SDE_INSTALL=/opt/bf-sde-9.13.4/install; export PATH=$PATH:$SDE_INSTALL/bin; export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:$SDE_INSTALL/lib`. Add them to `/etc/profile` for convenience.
9. Download additional dependencies for open-source Asterfusion BSP
   1. cgoslx
      1. Download: https://drive.cloudswitch.io/external/745689ea25643bc00fac9224d368d4374ca3d15724cb83181a631c4168044d30
      2. make -j4 && make install
   2. i2cdrv
      1. Download: https://github.com/asterfusion/nct6779d.git 
      2. make -j4 && cp nct6779d.ko /lib/modules/<kernel_version>/kernel/drivers/misc/
10. Install Asterfusion BSP
    1.  Clone the Asterfusion BSP: `git clone https://github.com/asterfusion/bf-bsp-lts`
    2.  Run `./autogen.sh` in the cloned repo.
    3.  Create build dir: `mkdir build && cd build/`
    4.  Compile: cmake .. -DCMAKE_MODULE_PATH`pwd`/../cmake -DCMAKE_INSTALL_PREFIX=$SDE_INSTALL -DOS_NAME=Ubuntu -DOS_VERSION=20 -DSDE_VERSION=9133
    5.  Install: `make -j15 install`
11. Launch X-T platforms: run `xt-cfgen.sh`
12. Done!