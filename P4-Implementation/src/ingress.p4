#include "./libs/ingress/ARP.p4"

control ingress(
    inout header_t hdr,
    inout ingress_metadata_t ig_md, in ingress_intrinsic_metadata_t ig_intr_md, in ingress_intrinsic_metadata_from_parser_t ig_prsr_md,
    inout ingress_intrinsic_metadata_for_deparser_t ig_dprsr_md,
    inout ingress_intrinsic_metadata_for_tm_t ig_tm_md) {

    P4TG_Ingress() p4tg;
    ARP() arp;

    action set_mode(bit<8> mode) {
        ig_md.tg_mode = mode;
    }

    table tg_mode {
        key = {
            ig_intr_md.ingress_port: lpm;
        }
        actions = {
            set_mode;
        }
        size = 1;
    }

    apply {
        tg_mode.apply();

        arp.apply(hdr, ig_md, ig_intr_md, ig_tm_md);
        p4tg.apply(hdr, ig_md, ig_intr_md, ig_prsr_md, ig_dprsr_md, ig_tm_md);
    }

}
