TARGET?=tofino2
FOLDER=tofino
ARCH=tna
SWITCHD=tf1
TOFINO_VERSION=1

ifeq ($(TARGET), tofino2)
	TARGET=tofino2-t2na
	ARCH=t2na
	FOLDER=tofino2
	SWITCHD=tf2
	TOFINO_VERSION=2
endif

compile:
	sudo -E ${SDE_INSTALL}/bin/bf-p4c -D__TARGET_TOFINO__=${TOFINO_VERSION} --target ${TARGET} -g --arch ${ARCH} -o /opt/p4tg traffic_gen.p4
	sudo -E cp /opt/p4tg/traffic_gen.conf ${SDE_INSTALL}/share/p4/targets/${FOLDER}/p4tg.conf

start:
	sudo -E ${SDE}/run_switchd.sh -p p4tg --arch ${SWITCHD}
