import {
  Statistics,
  StreamSettings,
  Stream,
  TimeStatistics,
  Encapsulation,
  TrafficGenData,
} from "../Interfaces";

export const get_frame_types = (
  stats: Statistics,
  port_mapping: { [name: number]: number },
  type: string
): { tx: number; rx: number } => {
  let ret = { tx: 0, rx: 0 };

  // if (!["multicast", "broadcast", "unicast", "total", "non-unicast", "vlan", "ipv4", "ipv6", "qinq", "unknown"].includes(type)) {
  //     return ret
  // }

  if (stats.frame_type_data === undefined) {
    return ret;
  }

  Object.keys(stats.frame_type_data).forEach((v: string) => {
    if (Object.keys(port_mapping).includes(v)) {
      // @ts-ignore
      if (!(type in stats.frame_type_data[v].tx)) {
        ret.tx += 0;
      } else {
        // @ts-ignore
        ret.tx += stats.frame_type_data[v].tx[type];
      }
    }

    if (Object.values(port_mapping).map(Number).includes(parseInt(v))) {
      // @ts-ignore
      if (!(type in stats.frame_type_data[v].rx)) {
        ret.rx += 0;
      } else {
        // @ts-ignore
        ret.rx += stats.frame_type_data[v].rx[type];
      }
    }
  });

  return ret;
};
export const get_lost_packets = (
  stats: Statistics,
  port_mapping: { [name: number]: number }
) => {
  let ret = 0;

  Object.keys(stats.packet_loss).forEach((v) => {
    if (Object.values(port_mapping).map(Number).includes(parseInt(v))) {
      ret += stats.packet_loss[v];
    }
  });

  return ret;
};
export const get_out_of_order_packets = (
  stats: Statistics,
  port_mapping: { [name: number]: number }
) => {
  let ret = 0;

  Object.keys(stats.out_of_order).forEach((v) => {
    if (Object.values(port_mapping).map(Number).includes(parseInt(v))) {
      ret += stats.out_of_order[v];
    }
  });

  return ret;
};
export const get_frame_stats = (
  stats: Statistics,
  port_mapping: { [name: number]: number },
  type: string,
  low: number,
  high: number
) => {
  let ret = 0;

  if (stats.frame_size === undefined || port_mapping === undefined) {
    return ret;
  }

  Object.keys(stats.frame_size).forEach((v) => {
    if (
      (type === "tx" && Object.keys(port_mapping).includes(v)) ||
      (type === "rx" &&
        Object.values(port_mapping).map(Number).includes(parseInt(v)))
    ) {
      // @ts-ignore
      stats.frame_size[v][type].forEach((f) => {
        if (f.low === low && f.high === high) {
          ret += f.packets;
        }
      });
    }
  });

  return ret;
};
export const formatFrameCount = (packets: number, decimals: number = 2) => {
  if (packets === 0) return "0";

  const k = 1000;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["", "K", "M", "B", "T"];

  const i = Math.floor(Math.log(packets) / Math.log(k));

  return (
    parseFloat((packets / Math.pow(k, i)).toFixed(dm)).toFixed(dm) +
    " " +
    sizes[i]
  );
};
export const formatNanoSeconds = (
  ns: number | string,
  decimals: number = 2
) => {
  if (typeof ns === "string") {
    return ns;
  }

  if (ns === 0 || ns < 0) return "0 ns";

  const k = 1000;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["ns", "us", "ms", "s", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(ns) / Math.log(k));

  let si = sizes[i];

  if (i < 0) {
    si = "ps";
  }

  return parseFloat((ns / Math.pow(k, i)).toFixed(dm)) + " " + si;
};
export const getStreamIDsByPort = (
  pid: number,
  stream_settings: StreamSettings[],
  streams: Stream[]
): number[] => {
  let ret: number[] = [];

  stream_settings.forEach((v) => {
    if (v.port === pid && v.active) {
      streams.forEach((s) => {
        if (s.stream_id === v.stream_id) {
          ret.push(s.app_id);
          return;
        }
      });
    }
  });

  return ret;
};
export const calculateWeightedRTTs = (
  stats: Statistics,
  port_mapping: { [name: number]: number }
) => {
  let all_mean = 0;
  let all_std = 0;
  let all_current = 0;
  let all_min = Infinity;
  let all_max = 0;
  let all_n = 0;

  Object.keys(stats.rtts).forEach((v) => {
    // only count ports that are used for traffic gen
    // @ts-ignore
    if (Object.values(port_mapping).map(Number).includes(parseInt(v))) {
      all_mean += stats.rtts[v].mean * stats.rtts[v].n;
      all_std += stats.rtts[v].jitter * stats.rtts[v].n;
      all_min = Math.min(all_min, stats.rtts[v].min);
      all_max = Math.max(all_max, stats.rtts[v].max);
      all_current += stats.rtts[v].current * stats.rtts[v].n;
      all_n += stats.rtts[v].n;
    }
  });

  if (all_n === 0) {
    return { mean: 0, jitter: 0, min: 0, max: 0, current: 0, n: 0 };
  }

  return {
    mean: all_mean / all_n,
    jitter: all_std / all_n,
    min: all_min,
    max: all_max,
    current: all_current / all_n,
    n: all_n,
  };
};
export const calculateWeightedIATs = (
  type: string,
  stats: Statistics,
  port_mapping: { [name: number]: number }
) => {
  let all_mean = 0;
  let all_std = 0;
  let all_n = 0;
  let all_mae: number[] = [];

  Object.keys(stats.iats).forEach((v) => {
    if (
      (type === "tx" || type === "rx") &&
      Object.keys(stats.iats[v]).includes(type)
    ) {
      if (
        (type === "tx" && Object.keys(port_mapping).includes(v)) ||
        // @ts-ignore
        (type === "rx" &&
          Object.values(port_mapping).map(Number).includes(parseInt(v)))
      ) {
        all_mean += stats.iats[v][type].mean * stats.iats[v][type].n;
        all_mae.push(stats.iats[v][type].mae);
        all_std += stats.iats[v][type].std * stats.iats[v][type].n;
        all_n += stats.iats[v][type].n;
      }
    }
  });

  if (all_n === 0) {
    return { mean: 0, std: 0, n: 0, mae: 0 };
  }

  //console.log({mean: all_mean / all_n, std: all_std / all_n, n: all_n})

  let sum_mae = all_mae.reduce((a, b) => a + b, 0);
  let n_mae = Math.max(1, all_mae.filter((a) => a > 0).length);

  return {
    mean: all_mean / all_n,
    std: all_std / all_n,
    n: all_n,
    mae: sum_mae / n_mae,
  };
};
export const addRates = (
  object: { [name: string]: number },
  keys: string[] | number[]
) => {
  let ret = 0;

  if (object === undefined) {
    return 0;
  }

  keys.forEach((v) => {
    if (Object.keys(object).includes(v.toString())) {
      ret += object[v];
    }
  });

  return ret;
};
export const activePorts = (port_mapping: {
  [name: number]: number;
}): { tx: number; rx: number }[] => {
  let active_ports: { tx: number; rx: number }[] = [];
  let exists: number[] = [];

  Object.keys(port_mapping).forEach((tx_port: string) => {
    let port = parseInt(tx_port);
    exists.push(port);
    active_ports.push({ tx: port, rx: port_mapping[port] });
  });

  return active_ports;
};
export const secondsToTime = (s: number) => {
  let hours = Math.floor(s / 3600);
  let minutes = Math.floor((s % 3600) / 60);
  let seconds = Math.floor((s % 3600) % 60);

  return hours + "h " + minutes + "m " + seconds + "s";
};
export const get_rtt = (
  data: TimeStatistics,
  port_mapping: { [name: number]: number }
): [string[], number[]] => {
  let cum_data: { [name: number]: number }[] = [];

  if ("rtt" in data) {
    Object.values(port_mapping).map((v) => {
      // @ts-ignore
      if (v in data["rtt"]) {
        // @ts-ignore
        cum_data.push(data["rtt"][v]);
      }
    });
  }

  let ret_data = cum_data.reduce(
    (acc, current) => {
      const key = Object.keys(current);

      key.forEach((k) => {
        if (Object.keys(acc[0]).includes(k)) {
          // @ts-ignore
          acc[0][k] += current[k];
          // @ts-ignore
          acc[1][k] += 1;
        } else {
          // @ts-ignore
          acc[0][k] = current[k];
          // @ts-ignore
          acc[1][k] = 1;
        }
      });

      return acc;
    },
    [{}, {}]
  );

  Object.keys(ret_data[0]).forEach((v) => {
    // @ts-ignore
    ret_data[0][v] = ret_data[0][v] / ret_data[1][v];
  });

  return [
    Object.keys(ret_data[0]).map((v) => secondsToTime(parseInt(v))),
    Object.values(ret_data[0]),
  ];
};
export const formatTime = (): string => {
  const LeadingZero = (num: number) => {
    return num < 10 ? "0" + num : num;
  };

  const date = new Date();

  const showDate =
    LeadingZero(date.getDate()) +
    "." +
    LeadingZero(date.getMonth() + 1) +
    "." +
    LeadingZero(date.getFullYear());

  const showTime =
    LeadingZero(date.getHours()) +
    ":" +
    LeadingZero(date.getMinutes()) +
    ":" +
    LeadingZero(date.getSeconds());
  return showDate + " " + showTime;
};

export const getStreamFrameSize = (
  streams: Stream[],
  stream_id: number
): number => {
  let ret = 0;

  streams.forEach((v) => {
    if (v.app_id === stream_id) {
      ret = v.frame_size;
      if (v.encapsulation === Encapsulation.Q) {
        ret += 4;
      } else if (v.encapsulation === Encapsulation.QinQ) {
        ret += 8;
      } else if (v.encapsulation === Encapsulation.MPLS) {
        ret += v.number_of_lse * 4; // 4 bytes per LSE
      }

      if (v.vxlan) {
        ret += 50; // 50 bytes overhead
      }

      return;
    }
  });

  return ret;
};

export const calculateStatistics = (
  current_statistics: Statistics,
  port_tx_rx_mapping: { [name: number]: number },
  current_test?: TrafficGenData
) => {
  let total_tx = 0;
  let total_rx = 0;

  Object.keys(current_statistics.frame_size).forEach((v) => {
    if (Object.keys(port_tx_rx_mapping).includes(v)) {
      current_statistics.frame_size[v]["tx"].forEach((f: any) => {
        total_tx += f.packets;
      });
    }

    if (Object.values(port_tx_rx_mapping).map(Number).includes(parseInt(v))) {
      current_statistics.frame_size[v]["rx"].forEach((f: any) => {
        total_rx += f.packets;
      });
    }
  });

  const rtt = calculateWeightedRTTs(current_statistics, port_tx_rx_mapping);
  const iat_tx = calculateWeightedIATs(
    "tx",
    current_statistics,
    port_tx_rx_mapping
  );
  const iat_rx = calculateWeightedIATs(
    "rx",
    current_statistics,
    port_tx_rx_mapping
  );
  const lost_packets = get_lost_packets(current_statistics, port_tx_rx_mapping);
  const out_of_order_packets = get_out_of_order_packets(
    current_statistics,
    port_tx_rx_mapping
  );
  const elapsed_time =
    current_test?.duration || current_statistics.elapsed_time;

  return {
    total_tx,
    total_rx,
    rtt,
    iat_tx,
    iat_rx,
    lost_packets,
    out_of_order_packets,
    elapsed_time,
  };
};
