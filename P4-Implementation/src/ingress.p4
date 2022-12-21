control ingress(
    inout header_t hdr,
    inout ingress_metadata_t ig_md, in ingress_intrinsic_metadata_t ig_intr_md, in ingress_intrinsic_metadata_from_parser_t ig_prsr_md,
    inout ingress_intrinsic_metadata_for_deparser_t ig_dprsr_md,
    inout ingress_intrinsic_metadata_for_tm_t ig_tm_md) {

    P4TG_Ingress() p4tg;

    apply {
        p4tg.apply(hdr, ig_md, ig_intr_md, ig_prsr_md, ig_dprsr_md, ig_tm_md);
    }

}
