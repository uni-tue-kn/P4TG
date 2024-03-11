use lazy_static::lazy_static;
use serde_json::json;

lazy_static!(
  pub static ref EXAMPLE_GET_1: String = json!({
    "ingress.p4tg.frame_type.ethernet_type_monitor": [
        {
            "key": {
                "hdr.ethernet.ether_type": {
                    "value": "2048/16"
                },
                "ig_intr_md.ingress_port": {
                    "value": "44"
                }
            },
            "data": {
                "$COUNTER_SPEC_BYTES": "0",
                "$COUNTER_SPEC_PKTS": "0",
                "action": "ingress.p4tg.frame_type.ipv4"
            }
        },
        {
            "key": {
                "hdr.ethernet.ether_type": {
                    "value": "2048/16"
                },
                "ig_intr_md.ingress_port": {
                    "value": "36"
                }
            },
            "data": {
                "$COUNTER_SPEC_BYTES": "0",
                "$COUNTER_SPEC_PKTS": "0",
                "action": "ingress.p4tg.frame_type.ipv4"
            }
        }
    ],
    "ingress.arp.arp_reply": [
        {
            "key": {
                "ig_intr_md.ingress_port": {
                    "value": "36"
                }
            },
            "data": {
                "action": "ingress.arp.answer_arp",
                "e_port": "44",
                "src_addr": "275592631041392",
                "valid": "0"
            }
        },
        {
            "key": {
                "ig_intr_md.ingress_port": {
                    "value": "56"
                }
            },
            "data": {
                "action": "ingress.arp.answer_arp",
                "e_port": "48",
                "src_addr": "229469354273866",
                "valid": "0"
            }
        },
        {
            "key": {
                "ig_intr_md.ingress_port": {
                    "value": "20"
                }
            },
            "data": {
                "action": "ingress.arp.answer_arp",
                "e_port": "28",
                "src_addr": "895091910978",
                "valid": "0"
            }
        },
        {
            "key": {
                "ig_intr_md.ingress_port": {
                    "value": "156"
                }
            },
            "data": {
                "action": "ingress.arp.answer_arp",
                "e_port": "148",
                "src_addr": "212048241169679",
                "valid": "0"
            }
        },
        {
            "key": {
                "ig_intr_md.ingress_port": {
                    "value": "8"
                }
            },
            "data": {
                "action": "ingress.arp.answer_arp",
                "e_port": "0",
                "src_addr": "209364974058556",
                "valid": "0"
            }
        },
        {
            "key": {
                "ig_intr_md.ingress_port": {
                    "value": "4"
                }
            },
            "data": {
                "action": "ingress.arp.answer_arp",
                "e_port": "12",
                "src_addr": "70544364758069",
                "valid": "0"
            }
        },
        {
            "key": {
                "ig_intr_md.ingress_port": {
                    "value": "164"
                }
            },
            "data": {
                "action": "ingress.arp.answer_arp",
                "e_port": "172",
                "src_addr": "7064363173532",
                "valid": "0"
            }
        },
        {
            "key": {
                "ig_intr_md.ingress_port": {
                    "value": "24"
                }
            },
            "data": {
                "action": "ingress.arp.answer_arp",
                "e_port": "16",
                "src_addr": "235739843499203",
                "valid": "0"
            }
        },
        {
            "key": {
                "ig_intr_md.ingress_port": {
                    "value": "40"
                }
            },
            "data": {
                "action": "ingress.arp.answer_arp",
                "e_port": "32",
                "src_addr": "249301880200372",
                "valid": "0"
            }
        },
        {
            "key": {
                "ig_intr_md.ingress_port": {
                    "value": "180"
                }
            },
            "data": {
                "action": "ingress.arp.answer_arp",
                "e_port": "188",
                "src_addr": "145173983800236",
                "valid": "0"
            }
        }
    ]}).to_string();
);