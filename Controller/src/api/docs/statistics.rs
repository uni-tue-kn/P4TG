use std::collections::HashMap;
use aide::transform::TransformOperation;
use crate::api::docs::extractor::Json;
use crate::api::statistics::Statistics;
use crate::core::statistics::{IATStatistics, IATValues, RangeCount, RangeCountValue, RTTStatistics, TypeCount};

pub fn get_statistics(op: TransformOperation) -> TransformOperation {
    op.description("The GET /statistics endpoint is used to query the current statistics of the traffic generator.")
        .summary("/statistics")
        .tag("Statistics")
        .response_with::<200, Json<Statistics>, _>(|res| {
            res.example(Statistics {
                sample_mode: false,
                frame_size: HashMap::from([(52, RangeCount {
                    tx: vec![
                        RangeCountValue {
                            low: 0,
                            high: 63,
                            packets: 0,
                        },
                        RangeCountValue {
                            low: 64,
                            high: 64,
                            packets: 20,
                        },
                        RangeCountValue {
                            low: 65,
                            high: 127,
                            packets: 200,
                        }],
                    rx: vec![
                        RangeCountValue {
                            low: 0,
                            high: 63,
                            packets: 0,
                        },
                        RangeCountValue {
                            low: 64,
                            high: 64,
                            packets: 20,
                        },
                        RangeCountValue {
                            low: 65,
                            high: 127,
                            packets: 200,
                        }],
                })]),
                tx_rate_l1: HashMap::from([(152, 98921071153.39397), (184, 0.0)]),
                tx_rate_l2: HashMap::from([(152, 94848020788.1936), (184, 0.0)]),
                rx_rate_l1: HashMap::from([(152, 98921071153.39397), (184, 0.0)]),
                rx_rate_l2: HashMap::from([(152, 94848020788.1936), (184, 0.0)]),
                app_tx_l2: HashMap::from([(152, HashMap::from([(1, 94848020788.1936), (2, 0.0), (3, 0.0)]))]),
                app_rx_l2: HashMap::from([(152, HashMap::from([(1, 94848020788.1936), (2, 0.0), (3, 0.0)]))]),
                frame_type_data: HashMap::from([(184, TypeCount {
                    tx: HashMap::from([("ipv6".to_owned(), 0), ("ipv4".to_owned(), 100), ("unicast".to_owned(), 100), ("multicast".to_owned(), 0), ("qinq".to_owned(), 0), ("vlan".to_owned(), 0), ("unknown".to_owned(), 0)]),
                    rx: HashMap::from([("ipv6".to_owned(), 0), ("ipv4".to_owned(), 100), ("unicast".to_owned(), 100), ("multicast".to_owned(), 0), ("qinq".to_owned(), 0), ("vlan".to_owned(), 0), ("unknown".to_owned(), 0)])
                })]),
                iats: HashMap::from([(152, IATStatistics{
                    tx: IATValues {
                        mean: 8.5,
                        std: None,
                        mae: 1.1,
                        n: 1,
                    },
                    rx: IATValues {
                        mean: 8.5,
                        std: None,
                        mae: 1.1,
                        n: 1,
                    } })]),
                rtts: HashMap::from([(152, RTTStatistics{
                    mean: 1134.09,
                    min: 1112,
                    max: 1159,
                    current: 1133,
                    jitter: 17.64,
                    n: 50,
                })]),
                packet_loss: HashMap::from([(152, 5), (184, 0)]),
                out_of_order: HashMap::from([(152, 0), (184, 0)]),
                elapsed_time: 50,
            }).description("Statistics successfully fetched.")
        })
}