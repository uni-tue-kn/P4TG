control PatternShaping (
    inout header_t hdr,
    inout ingress_metadata_t ig_md,
    inout ingress_intrinsic_metadata_for_deparser_t ig_dprsr_md) {

    DirectMeter(MeterType_t.BYTES) pattern_meter;
    DirectCounter<bit<64>>(CounterType_t.PACKETS) debug_counter;

    bit<32> period_pkts = 1;

    Register<bit<32>, bit<4>>(16, 0) pattern_interval_number;
    #if __TARGET_TOFINO__ == 2
        // Tofino 2 has 4 bit app_id
        RegisterAction<bit<32>, bit<4>, bit<32>>(pattern_interval_number) get_and_increment_interval = {
    #else
        RegisterAction<bit<32>, bit<3>, bit<32>>(pattern_interval_number) get_and_increment_interval = {
    #endif  
            void apply(inout bit<32> value, out bit<32> read_value) {
                if (value == period_pkts) {
                    value = 0;
                }   else {
                    value = value + 1;
                }
                read_value = value;
            }
    };


    action set_pattern_config(bit<32> period_pkts_cp) {
        period_pkts = period_pkts_cp;
        debug_counter.count();
    }

    table pattern_config {
        key = {
            hdr.pkt_gen.app_id: exact;
        }
        actions = {
            set_pattern_config;
        }
        counters = debug_counter;
        #if __TARGET_TOFINO__ == 2
            size = 16;
        #else
            size = 8;
        #endif
    }

    action pattern_shape() {
        ig_md.pattern_color = pattern_meter.execute();
    }

    table pattern_generation {
        key = {
            hdr.pkt_gen.app_id: exact;
            ig_md.pattern_interval_number: lpm;
        }
        actions = {
            pattern_shape;
        }
        meters = pattern_meter;
        size = 8192;
    }


    apply {
        // Retrieve number of packets per period if configured
        if (pattern_config.apply().hit) {
            // Get current position in period
            ig_md.pattern_interval_number = get_and_increment_interval.execute(hdr.pkt_gen.app_id);

            // Apply traffic shaping according to pattern
            pattern_generation.apply();
            if (ig_md.pattern_color == 3) {
                ig_dprsr_md.drop_ctl = 1;
            }
        };


    }
}