# P4TG: 1 Tb/s Traffic Generation for Ethernet/IP Networks

This repository contains the source code for a P4 based 1 Tb/s traffic generator based on the Intel Tofino(TM) ASIC.

In generation mode, P4TG is capable of generating traffic up to 1 Tb/s split across 10x 100 Gb/s ports. Thereby it measures rates directly in the data plane. Generated traffic may be fed back from the output to the input ports, possibly through other equipment, to record packet loss, packet reordering, and sampled IAT and RTT. In analysis mode, P4TG measures rates on the input ports, samples IAT, and forwards traffic through its output ports.

P4TG consist of:

- a P4 program for the Intel Tofino(TM)
- Python control plane
- React configuration GUI

**The repository is not yet fully set up!**

## Installation

### Configuration GUI

The configuration GUI is based on react & nodejs.
It can be either started via docker-compose or via npm.

#### Docker

To run the configuration GUI via docker-compose run `docker-compose up`.
After the build has finished, the configuration GUI is reachable at `http://127.0.0.1`.
To change the listening port adjust the port in `docker-compose.yml`.

#### Lecay NPM installation

Run `npm install --legacy-peer-deps` to install the nodejs dependencies.
Afterwards run `npm run build` to create a production build and serve the `build/` directory with a webserver of your choice.

**Installation instructions & documentation follows soon.**
## Preview of P4TG

![image](preview.png)
