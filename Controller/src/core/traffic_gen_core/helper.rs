use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::core::traffic_gen_core::const_definitions::{
    GTPU_UDP_PORT, P4TG_DST_PORT, P4TG_SOURCE_PORT, REMOVE_PORT_CHANNEL_MASK,
    REMOVE_PORT_CHANNEL_MASK_TOFINO_2, VX_LAN_UDP_PORT,
};
use crate::core::traffic_gen_core::types::*;
use crate::{AppState, PortMapping};
use etherparse::{IpHeader, Ipv6RawExtensionHeader, PacketBuilder};
use log::error;
use rbfrt::util::{Speed, FEC};

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

    if stream.encapsulation == Encapsulation::Mpls && stream.detnet_cw == Some(true) {
        encapsulation_overhead += 4; // dCW adds 4 bytes after the MPLS stack
    }

    if stream.vxlan || stream.gtpu {
        encapsulation_overhead += 50; // VxLAN has 50 byte overhead
    }

    encapsulation_overhead
}

#[derive(Clone, Debug)]
pub(crate) struct ResolvedPortMode {
    pub channels: Vec<u8>,
    pub speed: Speed,
    pub n_lanes: Option<u32>,
}

#[derive(Clone, Debug)]
pub(crate) struct ResolvedPortLayout {
    pub front_panel: ResolvedPortMode,
    pub recirculation: ResolvedPortMode,
}

pub(crate) fn effective_channel_count(channel_count: Option<u8>) -> u8 {
    channel_count.unwrap_or(1)
}

pub(crate) fn resolve_front_panel_mode(
    speed: &Speed,
    channel_count: Option<u8>,
    is_tofino2: bool,
) -> Option<ResolvedPortMode> {
    match effective_channel_count(channel_count) {
        1 => {
            if *speed == Speed::BF_SPEED_400G && !is_tofino2 {
                None
            } else {
                Some(ResolvedPortMode {
                    channels: vec![0],
                    speed: speed.clone(),
                    n_lanes: None,
                })
            }
        }
        4 => match speed {
            Speed::BF_SPEED_10G => Some(ResolvedPortMode {
                channels: (0..=3).collect(),
                speed: Speed::BF_SPEED_10G,
                n_lanes: None,
            }),
            Speed::BF_SPEED_25G => Some(ResolvedPortMode {
                channels: (0..=3).collect(),
                speed: Speed::BF_SPEED_25G,
                n_lanes: None,
            }),
            Speed::BF_SPEED_100G if is_tofino2 => Some(ResolvedPortMode {
                channels: vec![0, 2, 4, 6],
                speed: Speed::BF_SPEED_100G,
                n_lanes: Some(2),
            }),
            _ => None,
        },
        8 => match speed {
            Speed::BF_SPEED_10G | Speed::BF_SPEED_25G | Speed::BF_SPEED_50G if is_tofino2 => {
                Some(ResolvedPortMode {
                    channels: (0..=7).collect(),
                    speed: speed.clone(),
                    n_lanes: Some(1),
                })
            }
            _ => None,
        },
        _ => None,
    }
}

pub(crate) fn resolve_recirculation_mode(
    speed: &Speed,
    channel_count: Option<u8>,
    is_tofino2: bool,
) -> Option<ResolvedPortMode> {
    match effective_channel_count(channel_count) {
        1 => Some(ResolvedPortMode {
            channels: vec![0],
            speed: if is_tofino2 {
                Speed::BF_SPEED_400G
            } else {
                Speed::BF_SPEED_100G
            },
            n_lanes: None,
        }),
        4 => match speed {
            Speed::BF_SPEED_100G if is_tofino2 => Some(ResolvedPortMode {
                channels: vec![0, 2, 4, 6],
                speed: Speed::BF_SPEED_100G,
                n_lanes: Some(2),
            }),
            Speed::BF_SPEED_10G | Speed::BF_SPEED_25G => Some(ResolvedPortMode {
                channels: (0..=3).collect(),
                speed: Speed::BF_SPEED_25G,
                n_lanes: None,
            }),
            _ => None,
        },
        8 => {
            if is_tofino2 {
                Some(ResolvedPortMode {
                    channels: (0..=7).collect(),
                    speed: Speed::BF_SPEED_50G,
                    n_lanes: Some(1),
                })
            } else {
                None
            }
        }
        _ => None,
    }
}

pub(crate) fn resolve_port_layout(
    speed: &Speed,
    channel_count: Option<u8>,
    is_tofino2: bool,
) -> Option<ResolvedPortLayout> {
    Some(ResolvedPortLayout {
        front_panel: resolve_front_panel_mode(speed, channel_count, is_tofino2)?,
        recirculation: resolve_recirculation_mode(speed, channel_count, is_tofino2)?,
    })
}

pub(crate) fn default_fec(speed: &Speed, channel_count: Option<u8>) -> FEC {
    if requires_rs(speed, channel_count) {
        FEC::BF_FEC_TYP_REED_SOLOMON
    } else {
        FEC::BF_FEC_TYP_NONE
    }
}

pub(crate) fn sanitize_fec(speed: &Speed, channel_count: Option<u8>, requested: FEC) -> FEC {
    if requires_rs(speed, channel_count) {
        FEC::BF_FEC_TYP_REED_SOLOMON
    } else if matches!(speed, Speed::BF_SPEED_10G | Speed::BF_SPEED_40G)
        && requested == FEC::BF_FEC_TYP_REED_SOLOMON
        || (*speed == Speed::BF_SPEED_100G && requested == FEC::BF_FEC_TYP_FC)
    {
        FEC::BF_FEC_TYP_NONE
    } else {
        requested
    }
}

fn requires_rs(speed: &Speed, channel_count: Option<u8>) -> bool {
    *speed == Speed::BF_SPEED_400G
        || (*speed == Speed::BF_SPEED_50G && effective_channel_count(channel_count) != 4)
        || (*speed == Speed::BF_SPEED_100G && effective_channel_count(channel_count) == 4)
}

/// Creates a packet with `frame_size` bytes and `encapsulation` (e.g., VLAN)
///
/// `frame_size` is L2 size **WITHOUT** encapsulation and without preamble and IFG.
/// Therefore the remaining filler bytes take the encapsulation into account.
pub(crate) fn create_packet(s: &Stream, is_gtpu_payload: bool) -> Vec<u8> {
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

        let p4tg_packet = create_packet(&stream_copy, false);

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
    } else if s.gtpu {
        // we tunnel over GTP-U
        // regular packet without GTP-U tunnel
        let mut stream_copy = s.clone();
        stream_copy.gtpu = false;

        let p4tg_packet = create_packet(&stream_copy, true);

        // now we build the GTP-U tunnel
        let mut result = vec![];

        let pkt = etherparse::Ethernet2Header {
            source: [0, 0, 0, 0, 0, 0],
            destination: [0, 0, 0, 0, 0, 0],
            ether_type: 0x800,
        };

        pkt.write(&mut result).unwrap();

        // That's the outer ip header; length frame_size + UDP + GTP-U
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
            destination_port: GTPU_UDP_PORT,
            // length frame size + UDP + GTP-U
            length: (p4tg_packet.len() as u16) + 8 + 8,
            checksum: 0,
        };

        // we use an "udp" header as GTP-U
        // simply because etherparse has no GTP-U header
        // TEID will be written by dataplane
        let gtpu_header = etherparse::UdpHeader {
            /*
            flags + message type of GTP-U header:
             GTP-U flags: bit 0-2: Version,
             bit 3: Protocol type,
             bit 4: Reserved,
             bit 5: Extension header flag,
             bit 6: Sequence number flag,
             bit 7: N-PDU number flag
             message_type: always 0xff (user data)*/
            source_port: 0b00110000_11111111,
            destination_port: p4tg_packet.len() as u16, // length field of GTP-U header
            length: 0,                                  // First half of TEID
            checksum: 0, // Second half of TEID, will be filled by data plane
        };

        let mut gtpu_container = vec![];

        gtpu_header.write(&mut gtpu_container).unwrap();

        gtpu_container.extend_from_slice(&p4tg_packet);

        outer_udp_header.write(&mut result).unwrap();

        result.extend_from_slice(&gtpu_container);

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
                    _ => {
                        if is_gtpu_payload {
                            // The GTP-U Payload has no Ethernet header
                            PacketBuilder::ipv4([192, 168, 0, 0], [192, 168, 0, 0], 64)
                                .udp(P4TG_SOURCE_PORT, P4TG_DST_PORT)
                        } else {
                            PacketBuilder::ethernet2([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])
                                .ipv4([192, 168, 0, 0], [192, 168, 0, 0], 64)
                                .udp(P4TG_SOURCE_PORT, P4TG_DST_PORT)
                        }
                    }
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
                let detnet_cw_overhead = if s.detnet_cw == Some(true) { 4 } else { 0 };
                let packet_capacity = (s.frame_size
                    + s.number_of_lse.unwrap() as u32 * 4
                    + detnet_cw_overhead) as usize;

                let mut result = Vec::<u8>::with_capacity(packet_capacity);

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

                if s.detnet_cw == Some(true) {
                    // Write another "empty VLAN header", aka 32 bits.
                    let d_cw_lse = etherparse::SingleVlanHeader {
                        priority_code_point: 0,
                        drop_eligible_indicator: false,
                        vlan_identifier: 0,
                        ether_type: 0,
                    };
                    d_cw_lse.write(&mut result).unwrap();
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
                let remaining = (packet_capacity as isize
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
        if cur == end {
            requests.push((cur, 0xFFFFFFFF));
            break;
        }

        let num_remaining = end - cur + 1; // count of values in [cur, end]
        let max_block_size = 1u32 << (31 - num_remaining.leading_zeros()); // largest power of two ≤ count
        let align_size = if cur == 0 {
            1u32 << 31 // cur == 0 is maximally aligned
        } else {
            1u32 << cur.trailing_zeros()
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

/// Determine the number of pipes to use for a stream based on its configuration.
pub fn get_num_pipes(s: &Stream, max_pipes: u32) -> u32 {
    if let Some(batches) = s.batches {
        if !batches && s.burst == 1 {
            // IAT mode with no batches: Generate on a single pipe only
            1
        } else {
            // In all other cases: use all available pipes
            max_pipes
        }
    } else {
        max_pipes
    }
}
