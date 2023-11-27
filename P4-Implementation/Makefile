CFLAGS=-D__NO_UDP_CHECKSUM__=0

compile:
	sudo -E ${SDE_INSTALL}/bin/bf-p4c $(CFLAGS) --target tofino --arch tna -o /opt/p4tg traffic_gen.p4
	sudo -E cp /opt/p4tg/traffic_gen.conf ${SDE_INSTALL}/share/p4/targets/tofino/p4tg.conf

start:
	sudo -E ${SDE}/run_switchd.sh -p p4tg
