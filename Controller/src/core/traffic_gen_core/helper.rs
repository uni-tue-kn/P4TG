use etherparse::PacketBuilder;
use crate::core::traffic_gen_core::const_definitions::{P4TG_DST_PORT, P4TG_SOURCE_PORT, VX_LAN_UDP_PORT};
use crate::core::traffic_gen_core::types::*;

pub(crate) fn calculate_overhead(stream: &Stream) -> u32 {
    let mut encapsulation_overhead = match stream.encapsulation {
        Encapsulation::None => 0,
        Encapsulation::Vlan => 4, // VLAN adds 4 bytes
        Encapsulation::QinQ => 8, // QinQ adds 8 bytes
        Encapsulation::Mpls => stream.number_of_lse.unwrap() as u32 * 4, // each mpls label has 4 bytes
    };

    if stream.vxlan {
        encapsulation_overhead += 50; // VxLAN has 50 byte overhead
    }

    encapsulation_overhead
}

/// Creates a packet with `frame_size` bytes and `encapsulation` (e.g., VLAN)
///
/// `frame_size` is L2 size **WITHOUT** encapsulation and without preamble and IFG.
/// Therefore the remaining filler bytes take the encapsulation into account.
pub(crate) fn create_packet(s: &Stream) -> Vec<u8> {
    let frame_size = s.frame_size;
    let encapsulation = s.encapsulation;
    let app_id = s.app_id;
    let number_of_lse = s.number_of_lse;

    // this represents the P4TG header
    // sequence number and tx_timestamp are initially zero and take 10 bytes
    // last byte is app id
    let mut payload = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, app_id].to_vec();

    if s.vxlan { // we tunnel over VxLAN
        // regular packet without VxLAN tunnel
        let mut stream_copy = s.clone();
        stream_copy.vxlan = false;

        let p4tg_packet = create_packet(&stream_copy);

        // now we build the VxLAN tunnel
        let mut result = vec![];

        let pkt = etherparse::Ethernet2Header {
            source: [0, 0, 0, 0, 0, 0],
            destination: [0, 0, 0, 0, 0, 0],
            ether_type: 0x800, // IPv4 ether type
        };

        pkt.write(&mut result).unwrap();

        // That's the outer ip header; length frame_size + UDP + VxLAN
        let outer_ip_header = etherparse::Ipv4Header::new((p4tg_packet.len() as u16) + 8 + 8, 64, 17, [0, 0, 0, 0], [0, 0, 0, 0]);
        outer_ip_header.write(&mut result).unwrap();

        let outer_udp_header = etherparse::UdpHeader {
            source_port: 0,
            destination_port: VX_LAN_UDP_PORT,
            // length frame size + UDP + VxLAN
            length: (p4tg_packet.len() as u16) + 8 + 8,
            checksum: 0,
        };

        // we use an "udp" header as VxLAN
        // simply because etherparse has no VxLAN header
        // VNI will be written by dataplane
        let vxlan_header = etherparse::UdpHeader {
            // I flag set, remaining flags and reserved 0 --> 0b00001000000000000000000000000000
            // --> split into two 16 bit fields --> 0b0000100000000000 0b0000000000000000
            source_port: 0b0000100000000000,
            destination_port: 0,
            length: 0,
            checksum: 0,
        };

        let mut vxlan_container = vec![];

        vxlan_header.write(&mut vxlan_container).unwrap();

        vxlan_container.extend_from_slice(&p4tg_packet);

        outer_udp_header.write(&mut result).unwrap();

        result.extend_from_slice(&vxlan_container);

        result
    }
    else { // we don't tunnel over VxLAN
        match encapsulation {
            Encapsulation::None => {
                let builder = PacketBuilder::ethernet2([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])
                    .ipv4([192, 168, 0, 0],
                          [192, 168, 0, 0],
                          64)
                    .udp(P4TG_SOURCE_PORT,
                         P4TG_DST_PORT);

                let size = builder.size(payload.len());
                let encap_overhead = 0;

                // calculate how many remaining bytes need to be generated
                // crc will be added by phy, therefore subtract 4 byte
                let remaining = (frame_size as usize) + encap_overhead - size - 4;
                let padding: Vec<u8> = (0..remaining).map(|_| { rand::random::<u8>() }).collect();

                payload.extend_from_slice(&padding);

                let mut result = Vec::<u8>::with_capacity(builder.size(payload.len()));

                builder.write(&mut result, &payload).unwrap();

                result
            }
            Encapsulation::Vlan => {
                let builder = PacketBuilder::ethernet2([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])
                    .single_vlan(0)
                    .ipv4([192, 168, 0, 0],
                          [192, 168, 0, 0],
                          64)
                    .udp(P4TG_SOURCE_PORT,
                         P4TG_DST_PORT);

                let size = builder.size(payload.len());
                let encap_overhead = 4;

                // calculate how many remaining bytes need to be generated
                // crc will be added by phy, therefore subtract 4 byte
                // but also add 4 byte from overhead
                // crc overhead cancels each other
                let remaining = (frame_size as usize) + encap_overhead - size - 4;
                let padding: Vec<u8> = (0..remaining).map(|_| { rand::random::<u8>() }).collect();

                payload.extend_from_slice(&padding);


                let mut result = Vec::<u8>::with_capacity(builder.size(payload.len()));

                builder.write(&mut result, &payload).unwrap();

                result
            }
            Encapsulation::QinQ => {
                let builder = PacketBuilder::ethernet2([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])
                    .double_vlan(0, 0)
                    .ipv4([192, 168, 0, 0],
                          [192, 168, 0, 0],
                          64)
                    .udp(P4TG_SOURCE_PORT,
                         P4TG_DST_PORT);

                let size = builder.size(payload.len());
                let encap_overhead = 8;

                // calculate how many remaining bytes need to be generated
                // crc will be added by phy, therefore subtract 4 byte
                // but also add 8 bytes from overhead
                // results in + 4
                let remaining = (frame_size as usize) + encap_overhead - size - 4;
                let padding: Vec<u8> = (0..remaining).map(|_| { rand::random::<u8>() }).collect();

                payload.extend_from_slice(&padding);

                let mut result = Vec::<u8>::with_capacity(builder.size(payload.len()));

                builder.write(&mut result, &payload).unwrap();

                result
            }
            Encapsulation::Mpls => {
                let pkt = etherparse::Ethernet2Header {
                    source: [0, 0, 0, 0, 0, 0],
                    destination: [0, 0, 0, 0, 0, 0],
                    ether_type: 0x8847, // MPLS ether type
                };

                let mut result = Vec::<u8>::with_capacity((s.frame_size + s.number_of_lse.unwrap() as u32 * 4) as usize);

                pkt.write(&mut result).unwrap();

                for lse_count in 1..number_of_lse.unwrap() + 1 {

                    // Reuse the VLAN header as an MPLS LSE because both have 4 byte.
                    // This indicates the bottom of the MPLS stack through the "ethertype" field in the VLAN header
                    let ether_type = if lse_count == number_of_lse.unwrap() { 256 } else { 0 };

                    let vlan_header = etherparse::SingleVlanHeader {
                        priority_code_point: 0,
                        drop_eligible_indicator: false,
                        vlan_identifier: 0,
                        ether_type,
                    };

                    vlan_header.write(&mut result).unwrap();
                }

                // Subtract IP header and Ethernet header size and CRC from frame_size to set as payload_len in IPv4 header
                let ip_header = etherparse::Ipv4Header::new((frame_size - 20 - 14 - 4) as u16, 64, 17, [0, 0, 0, 0], [0, 0, 0, 0]);
                ip_header.write(&mut result).unwrap();


                let mut udp_header = etherparse::UdpHeader {
                    source_port: P4TG_SOURCE_PORT,
                    destination_port: P4TG_DST_PORT,
                    // Subtract IP, Ethernet, CRC size
                    length: (frame_size - 20 - 14 - 4) as u16,
                    checksum: 0,
                };

                // Subtract UDP header size und payload (P4tg header) size, pad rest with random data
                let remaining = result.capacity() - result.len() - 8 - payload.len() - 4;
                let padding: Vec<u8> = (0..remaining).map(|_| { rand::random::<u8>() }).collect();

                payload.extend_from_slice(&padding);
                udp_header.checksum = udp_header.calc_checksum_ipv4(&ip_header, &payload).unwrap();

                udp_header.write(&mut result).unwrap();

                result.extend_from_slice(&payload);

                result
            }
        }
    }
}
