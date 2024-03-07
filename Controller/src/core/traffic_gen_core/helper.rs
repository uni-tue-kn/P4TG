use crate::api::Stream;
use crate::core::traffic_gen_core::types::Encapsulation;

pub(crate) fn calculate_overhead(stream: &Stream) -> u32 {
    let mut encapsulation_overhead = match stream.encapsulation {
        Encapsulation::None => 0,
        Encapsulation::VLAN => 4, // VLAN adds 4 bytes
        Encapsulation::QinQ => 8, // QinQ adds 8 bytes
        Encapsulation::MPLS => stream.number_of_lse as u32 * 4, // each mpls label has 4 bytes
    };

    if stream.vxlan {
        encapsulation_overhead += 50; // VxLAN has 50 byte overhead
    }

    encapsulation_overhead
}