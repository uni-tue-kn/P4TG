TARGET ?= tofino2
SWITCHD = tf1
TOFINO_VERSION = 1

MAKEFILE_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
P4_FILE := $(realpath $(MAKEFILE_DIR)/traffic_gen.p4)

ifeq ($(TARGET), tofino2)
    SWITCHD = tf2
    TOFINO_VERSION = 2
    TOFINO_FLAG = -DTOFINO2=ON
else
    TOFINO_FLAG = -DTOFINO=ON
endif

compile:
	sudo -E rm -rf ${SDE}/build/p4-build/p4tg
	sudo -E mkdir -p ${SDE}/build/p4-build/p4tg
	cd ${SDE}/build/p4-build/p4tg && sudo -E cmake ${SDE}/p4studio \
	 -D__TARGET_TOFINO__=${TOFINO_VERSION}                         \
	 -DCMAKE_MODULE_PATH=${SDE}/cmake                              \
	 -DCMAKE_INSTALL_PREFIX=${SDE_INSTALL}                         \
	 -DP4_PATH=$(P4_FILE)                                          \
	 -DP4_NAME=p4tg                                        		   \
	 -DP4_LANG=p4_16                                               \
	 $(TOFINO_FLAG)
	cd ${SDE}/build/p4-build/p4tg && sudo -E make -j install

start:
	sudo -E ${SDE}/run_switchd.sh -p p4tg --arch ${SWITCHD}