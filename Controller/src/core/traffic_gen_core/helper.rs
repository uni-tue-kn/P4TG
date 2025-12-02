use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::core::config::PortDescription;
use crate::core::traffic_gen_core::const_definitions::{
    P4TG_DST_PORT, P4TG_SOURCE_PORT, REMOVE_PORT_CHANNEL_MASK, REMOVE_PORT_CHANNEL_MASK_TOFINO_2,
    VX_LAN_UDP_PORT,
};
use crate::core::traffic_gen_core::types::*;
use crate::{AppState, PortMapping};
use etherparse::{IpHeader, Ipv6RawExtensionHeader, PacketBuilder};
use log::error;
use rbfrt::util::Speed;

// Create a HashMap of front_panel -> dev_port from the port_mapping
pub(crate) fn generate_front_panel_to_dev_port_mappings(
    port_mapping: &HashMap<u32, PortMapping>,
    is_tofino2: bool,
) -> HashMap<u32, u32> {
    let remove_port_channel_mask = if is_tofino2 {
        REMOVE_PORT_CHANNEL_MASK_TOFINO_2
    } else {
        REMOVE_PORT_CHANNEL_MASK
    };

    port_mapping
        .iter()
        .map(|(dev_port, mapping)| {
            (
                mapping.front_panel_port,
                *dev_port & remove_port_channel_mask, // Remove the last three bits to always store channel ID 0 for a front panel port
            )
        })
        .collect()
}

/// Create a HashMap of dev_port -> front_panel from the port_mapping
pub(crate) fn generate_dev_port_to_front_panel_mappings(
    port_mapping: &HashMap<u32, PortMapping>,
) -> HashMap<u32, u32> {
    port_mapping
        .iter()
        .map(|(dev_port, mapping)| (*dev_port, mapping.front_panel_port))
        .collect()
}

/// Build dev_port -> (front_panel, channel) where the channel is encoded in the
/// least-significant 2/3 bits of the dev port.
///
/// Example: if dev_port == 0b..._000 then channel = 0,
///          if dev_port == 0b..._101 then channel = 5, etc.
pub(crate) fn derive_fpch(
    dev_to_fp: &HashMap<u32, u32>,
    is_tofino2: bool,
) -> HashMap<u32, (u32, u8)> {
    let mut dev_to_fpch = HashMap::with_capacity(dev_to_fp.len());

    let channel_mask = if is_tofino2 {
        !REMOVE_PORT_CHANNEL_MASK_TOFINO_2
    } else {
        !REMOVE_PORT_CHANNEL_MASK
    };

    for (&dev, &fp) in dev_to_fp {
        let ch = (dev & channel_mask) as u8; // LSB 2/3 (Tofino2) bits encode the channel (0..7)
        dev_to_fpch.insert(dev, (fp, ch));
    }

    dev_to_fpch
}

pub(crate) fn remap_port_map<V: Clone>(
    src: &HashMap<u32, V>, // dev_port -> V
    dev_to_fpch: &HashMap<u32, (u32, u8)>,
) -> HashMap<u32, HashMap<u8, V>> {
    let mut out: HashMap<u32, HashMap<u8, V>> = HashMap::new();
    for (&dev, v) in src {
        if let Some(&(fp, ch)) = dev_to_fpch.get(&dev) {
            out.entry(fp).or_default().insert(ch, v.clone());
        }
    }
    out
}

pub(crate) fn remap_app_map(
    src: &HashMap<u32, HashMap<u32, f64>>, // dev_port -> app_id -> f64
    dev_to_fpch: &HashMap<u32, (u32, u8)>,
) -> HashMap<u32, HashMap<u8, HashMap<u32, f64>>> {
    let mut out: HashMap<u32, HashMap<u8, HashMap<u32, f64>>> = HashMap::new();
    for (&dev, per_app) in src {
        if let Some(&(fp, ch)) = dev_to_fpch.get(&dev) {
            out.entry(fp).or_default().insert(ch, per_app.clone());
        }
    }
    out
}

/// Remove all keys from `map` that are not contained in `allowed_keys`
pub(crate) fn filter_map_for_keys<K, V>(map: &mut HashMap<K, V>, allowed_keys: &HashSet<K>)
where
    K: Eq + std::hash::Hash,
{
    map.retain(|k, _| allowed_keys.contains(k));
}

/// Collects all ports that may currently be active during traffic generation.
/// Those ports are either contained in one of the stream settings, or in the TX/RX port mapping.
/// This function obtains a lock on the state.
pub(crate) async fn get_used_ports(state: &Arc<AppState>) -> HashSet<u32> {
    let mut used_ports: HashSet<u32> = HashSet::new();

    // Collect ports from active stream settings
    state
        .traffic_generator
        .lock()
        .await
        .stream_settings
        .iter()
        .filter(|s| s.active)
        .for_each(|s| {
            used_ports.insert(s.port);
        });

    // Collect ports from port_mapping
    state
        .traffic_generator
        .lock()
        .await
        .port_mapping
        .iter()
        .for_each(|(tx, channel)| {
            used_ports.insert(tx.parse().unwrap_or(1));
            for rx_target in channel.values() {
                used_ports.insert(rx_target.port);
            }
        });
    used_ports
}

pub(crate) fn translate_fp_channel_to_dev_port_mapping(
    port_tx_rx_mapping: &HashMap<String, HashMap<String, RxTarget>>,
    front_panel_dev_port_mappings: &HashMap<u32, u32>,
) -> HashMap<String, u32> {
    // contains the mapping of Send->Receive ports. Uses the channel info to calculate dev ports
    // required for analyze mode
    let mut tx_rx_port_mapping: HashMap<String, u32> = HashMap::new();
    for (tx_fp, per_ch) in port_tx_rx_mapping {
        let tx_base = *front_panel_dev_port_mappings
            .get(&tx_fp.parse().unwrap_or(u32::MAX))
            .expect("tx fp missing");
        for (
            tx_ch,
            RxTarget {
                port: rx_fp,
                channel: rx_ch,
            },
        ) in per_ch
        {
            let rx_base = *front_panel_dev_port_mappings
                .get(rx_fp)
                .expect("rx fp missing");
            tx_rx_port_mapping.insert(
                (tx_base + tx_ch.parse().unwrap_or(0)).to_string(),
                rx_base + *rx_ch as u32,
            );
        }
    }
    tx_rx_port_mapping
}

pub(crate) fn calculate_overhead(stream: &Stream) -> u32 {
    let mut encapsulation_overhead = match stream.encapsulation {
        Encapsulation::None => 0,
        Encapsulation::Vlan => 4, // VLAN adds 4 bytes
        Encapsulation::QinQ => 8, // QinQ adds 8 bytes
        Encapsulation::Mpls => stream.number_of_lse.unwrap() as u32 * 4, // each mpls label has 4 bytes
        Encapsulation::SRv6 => 40 + 8 + stream.number_of_srv6_sids.unwrap() as u32 * 16, // Base IPv6 Header + SRH + each SID has 16 bytes
    };

    if stream.vxlan {
        encapsulation_overhead += 50; // VxLAN has 50 byte overhead
    }

    encapsulation_overhead
}

/// Maps a configured Speed to its breakout modes, e.g.,400G -> 4x100G
/// Returns a tuple of: (vector of channel indices, per-channel speed, optional number of lanes)
pub(crate) fn breakout_mapping(
    speed: &Speed,
    breakout: bool,
    is_tofino2: bool,
) -> (Vec<u8>, Speed, Option<u32>) {
    if breakout {
        match speed {
            Speed::BF_SPEED_400G => {
                if is_tofino2 {
                    (vec![0, 2, 4, 6], Speed::BF_SPEED_100G, Some(2))
                } else {
                    // 400G unsupported on Tofino1 breakout → fallback to single-lane
                    (vec![0], speed.clone(), None)
                }
            }
            Speed::BF_SPEED_100G => ((0..=3).collect(), Speed::BF_SPEED_25G, None),
            Speed::BF_SPEED_40G => ((0..=3).collect(), Speed::BF_SPEED_10G, None),
            _ => (vec![0], speed.clone(), None), // unsupported combo → fallback to single-lane
        }
    } else {
        (vec![0], speed.clone(), None)
    }
}

// Returns the base speed for a port_description based on the is_tofino2 flag, and the optionally configured speed setting
pub(crate) fn get_base_speed(port_config: &PortDescription, is_tofino2: bool) -> Speed {
    port_config.speed.clone().unwrap_or(if is_tofino2 {
        if port_config.breakout_mode == Some(true) {
            Speed::BF_SPEED_100G
        } else {
            Speed::BF_SPEED_400G
        }
    } else {
        Speed::BF_SPEED_100G
    })
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

    if s.vxlan {
        // we tunnel over VxLAN
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
        let outer_ip_header = etherparse::Ipv4Header::new(
            (p4tg_packet.len() as u16) + 8 + 8,
            64,
            17,
            [0, 0, 0, 0],
            [0, 0, 0, 0],
        );
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
    } else {
        // we don't tunnel over VxLAN
        match encapsulation {
            Encapsulation::None => {
                let builder = match s.ip_version {
                    Some(6) => PacketBuilder::ethernet2([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])
                        .ipv6(
                            [
                                11, 12, 13, 14, 15, 16, 17, 18, 19, 10, 21, 22, 23, 24, 25, 26,
                            ],
                            [
                                31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46,
                            ],
                            64,
                        )
                        .udp(P4TG_SOURCE_PORT, P4TG_DST_PORT),
                    // This covers Some(4) | None | _
                    _ => PacketBuilder::ethernet2([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])
                        .ipv4([192, 168, 0, 0], [192, 168, 0, 0], 64)
                        .udp(P4TG_SOURCE_PORT, P4TG_DST_PORT),
                };

                let size = builder.size(payload.len());
                let encap_overhead = 0;

                // calculate how many remaining bytes need to be generated
                // crc will be added by phy, therefore subtract 4 byte
                // With IPv6, packets are too large and we need to fix an underflow with signed ints
                let remaining = (frame_size as isize + encap_overhead as isize - size as isize - 4)
                    .max(0) as usize;
                let padding: Vec<u8> = (0..remaining).map(|_| rand::random::<u8>()).collect();

                payload.extend_from_slice(&padding);

                let mut result = Vec::<u8>::with_capacity(builder.size(payload.len()));

                builder.write(&mut result, &payload).unwrap();

                result
            }
            Encapsulation::Vlan => {
                let builder = match s.ip_version {
                    Some(6) => PacketBuilder::ethernet2([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])
                        .single_vlan(0)
                        .ipv6(
                            [
                                11, 12, 13, 14, 15, 16, 17, 18, 19, 10, 21, 22, 23, 24, 25, 26,
                            ],
                            [
                                31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46,
                            ],
                            64,
                        )
                        .udp(P4TG_SOURCE_PORT, P4TG_DST_PORT),
                    // This covers Some(4) | None | _
                    _ => PacketBuilder::ethernet2([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])
                        .single_vlan(0)
                        .ipv4([192, 168, 0, 0], [192, 168, 0, 0], 64)
                        .udp(P4TG_SOURCE_PORT, P4TG_DST_PORT),
                };
                let size = builder.size(payload.len());
                let encap_overhead = 4;

                // calculate how many remaining bytes need to be generated
                // crc will be added by phy, therefore subtract 4 byte
                // but also add 4 byte from overhead
                // crc overhead cancels each other
                // With IPv6, packets are too large and we need to fix an underflow with signed ints
                let remaining = (frame_size as isize + encap_overhead as isize - size as isize - 4)
                    .max(0) as usize;
                let padding: Vec<u8> = (0..remaining).map(|_| rand::random::<u8>()).collect();

                payload.extend_from_slice(&padding);

                let mut result = Vec::<u8>::with_capacity(builder.size(payload.len()));

                builder.write(&mut result, &payload).unwrap();

                result
            }
            Encapsulation::QinQ => {
                let builder = match s.ip_version {
                    Some(6) => PacketBuilder::ethernet2([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])
                        .double_vlan(0, 0)
                        .ipv6(
                            [
                                11, 12, 13, 14, 15, 16, 17, 18, 19, 10, 21, 22, 23, 24, 25, 26,
                            ],
                            [
                                31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46,
                            ],
                            64,
                        )
                        .udp(P4TG_SOURCE_PORT, P4TG_DST_PORT),
                    // This covers Some(4) | None | _
                    _ => PacketBuilder::ethernet2([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])
                        .double_vlan(0, 0)
                        .ipv4([192, 168, 0, 0], [192, 168, 0, 0], 64)
                        .udp(P4TG_SOURCE_PORT, P4TG_DST_PORT),
                };

                let size = builder.size(payload.len());
                let encap_overhead = 8;

                // calculate how many remaining bytes need to be generated
                // crc will be added by phy, therefore subtract 4 byte
                // but also add 8 bytes from overhead
                // results in + 4
                // With IPv6, packets are too large and we need to fix an underflow with signed ints
                let remaining = (frame_size as isize + encap_overhead as isize - size as isize - 4)
                    .max(0) as usize;
                let padding: Vec<u8> = (0..remaining).map(|_| rand::random::<u8>()).collect();

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

                let mut result = Vec::<u8>::with_capacity(
                    (s.frame_size + s.number_of_lse.unwrap() as u32 * 4) as usize,
                );

                pkt.write(&mut result).unwrap();

                for lse_count in 1..number_of_lse.unwrap() + 1 {
                    // Reuse the VLAN header as an MPLS LSE because both have 4 byte.
                    // This indicates the bottom of the MPLS stack through the "ethertype" field in the VLAN header
                    let ether_type = if lse_count == number_of_lse.unwrap() {
                        256
                    } else {
                        0
                    };

                    let vlan_header = etherparse::SingleVlanHeader {
                        priority_code_point: 0,
                        drop_eligible_indicator: false,
                        vlan_identifier: 0,
                        ether_type,
                    };

                    vlan_header.write(&mut result).unwrap();
                }

                let ip_header: etherparse::IpHeader = match s.ip_version {
                    Some(6) => etherparse::IpHeader::Version6(
                        etherparse::Ipv6Header {
                            source: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                            destination: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                            hop_limit: 64,
                            payload_length: ((frame_size - 40 - 14 - 4) as u16).max(8),
                            next_header: 17,
                            ..Default::default()
                        },
                        etherparse::Ipv6Extensions::default(),
                    ),
                    // This covers Some(4) | None | _
                    _ =>
                    // Subtract IP header and Ethernet header size and CRC from frame_size to set as payload_len in IPv4 header
                    {
                        etherparse::IpHeader::Version4(
                            etherparse::Ipv4Header::new(
                                (frame_size - 20 - 14 - 4) as u16,
                                64,
                                17,
                                [0, 0, 0, 0],
                                [0, 0, 0, 0],
                            ),
                            etherparse::Ipv4Extensions::default(),
                        )
                    }
                };

                ip_header.write(&mut result).unwrap();

                // Subtract IP, Ethernet, CRC size
                let udp_size = if s.ip_version == Some(6) {
                    ((frame_size - 40 - 14 - 4) as u16).max(8)
                } else {
                    (frame_size - 20 - 14 - 4) as u16
                };
                let mut udp_header = etherparse::UdpHeader {
                    source_port: P4TG_SOURCE_PORT,
                    destination_port: P4TG_DST_PORT,
                    length: udp_size,
                    checksum: 0,
                };

                // Subtract UDP header size und payload (P4tg header) size, pad rest with random data
                let remaining = (result.capacity() as isize
                    - result.len() as isize
                    - 8
                    - payload.len() as isize
                    - 4)
                .max(0);
                let padding: Vec<u8> = (0..remaining).map(|_| rand::random::<u8>()).collect();

                payload.extend_from_slice(&padding);
                match ip_header {
                    IpHeader::Version6(v6, _) => {
                        udp_header.checksum = udp_header.calc_checksum_ipv6(&v6, &payload).unwrap();
                    }
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
                let mut result = Vec::<u8>::with_capacity(
                    (s.frame_size + 40 + 8 + s.number_of_srv6_sids.unwrap() as u32 * 16) as usize,
                );

                pkt.write(&mut result).unwrap();

                let ipv6_base_sr_header = etherparse::Ipv6Header {
                    source: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                    destination: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                    hop_limit: 64,
                    payload_length: ((result.capacity() as isize - 14 - 40 - 4) as u16).max(8),
                    next_header: 43,
                    ..Default::default()
                };

                ipv6_base_sr_header.write(&mut result).unwrap();

                let (next_header_ip_version, inner_ip_header_size) =
                    match (s.ip_version, s.srv6_ip_tunneling) {
                        (Some(4), Some(true)) => (4, 20),  // IPv4
                        (Some(6), Some(true)) => (41, 40), // IPv6
                        (_, _) => (17, 0),                 // UDP
                    };

                let n = number_of_sid.unwrap_or(0);

                // ipv6_type: 4, // Segment routing
                // segments_left: n - 1,
                // last_entry: n - 1,
                // flags: 0,
                // tag: 0, (2 byte)
                // sid_list: sid_list
                let mut extension_hdr_payload: Vec<u8> = vec![4, n - 1, n - 1, 0, 0, 0];
                // Generate SID list
                for _ in 0..n {
                    // :: IPv6 address
                    let address: Vec<u8> = vec![0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
                    extension_hdr_payload.extend(address);
                }

                // IPv6 raw includes the next header field and the length field. All SRH specific fields are added in the payload
                let srh =
                    Ipv6RawExtensionHeader::new_raw(next_header_ip_version, &extension_hdr_payload);

                match srh {
                    Ok(s) => s.write(&mut result).unwrap(),
                    Err(_) => {
                        error!("Invalid payload length for SRH.");
                    }
                }

                let inner_ip_header: Option<IpHeader> = match s.srv6_ip_tunneling {
                    Some(false) => None, // No IP header beneath SRv6 header
                    None | Some(true) => {
                        // Inner IP Header, either v4 or v6
                        let ip_header: etherparse::IpHeader = match s.ip_version {
                            Some(6) => etherparse::IpHeader::Version6(
                                etherparse::Ipv6Header {
                                    source: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    destination: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    hop_limit: 64,
                                    payload_length: ((frame_size as isize
                                        - 14
                                        - inner_ip_header_size
                                        - 4)
                                    .max(8))
                                        as u16,
                                    next_header: 17,
                                    ..Default::default()
                                },
                                etherparse::Ipv6Extensions::default(),
                            ),
                            // This covers Some(4) | None | _
                            _ =>
                            // Subtract IP header and Ethernet header size and CRC from frame_size to set as payload_len in IPv4 header
                            {
                                etherparse::IpHeader::Version4(
                                    etherparse::Ipv4Header::new(
                                        ((frame_size as isize - 14 - inner_ip_header_size - 4)
                                            .max(8)) as u16,
                                        64,
                                        17,
                                        [0, 0, 0, 0],
                                        [0, 0, 0, 0],
                                    ),
                                    etherparse::Ipv4Extensions::default(),
                                )
                            }
                        };
                        ip_header.write(&mut result).unwrap();
                        Some(ip_header)
                    }
                };

                // Subtract Ethernet, CRC size, IPv(4/6), FCS
                let udp_size =
                    ((frame_size as isize - 14 - inner_ip_header_size - 4).max(8)) as u16;
                let mut udp_header = etherparse::UdpHeader {
                    source_port: P4TG_SOURCE_PORT,
                    destination_port: P4TG_DST_PORT,
                    length: udp_size,
                    checksum: 0,
                };

                // Subtract UDP header size und payload (P4tg header) size, pad rest with random data
                let remaining = udp_size - 8 - 11;
                let padding: Vec<u8> = (0..remaining).map(|_| rand::random::<u8>()).collect();

                payload.extend_from_slice(&padding);

                match inner_ip_header {
                    Some(IpHeader::Version6(v6, _)) => {
                        udp_header.checksum = udp_header.calc_checksum_ipv6(&v6, &payload).unwrap();
                    }
                    Some(IpHeader::Version4(v4, _)) => {
                        udp_header.checksum = udp_header.calc_checksum_ipv4(&v4, &payload).unwrap();
                    }
                    None => {
                        udp_header.checksum = udp_header
                            .calc_checksum_ipv6(&ipv6_base_sr_header, &payload)
                            .unwrap();
                    }
                };

                udp_header.write(&mut result).unwrap();

                result.extend_from_slice(&payload);

                result
            }
        }
    }
}

pub fn mpps_to_gbps(total_frame_size: u32, rate_gbps: f32) -> f32 {
    total_frame_size as f32 * 8f32 * rate_gbps / 1000f32
}

/// Decomposes a [start, end] range into a set of ternary (value, mask) entries.
/// Uses bitmask covering similar to prefix expansion.
pub fn range_to_ternary(start: u32, end: u32) -> Vec<(u32, u32)> {
    let mut requests = Vec::new();
    let mut cur = start;

    while cur <= end {
        let remaining = end - cur;
        if remaining == 0 {
            // Handle a single value case explicitly
            requests.push((cur, 0xFFFFFFFF));
            break;
        }

        let max_block_size = 1 << (31 - remaining.leading_zeros()); // largest power of two ≤ remaining
        let align_size = if cur == 0 {
            1
        } else {
            1 << cur.trailing_zeros()
        }; // alignment constraint
        let size = max_block_size.min(align_size);

        let mask = !(size - 1);

        requests.push((cur, mask));

        cur += size;
    }

    requests
}

/// Convert a closed integer range [start, end] into a minimal set of LPM prefixes over u32.
pub fn range_to_prefixes(start: u32, end: u32) -> Vec<(u32, u8)> {
    let mut res = Vec::new();
    let mut cur = start as u64;
    let end_u64 = end as u64;

    while cur <= end_u64 {
        let remaining = end_u64 - cur + 1;

        // Start from largest possible block and shrink until:
        //  - it's aligned at `cur`
        //  - it fits within `remaining`
        let mut block_size: u64 = 1 << 31;

        loop {
            let aligned = (cur & (block_size - 1)) == 0;
            if aligned && block_size <= remaining {
                break;
            }
            block_size >>= 1;
        }

        let prefix_len = 32 - block_size.trailing_zeros();
        res.push((cur as u32, prefix_len as u8));

        cur += block_size;
    }

    res
}
