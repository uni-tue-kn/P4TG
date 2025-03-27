use etherparse::{IpHeader, Ipv6RawExtensionHeader, PacketBuilder};
use log::error;
use crate::core::traffic_gen_core::const_definitions::{P4TG_DST_PORT, P4TG_SOURCE_PORT, VX_LAN_UDP_PORT};
use crate::core::traffic_gen_core::types::*;

impl BIER {
    fn write<T: std::io::Write>(&self, buf: &mut T) -> std::io::Result<()> {
        buf.write_all(&self.bs.to_be_bytes())?;
        buf.write_all(&self.si.to_be_bytes())?;
        buf.write_all(&self.proto.to_be_bytes())?;
        Ok(())
    }
}

pub(crate) fn calculate_overhead(stream: &Stream) -> u32 {
    let mut encapsulation_overhead = match stream.encapsulation {
        Encapsulation::None => 0,
        Encapsulation::Vlan => 4, // VLAN adds 4 bytes
        Encapsulation::QinQ => 8, // QinQ adds 8 bytes
        Encapsulation::Mpls => stream.number_of_lse.unwrap() as u32 * 4, // each mpls label has 4 bytes
        Encapsulation::SRv6 => 40 + 8 + stream.number_of_srv6_sids.unwrap() as u32 * 16, // Base IPv6 Header + SRH + each SID has 16 bytes
        Encapsulation::Bier => std::mem::size_of::<BIER>() as u32, // With 64 bit BS
        Encapsulation::BierWithMPLS => std::mem::size_of::<BIER>() as u32 + stream.number_of_lse.unwrap() as u32 * 4 as u32
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
    let number_of_sid = s.number_of_srv6_sids;

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
            ether_type: 0x800, 
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
                let builder = match s.ip_version {
                    Some(6) => PacketBuilder::ethernet2([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])
                                .ipv6([11,12,13,14,15,16,17,18,19,10,21,22,23,24,25,26],
                                    [31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46],
                                    64)
                                .udp(P4TG_SOURCE_PORT,
                                    P4TG_DST_PORT),
                    Some(4) | None | _ => PacketBuilder::ethernet2([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])
                                .ipv4([192, 168, 0, 0],
                                    [192, 168, 0, 0],
                                    64)
                                .udp(P4TG_SOURCE_PORT,
                                    P4TG_DST_PORT)
                };

                let size = builder.size(payload.len());
                let encap_overhead = 0;

                // calculate how many remaining bytes need to be generated
                // crc will be added by phy, therefore subtract 4 byte
                // With IPv6, packets are too large and we need to fix an underflow with signed ints
                let remaining = (frame_size as isize + encap_overhead as isize - size as isize - 4).max(0) as usize;
                let padding: Vec<u8> = (0..remaining).map(|_| { rand::random::<u8>() }).collect();

                payload.extend_from_slice(&padding);

                let mut result = Vec::<u8>::with_capacity(builder.size(payload.len()));

                builder.write(&mut result, &payload).unwrap();

                result
            }
            Encapsulation::Vlan => {
                let builder = match s.ip_version {
                    Some(6) => PacketBuilder::ethernet2([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])
                                .single_vlan(0)
                                .ipv6([11,12,13,14,15,16,17,18,19,10,21,22,23,24,25,26],
                                    [31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46],
                                    64)
                                .udp(P4TG_SOURCE_PORT,
                                    P4TG_DST_PORT),
                    Some(4) | None | _ => 
                        PacketBuilder::ethernet2([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])
                            .single_vlan(0)
                            .ipv4([192, 168, 0, 0],
                                [192, 168, 0, 0],
                                64)
                            .udp(P4TG_SOURCE_PORT,
                                P4TG_DST_PORT),
                };
                let size = builder.size(payload.len());
                let encap_overhead = 4;

                // calculate how many remaining bytes need to be generated
                // crc will be added by phy, therefore subtract 4 byte
                // but also add 4 byte from overhead
                // crc overhead cancels each other
                // With IPv6, packets are too large and we need to fix an underflow with signed ints
                let remaining = (frame_size as isize + encap_overhead as isize - size as isize - 4).max(0) as usize;
                let padding: Vec<u8> = (0..remaining).map(|_| { rand::random::<u8>() }).collect();

                payload.extend_from_slice(&padding);


                let mut result = Vec::<u8>::with_capacity(builder.size(payload.len()));

                builder.write(&mut result, &payload).unwrap();

                result
            }
            Encapsulation::QinQ => {

                let builder = match s.ip_version {
                        Some(6) => 
                            PacketBuilder::ethernet2([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])
                                .double_vlan(0, 0)
                                .ipv6([11,12,13,14,15,16,17,18,19,10,21,22,23,24,25,26],
                                    [31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46],
                                    64)
                                .udp(P4TG_SOURCE_PORT,
                                    P4TG_DST_PORT),
                        Some(4) | None | _ =>
                             PacketBuilder::ethernet2([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])
                                .double_vlan(0, 0)
                                .ipv4([192, 168, 0, 0],
                                    [192, 168, 0, 0],
                                    64)
                                .udp(P4TG_SOURCE_PORT,
                                    P4TG_DST_PORT)
                };

                let size = builder.size(payload.len());
                let encap_overhead = 8;

                // calculate how many remaining bytes need to be generated
                // crc will be added by phy, therefore subtract 4 byte
                // but also add 8 bytes from overhead
                // results in + 4
                // With IPv6, packets are too large and we need to fix an underflow with signed ints
                let remaining = (frame_size as isize + encap_overhead as isize - size as isize - 4).max(0) as usize;
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

                let ip_header: etherparse::IpHeader = match s.ip_version {
                    Some(6) => 
                        etherparse::IpHeader::Version6(etherparse::Ipv6Header {
                            source: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                            destination: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                            hop_limit: 64,
                            payload_length: ((frame_size - 40 - 14 - 4) as u16).max(8),
                            next_header: 17,
                            ..Default::default()
                        }, etherparse::Ipv6Extensions::default()),
                    Some(4) | None | _ => 
                        // Subtract IP header and Ethernet header size and CRC from frame_size to set as payload_len in IPv4 header
                        etherparse::IpHeader::Version4(etherparse::Ipv4Header::new((frame_size - 20 - 14 - 4) as u16, 
                                                                    64, 17, [0, 0, 0, 0], [0, 0, 0, 0]),
                                                        etherparse::Ipv4Extensions::default())
                };

                ip_header.write(&mut result).unwrap();

                // Subtract IP, Ethernet, CRC size
                let udp_size = if s.ip_version == Some(6) {((frame_size - 40 - 14 - 4) as u16).max(8)} else {(frame_size - 20 - 14 - 4) as u16};
                let mut udp_header = etherparse::UdpHeader {
                    source_port: P4TG_SOURCE_PORT,
                    destination_port: P4TG_DST_PORT,
                    length: udp_size,
                    checksum: 0,
                };

                // Subtract UDP header size und payload (P4tg header) size, pad rest with random data
                let remaining = (result.capacity() as isize - result.len() as isize - 8 - payload.len() as isize - 4).max(0);
                let padding: Vec<u8> = (0..remaining).map(|_| { rand::random::<u8>() }).collect();

                payload.extend_from_slice(&padding);
                match ip_header {
                    IpHeader::Version6(v6, _) => {
                        udp_header.checksum = udp_header.calc_checksum_ipv6(&v6, &payload).unwrap();
                    },
                    IpHeader::Version4(v4, _) => {
                        udp_header.checksum = udp_header.calc_checksum_ipv4(&v4, &payload).unwrap();
                    }
                }

                udp_header.write(&mut result).unwrap();

                result.extend_from_slice(&payload);

                result
            }
            Encapsulation::SRv6 => {
                let pkt = etherparse::Ethernet2Header {
                    source: [0, 0, 0, 0, 0, 0],
                    destination: [0, 0, 0, 0, 0, 0],
                    ether_type: 0x86dd, // IPv6 ether type
                };

                // Frame size + Base IPv6 Header + SRH + SID list
                let mut result = Vec::<u8>::with_capacity((s.frame_size + 40 + 8 + s.number_of_srv6_sids.unwrap() as u32 * 16) as usize);

                pkt.write(&mut result).unwrap();

                let ipv6_base_sr_header= etherparse::Ipv6Header {
                            source: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                            destination: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                            hop_limit: 64,
                            payload_length: ((result.capacity() as isize - 14 - 40 - 4) as u16).max(8),
                            next_header: 43,
                            ..Default::default()
                };

                ipv6_base_sr_header.write(&mut result).unwrap();

                let (next_header_ip_version, inner_ip_header_size) = match (s.ip_version, s.srv6_ip_tunneling) {
                    (Some(4), Some(true)) => (4, 20),  // IPv4
                    (Some(6), Some(true)) => (41, 40), // IPv6
                    (_, _) =>  (17, 0)// UDP
                };

                let n = match number_of_sid {
                    Some(n) => n,
                    None => 0 // This can never happen as the number is validated before
                };          

                // ipv6_type: 4, // Segment routing
                // segments_left: n - 1,
                // last_entry: n - 1,
                // flags: 0,
                // tag: 0, (2 byte)
                // sid_list: sid_list
                let mut extension_hdr_payload: Vec<u8> = vec![4, n-1, n-1, 0, 0, 0];
                // Generate SID list
                for _ in 0..n {
                    // :: IPv6 address
                    let address: Vec<u8> = vec![0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
                    extension_hdr_payload.extend(address);
                }      

                // IPv6 raw includes the next header field and the length field. All SRH specific fields are added in the payload
                let srh = Ipv6RawExtensionHeader::new_raw(next_header_ip_version, &extension_hdr_payload);

                match srh {
                    Ok(s) => s.write(&mut result).unwrap(),
                    Err(_) => {error!("Invalid payload length for SRH."); ()}
                }

                let inner_ip_header: Option<IpHeader> = match s.srv6_ip_tunneling {
                    Some(false) => None, // No IP header beneath SRv6 header
                    None | Some(true) => {
                        // Inner IP Header, either v4 or v6
                        let ip_header: etherparse::IpHeader = match s.ip_version {
                            Some(6) => 
                                etherparse::IpHeader::Version6(etherparse::Ipv6Header {
                                    source: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    destination: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    hop_limit: 64,
                                    payload_length: ((frame_size as isize - 14 - inner_ip_header_size - 4).max(8)) as u16,
                                    next_header: 17,
                                    ..Default::default()
                                }, etherparse::Ipv6Extensions::default()),
                            Some(4) | None | _ => 
                                // Subtract IP header and Ethernet header size and CRC from frame_size to set as payload_len in IPv4 header
                                etherparse::IpHeader::Version4(etherparse::Ipv4Header::new(((frame_size as isize - 14 - inner_ip_header_size - 4).max(8)) as u16, 
                                                                            64, 17, [0, 0, 0, 0], [0, 0, 0, 0]),
                                                                etherparse::Ipv4Extensions::default())
                                
                        };
                        ip_header.write(&mut result).unwrap();
                        Some(ip_header)
                    }
                };

                // Subtract Ethernet, CRC size, IPv(4/6), FCS
                let udp_size = ((frame_size as isize - 14 - inner_ip_header_size - 4).max(8)) as u16;
                let mut udp_header = etherparse::UdpHeader {
                    source_port: P4TG_SOURCE_PORT,
                    destination_port: P4TG_DST_PORT,
                    length: udp_size,
                    checksum: 0,
                };

                // Subtract UDP header size und payload (P4tg header) size, pad rest with random data
                let remaining = (udp_size - 8 - 11).max(0);
                let padding: Vec<u8> = (0..remaining).map(|_| { rand::random::<u8>() }).collect();

                payload.extend_from_slice(&padding);

                match inner_ip_header {
                    Some(IpHeader::Version6(v6, _ )) => {
                        udp_header.checksum = udp_header.calc_checksum_ipv6(&v6, &payload).unwrap();
                    },
                    Some(IpHeader::Version4(v4, _ )) => {
                        udp_header.checksum = udp_header.calc_checksum_ipv4(&v4, &payload).unwrap();
                    },
                    None => {
                        udp_header.checksum = udp_header.calc_checksum_ipv6(&ipv6_base_sr_header, &payload).unwrap();
                    }                    
                };

                udp_header.write(&mut result).unwrap();

                result.extend_from_slice(&payload);

                result
            }
            Encapsulation::Bier => {
                let pkt = etherparse::Ethernet2Header {
                    source: [0, 0, 0, 0, 0, 0],
                    destination: [0, 0, 0, 0, 0, 0],
                    ether_type: 0xbb00, // BIER ether type
                };

                // Frame size + BIER header with 64 bit BS
                let mut result = Vec::<u8>::with_capacity((s.frame_size + std::mem::size_of::<BIER>() as u32) as usize);                             

                pkt.write(&mut result).unwrap();

                // Create the BIER header
                let next_protocol = if s.ip_version == Some(6) {0x86dd} else {0x800};
                let bier_header = BIER {
                    bs: 0,
                    si: 0,
                    proto: next_protocol,
                };

                // Write the BIER header into the result buffer
                bier_header.write(&mut result).unwrap();


                // Add IP header
                let ip_header: etherparse::IpHeader = match s.ip_version {
                    Some(6) => 
                        etherparse::IpHeader::Version6(etherparse::Ipv6Header {
                            source: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                            destination: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                            hop_limit: 64,
                            payload_length: ((frame_size - 40 - 14 - 4) as u16).max(8),
                            next_header: 17,
                            ..Default::default()
                        }, etherparse::Ipv6Extensions::default()),
                    Some(4) | None | _ => 
                        // Subtract IP header and Ethernet header size and CRC from frame_size to set as payload_len in IPv4 header
                        etherparse::IpHeader::Version4(etherparse::Ipv4Header::new((frame_size - 20 - 14 - 4) as u16, 
                                                                    64, 17, [0, 0, 0, 0], [0, 0, 0, 0]),
                                                        etherparse::Ipv4Extensions::default())
                };

                ip_header.write(&mut result).unwrap();

                // Subtract IP, Ethernet, CRC size
                let udp_size = if s.ip_version == Some(6) {((frame_size - 40 - 14 - 4) as u16).max(8)} else {(frame_size - 20 - 14 - 4) as u16};
                let mut udp_header = etherparse::UdpHeader {
                    source_port: P4TG_SOURCE_PORT,
                    destination_port: P4TG_DST_PORT,
                    length: udp_size,
                    checksum: 0,
                };

                // Subtract UDP header size und payload (P4tg header) size, pad rest with random data
                let remaining = (result.capacity() as isize - result.len() as isize - 8 - payload.len() as isize - 4).max(0);
                let padding: Vec<u8> = (0..remaining).map(|_| { rand::random::<u8>() }).collect();

                payload.extend_from_slice(&padding);
                match ip_header {
                    IpHeader::Version6(v6, _) => {
                        udp_header.checksum = udp_header.calc_checksum_ipv6(&v6, &payload).unwrap();
                    },
                    IpHeader::Version4(v4, _) => {
                        udp_header.checksum = udp_header.calc_checksum_ipv4(&v4, &payload).unwrap();
                    }
                }

                udp_header.write(&mut result).unwrap();

                result.extend_from_slice(&payload);

                result
            }
            Encapsulation::BierWithMPLS => {
                let pkt = etherparse::Ethernet2Header {
                    source: [0, 0, 0, 0, 0, 0],
                    destination: [0, 0, 0, 0, 0, 0],
                    ether_type: 0x8847, // MPLS ether type
                };

                let mut result = Vec::<u8>::with_capacity((s.frame_size + s.number_of_lse.unwrap() as u32 * 4 + std::mem::size_of::<BIER>() as u32) as usize);

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

                // Create the BIER header
                let next_protocol = if s.ip_version == Some(6) {0x86dd} else {0x800};
                let bier_header = BIER {
                    // TODO change here if BS size changes
                    bs: 0b1111 << 60,   // 4 MSB bits must be set to 1 in our implementation (first nibble after MPLS)
                    si: 0,
                    proto: next_protocol,
                };

                // Write the BIER header into the result buffer
                bier_header.write(&mut result).unwrap();

                // Add IP header
                let ip_header: etherparse::IpHeader = match s.ip_version {
                    Some(6) => 
                        etherparse::IpHeader::Version6(etherparse::Ipv6Header {
                            source: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                            destination: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                            hop_limit: 64,
                            payload_length: ((frame_size - 40 - 14 - 4) as u16).max(8),
                            next_header: 17,
                            ..Default::default()
                        }, etherparse::Ipv6Extensions::default()),
                    Some(4) | None | _ => 
                        // Subtract IP header and Ethernet header size and CRC from frame_size to set as payload_len in IPv4 header
                        etherparse::IpHeader::Version4(etherparse::Ipv4Header::new((frame_size - 20 - 14 - 4) as u16, 
                                                                    64, 17, [0, 0, 0, 0], [0, 0, 0, 0]),
                                                        etherparse::Ipv4Extensions::default())
                };

                ip_header.write(&mut result).unwrap();

                // Subtract IP, Ethernet, CRC size
                let udp_size = if s.ip_version == Some(6) {((frame_size - 40 - 14 - 4) as u16).max(8)} else {(frame_size - 20 - 14 - 4) as u16};
                let mut udp_header = etherparse::UdpHeader {
                    source_port: P4TG_SOURCE_PORT,
                    destination_port: P4TG_DST_PORT,
                    length: udp_size,
                    checksum: 0,
                };

                // Subtract UDP header size und payload (P4tg header) size, pad rest with random data
                let remaining = (result.capacity() as isize - result.len() as isize - 8 - payload.len() as isize - 4).max(0);
                let padding: Vec<u8> = (0..remaining).map(|_| { rand::random::<u8>() }).collect();

                payload.extend_from_slice(&padding);
                match ip_header {
                    IpHeader::Version6(v6, _) => {
                        udp_header.checksum = udp_header.calc_checksum_ipv6(&v6, &payload).unwrap();
                    },
                    IpHeader::Version4(v4, _) => {
                        udp_header.checksum = udp_header.calc_checksum_ipv4(&v4, &payload).unwrap();
                    }
                }

                udp_header.write(&mut result).unwrap();

                result.extend_from_slice(&payload);

                result                

            }
        }
    }
}
