import { secondsToTime } from "../../components/SendReceiveMonitor";
import { TimeStatistics, Statistics } from "../Interfaces";
import { get_frame_stats, get_frame_types, get_rtt } from "./StatisticUtils";

export const generateLineData = (
  data_key: string,
  use_key: boolean,
  data: TimeStatistics,
  port_mapping: { [name: number]: number }
): [string[], number[]] => {
  let cum_data: { [name: number]: number }[] = [];

  if (data_key in data) {
    if (use_key) {
      Object.keys(port_mapping).map((v) => {
        // @ts-ignore
        if (v in data[data_key]) {
          // @ts-ignore
          cum_data.push(data[data_key][v]);
        }
      });
    } else {
      Object.values(port_mapping).map((v) => {
        // @ts-ignore
        if (v in data[data_key]) {
          // @ts-ignore
          cum_data.push(data[data_key][v]);
        }
      });
    }
  }

  let ret_data = cum_data.reduce((acc, current) => {
    const key = Object.keys(current);

    key.forEach((k) => {
      if (Object.keys(acc).includes(k)) {
        // @ts-ignore
        acc[k] += current[k];
      } else {
        // @ts-ignore
        acc[k] = current[k];
      }
    });

    return acc;
  }, {});

  return [
    Object.keys(ret_data).map((v) => secondsToTime(parseInt(v))),
    Object.values(ret_data),
  ];
};
export const frame_size_label = [
  "0-63",
  "64",
  "65-127",
  "128-255",
  "256-511",
  "512-1023",
  "1024-1518",
  "1519-21519",
];
export const get_frame_size_data = (
  stats: Statistics,
  port_mapping: { [name: number]: number }
) => {
  const frame_size_data = {
    labels: frame_size_label,
    datasets: [
      {
        label: "TX frame sizes",
        data: [
          [0, 63],
          [64, 64],
          [65, 127],
          [128, 255],
          [256, 511],
          [512, 1023],
          [1024, 1518],
          [1519, 21519],
        ].map((v, i) => {
          return get_frame_stats(stats, port_mapping, "tx", v[0], v[1]);
        }),
        backgroundColor: [
          "rgb(255, 99, 132)",
          "rgb(54, 162, 235)",
          "rgb(255, 205, 86)",
          "rgb(18,194,0)",
          "rgb(178,0,255)",
          "rgb(255,104,42)",
          "rgb(0,0,0)",
          "rgb(164,0,0)",
        ],
        hoverOffset: 4,
      },
      {
        label: "RX frame sizes",
        data: [
          [0, 63],
          [64, 64],
          [65, 127],
          [128, 255],
          [256, 511],
          [512, 1023],
          [1024, 1518],
          [1519, 21519],
        ].map((v, i) => {
          return get_frame_stats(stats, port_mapping, "rx", v[0], v[1]);
        }),
        backgroundColor: [
          "rgb(255, 99, 132)",
          "rgb(54, 162, 235)",
          "rgb(255, 205, 86)",
          "rgb(18,194,0)",
          "rgb(178,0,255)",
          "rgb(255,104,42)",
          "rgb(0,0,0)",
          "rgb(164,0,0)",
        ],
        hoverOffset: 4,
      },
    ],
  };
  return frame_size_data;
};
export const get_rtt_options = (theme: string) => {
  const color = theme === "dark" ? "rgb(200, 200, 200)" : undefined;
  return {
    responsive: true,
    aspectRatio: 6,
    scales: {
      y: {
        title: {
          display: true,
          text: "μs",
          color: color,
        },
        ticks: {
          color: color,
        },
        grid: {
          color: color,
        },
        suggestedMin: 0,
        beginAtZero: true,
      },
      x: {
        title: {
          display: true,
          text: "Time",
          color: color,
        },
        ticks: {
          source: "auto",
          autoSkip: true,
          color: color,
        },
        grid: {
          color: color,
        },
      },
    },
    plugins: {
      legend: {
        position: "top" as const,
        labels: {
          color: color,
        },
      },
      title: {
        display: false,
        text: "",
      },
    },
  };
};
export const get_rtt_data = (
  data: TimeStatistics,
  port_mapping: { [name: number]: number },
  theme = "light"
) => {
  const [labels_rtt, line_data_rtt] = get_rtt(data, port_mapping);
  const backgroundColorRTT =
    theme === "dark" ? "rgba(53, 162, 235, 0.25)" : "rgba(53, 162, 235, 0.5)";

  const rtt_data = {
    labels: labels_rtt,
    datasets: [
      {
        fill: true,
        label: "RTT",
        data: line_data_rtt.map((val) => val * 10 ** -3),
        borderColor: "rgb(53, 162, 235)",
        backgroundColor: backgroundColorRTT,
      },
    ],
  };
  return rtt_data;
};
export const get_loss_options = (theme: string) => {
  const color = theme === "dark" ? "rgb(200, 200, 200)" : undefined;

  return {
    responsive: true,
    aspectRatio: 6,
    scales: {
      y: {
        title: {
          display: true,
          text: "#Packets",
          color: color,
        },
        ticks: {
          color: color,
        },
        suggestedMin: 0,
        beginAtZero: true,
        grid: {
          color: color,
        },
      },
      x: {
        title: {
          display: true,
          text: "Time",
          color: color,
        },
        ticks: {
          source: "auto",
          autoSkip: true,
          color: color,
        },
        grid: {
          color: color,
        },
      },
    },
    plugins: {
      legend: {
        position: "top" as const,
        labels: {
          color: color,
        },
      },
      title: {
        display: false,
        text: "",
      },
    },
  };
};
export const get_loss_data = (
  data: TimeStatistics,
  port_mapping: { [name: number]: number },
  theme = "light"
) => {
  const [labels_loss, line_data_loss] = generateLineData(
    "packet_loss",
    false,
    data,
    port_mapping
  );
  const [, line_data_out_of_order] = generateLineData(
    "out_of_order",
    false,
    data,
    port_mapping
  );

  const backgroundColorDataLoss =
    theme === "dark" ? "rgba(53, 162, 235, 0.25)" : "rgba(53, 162, 235, 0.5)";
  const backgroundColorOutOfOrder =
    theme === "dark" ? "rgba(250,122,64, 0.25)" : "rgba(250,122,64, 0.5)";

  const loss_data = {
    labels: labels_loss,
    datasets: [
      {
        fill: true,
        label: "Packet loss",
        data: line_data_loss,
        borderColor: "rgb(53, 162, 235)",
        backgroundColor: backgroundColorDataLoss,
      },
      {
        fill: true,
        label: "Out of order",
        data: line_data_out_of_order,
        borderColor: "rgb(183,85,40)",
        backgroundColor: backgroundColorOutOfOrder,
      },
    ],
  };
  return loss_data;
};
export const get_rate_options = (theme: string) => {
  const color = theme === "dark" ? "rgb(200, 200, 200)" : undefined;

  return {
    responsive: true,
    aspectRatio: 6,
    scales: {
      y: {
        title: {
          display: true,
          text: "Gbit/s",
          color: color,
        },
        ticks: {
          color: color,
        },
        suggestedMin: 0,
        beginAtZero: true,
        grid: {
          color: color,
        },
      },
      x: {
        title: {
          display: true,
          text: "Time",
          color: color,
        },
        ticks: {
          source: "auto",
          autoSkip: true,
          color: color,
        },
        grid: {
          color: color,
        },
      },
    },
    plugins: {
      legend: {
        position: "top" as const,
        labels: {
          color: color,
        },
      },
      title: {
        display: false,
        text: "",
      },
    },
  };
};
export const get_rate_data = (
  data: TimeStatistics,
  port_mapping: { [name: number]: number },
  theme = "light"
) => {
  const [labels_tx, line_data_tx] = generateLineData(
    "tx_rate_l1",
    true,
    data,
    port_mapping
  );
  const [, line_data_rx] = generateLineData(
    "rx_rate_l1",
    false,
    data,
    port_mapping
  );

  const backgroundColorTX =
    theme === "dark" ? "rgba(53, 162, 235, 0.25)" : "rgba(53, 162, 235, 0.5)";
  const backgroundColorRX =
    theme === "dark" ? "rgba(250,122,64, 0.25)" : "rgba(250,122,64, 0.5)";

  const rate_data = {
    labels: labels_tx,
    datasets: [
      {
        fill: true,
        label: "TX rate",
        data: line_data_tx.map((val) => val * 10 ** -9),
        borderColor: "rgb(53, 162, 235)",
        backgroundColor: backgroundColorTX,
      },
      {
        fill: true,
        label: "RX rate",
        data: line_data_rx.map((val) => val * 10 ** -9),
        borderColor: "rgb(183,85,40)",
        backgroundColor: backgroundColorRX,
      },
    ],
  };

  return rate_data;
};
export const get_frame_options = (theme: string) => {
  const color = theme === "dark" ? "rgb(200, 200, 200)" : undefined;

  return {
    responsive: true,
    animation: false,
    aspectRatio: 2,
    plugins: {
      legend: {
        position: "top" as const,
        labels: {
          color: color,
        },
      },
      title: {
        display: false,
        text: "Frame type",
        color: color,
      },
    },
  };
};
let frame_type_label = ["Multicast", "Broadcast", "Unicast", "VxLAN"];
export const get_frame_type_data = (
  stats: Statistics,
  port_mapping: { [name: number]: number }
) => {
  const frame_type_data = {
    labels: frame_type_label,
    datasets: [
      {
        label: "TX frame types",
        data: [
          get_frame_types(stats, port_mapping, "multicast").tx,
          get_frame_types(stats, port_mapping, "broadcast").tx,
          get_frame_types(stats, port_mapping, "unicast").tx,
          get_frame_types(stats, port_mapping, "vxlan").tx,
        ],
        backgroundColor: [
          "rgb(255, 99, 132)",
          "rgb(54, 162, 235)",
          "rgb(255, 205, 86)",
          "rgb(125,62,37)",
        ],
        hoverOffset: 4,
      },
      {
        label: "RX frame types",
        data: [
          get_frame_types(stats, port_mapping, "multicast").rx,
          get_frame_types(stats, port_mapping, "broadcast").rx,
          get_frame_types(stats, port_mapping, "unicast").rx,
          get_frame_types(stats, port_mapping, "vxlan").rx,
        ],
        backgroundColor: [
          "rgb(255, 99, 132)",
          "rgb(54, 162, 235)",
          "rgb(255, 205, 86)",
          "rgb(125,62,37)",
        ],
        hoverOffset: 4,
      },
    ],
  };
  return frame_type_data;
};
let ethernet_type_label = [
  "VLAN",
  "QinQ",
  "IPv4",
  "IPv6",
  "MPLS",
  "ARP",
  "Unknown",
];
export const get_ethernet_type_data = (
  stats: Statistics,
  port_mapping: { [name: number]: number }
) => {
  const ethernet_type_data = {
    labels: ethernet_type_label,
    datasets: [
      {
        label: "TX ethernet types",
        data: [
          get_frame_types(stats, port_mapping, "vlan").tx,
          get_frame_types(stats, port_mapping, "qinq").tx,
          get_frame_types(stats, port_mapping, "ipv4").tx,
          get_frame_types(stats, port_mapping, "ipv6").tx,
          get_frame_types(stats, port_mapping, "mpls").tx,
          get_frame_types(stats, port_mapping, "arp").tx,
          get_frame_types(stats, port_mapping, "unknown").tx,
        ],
        backgroundColor: [
          "rgb(255, 99, 132)",
          "rgb(54, 162, 235)",
          "rgb(255, 205, 86)",
          "rgb(18,194,0)",
          "rgb(178,0,255)",
          "rgb(131,63,14)",
          "rgb(255,104,42)",
        ],
        hoverOffset: 4,
      },
      {
        label: "RX ethernet types",
        data: [
          get_frame_types(stats, port_mapping, "vlan").rx,
          get_frame_types(stats, port_mapping, "qinq").rx,
          get_frame_types(stats, port_mapping, "ipv4").rx,
          get_frame_types(stats, port_mapping, "ipv6").rx,
          get_frame_types(stats, port_mapping, "mpls").rx,
          get_frame_types(stats, port_mapping, "arp").tx,
          get_frame_types(stats, port_mapping, "unknown").rx,
        ],
        backgroundColor: [
          "rgb(255, 99, 132)",
          "rgb(54, 162, 235)",
          "rgb(255, 205, 86)",
          "rgb(18,194,0)",
          "rgb(178,0,255)",
          "rgb(131,63,14)",
          "rgb(255,104,42)",
        ],
        hoverOffset: 4,
      },
    ],
  };
  return ethernet_type_data;
};
export const calculateLineData = (
  data: TimeStatistics,
  port_tx_rx_mapping: { [name: number]: number }
) => {
  const [labels_tx, line_data_tx] = generateLineData(
    "tx_rate_l1",
    true,
    data,
    port_tx_rx_mapping
  );
  const [labels_rx, line_data_rx] = generateLineData(
    "rx_rate_l1",
    false,
    data,
    port_tx_rx_mapping
  );

  const [labels_loss, line_data_loss] = generateLineData(
    "packet_loss",
    false,
    data,
    port_tx_rx_mapping
  );
  const [labels_out_of_order, line_data_out_of_order] = generateLineData(
    "out_of_order",
    false,
    data,
    port_tx_rx_mapping
  );
  const [labels_rtt, line_data_rtt] = get_rtt(data, port_tx_rx_mapping);

  return {
    labels_tx,
    line_data_tx,
    labels_rx,
    line_data_rx,
    labels_loss,
    line_data_loss,
    labels_out_of_order,
    line_data_out_of_order,
    labels_rtt,
    line_data_rtt,
  };
};
