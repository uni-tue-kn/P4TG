import { UserOptions } from "jspdf-autotable";
import { Port, Stream, StreamSettings, Statistics } from "../../Interfaces";
import { jsPDF } from "jspdf";
import { encapsulation, frameSizes } from "./constants";
import {
  get_frame_types,
  formatFrameCount,
  get_frame_stats,
  formatNanoSeconds,
  activePorts,
  getStreamIDsByPort,
} from "../StatisticUtils";
import autoTable from "jspdf-autotable";
import translate from "../../../components/translation/Translate";
import { generateStreamStatusArray, getPortAndChannelFromPid } from "./helper";

export const createAutoTableConfig = (
  doc: jsPDF,
  columns: string[],
  rows: (string | number | boolean)[][],
  columnStyles: { [key: number]: { cellWidth: number } },
  indicesToDraw: number[],
  options?: any,
  applyRttRowColSkip: boolean = false
): UserOptions => {
  const modifiedOptions: UserOptions = {
    ...options,
    head: [columns],
    body: rows,
    theme: "plain",
    columnStyles: columnStyles,
    didDrawCell: (data: any) => {
      const shouldDraw =
        !applyRttRowColSkip ||
        (applyRttRowColSkip &&
          ((data.column.index !== 3 && data.column.index !== 4) ||
            data.row.index <= 3));

      if (shouldDraw && shouldDrawLine(data.column.index, indicesToDraw)) {
        doc.setDrawColor(0);
        doc.setLineWidth(0.1);
        doc.line(
          data.cell.x,
          data.cell.y + data.cell.height,
          data.cell.x + data.cell.width,
          data.cell.y + data.cell.height
        );
      }
    },
  };

  return modifiedOptions;
};

export const shouldDrawLine = (
  columnIndex: number,
  indicesToDraw: number[]
): boolean => {
  return indicesToDraw.includes(columnIndex);
};

export const formatActivePortsRows = (
  port_mapping: { [name: number]: number },
  ports: Port[]
): (string | number)[][] => {
  const rows = [];

  for (const [txPid, rxPid] of Object.entries(port_mapping)) {
    const txData = getPortAndChannelFromPid(txPid, ports);
    const rxData = getPortAndChannelFromPid(rxPid, ports);

    rows.push([
      txData.port,
      txData.channel,
      txPid,
      rxData.port,
      rxData.channel,
      rxPid,
    ]);
  }
  return rows;
};

export const formatActiveStreamRows = (
  streams: Stream[]
): (string | number | boolean)[][] => {
  const row = streams.map((stream) => [
    stream.app_id,
    stream.frame_size + " bytes",
    stream.traffic_rate + " Gbps",
    stream.burst === 1 ? "IAT Precision" : "Rate Precision",
    stream.vxlan,
    encapsulation[stream.encapsulation],
    stream.number_of_lse,
  ]);
  return row;
};

export const formatPortStreamCols = (streams: Stream[]): string[] => {
  const cols = ["TX Port", "RX Port"].concat(
    streams.map((stream) => `Stream ${stream.app_id}`)
  );
  return cols;
};

export const formatPortStreamRows = (
  port_mapping: { [name: number]: number },
  ports: Port[],
  stream_settings: StreamSettings[],
  streams: Stream[],
  portStreamCols: string[]
) => {
  return activePorts(port_mapping).map((stream) => {
    const portInfo = [
      `${getPortAndChannelFromPid(stream.tx, ports).port} (${stream.tx})`,
      `${getPortAndChannelFromPid(stream.rx, ports).port} (${stream.rx})`,
    ];

    const streamIDs = getStreamIDsByPort(stream.tx, stream_settings, streams);
    const streamStatus = generateStreamStatusArray(
      streamIDs,
      portStreamCols.length - 2
    );

    return portInfo.concat(streamStatus);
  });
};

export const frameSizeCountRow = (
  stats: Statistics,
  mapping: { [name: number]: number },
  label: string,
  low: number,
  high: number,
  total_tx: number,
  total_rx: number
) => {
  const emptyFields = new Array(1).fill("");
  const absolute_tx = get_frame_stats(stats, mapping, "tx", low, high);
  const relative_tx =
    absolute_tx > 0
      ? ((absolute_tx * 100) / total_tx).toFixed(2) + "%"
      : 0 + "%";
  const absolute_rx = get_frame_stats(stats, mapping, "rx", low, high);
  const relative_rx =
    absolute_rx > 0
      ? ((absolute_rx * 100) / total_rx).toFixed(2) + "%"
      : 0 + "%";
  return [
    label,
    formatFrameCount(absolute_tx),
    relative_tx,
    ...emptyFields,
    label,
    formatFrameCount(absolute_rx),
    relative_rx,
  ];
};

export const frameEthernetRow = (
  stats: Statistics,
  mapping: { [name: number]: number },
  label1: string,
  label2: string,
  total_tx: number,
  total_rx: number
) => {
  const emptyCell = [""];
  let frameData1;

  if (label1 === "Total") {
    frameData1 = [formatFrameCount(total_tx), formatFrameCount(total_rx)];
  } else {
    frameData1 = label1
      ? [
        formatFrameCount(
          get_frame_types(stats, mapping, label1.toLowerCase())["tx"]
        ),
        formatFrameCount(
          get_frame_types(stats, mapping, label1.toLowerCase())["rx"]
        ),
      ]
      : ["", ""];
  }

  const frameData2 = label2
    ? [
      formatFrameCount(
        get_frame_types(stats, mapping, label2.toLowerCase())["tx"]
      ),
      formatFrameCount(
        get_frame_types(stats, mapping, label2.toLowerCase())["rx"]
      ),
    ]
    : ["0", "0"];

  return [
    label1 ?? "",
    ...frameData1,
    ...emptyCell,
    label2 ?? "",
    ...frameData2,
  ];
};

export const formatFrameStatsRTTRows = (data: any) => {
  const {
    lost_packets,
    total_rx,
    out_of_order_packets,
    iat_tx,
    iat_rx,
    rtt,
    currentLanguage,
  } = data;

  const translatedText = (key: string) => translate(key, currentLanguage);

  const frameLossRatio =
    lost_packets > 0
      ? ((lost_packets * 100) / (lost_packets + total_rx)).toFixed(2) + " %"
      : "0.00 %";

  const rows = [
    [
      translatedText("statistics.lostFrames"),
      formatFrameCount(lost_packets),
      "",
      translatedText("statistics.average") + " TX IAT",
      formatNanoSeconds(iat_tx.mean),
    ],
    [
      translatedText("statistics.lossRate"),
      frameLossRatio,
      "",
      "MAE (TX IAT)",
      formatNanoSeconds(iat_tx.mae),
    ],
    [
      "Out of Order",
      formatFrameCount(out_of_order_packets),
      "",
      translatedText("statistics.average") + " RX IAT",
      formatNanoSeconds(iat_rx.mean),
    ],
    [
      translatedText("statistics.current") + " RTT",
      formatNanoSeconds(rtt.current),
      "",
      "MAE (RX IAT)",
      formatNanoSeconds(iat_rx.mae),
    ],
    ["RTT", formatNanoSeconds(rtt.mean), "", "", ""],
    [
      translatedText("statistics.minimum") + " RTT",
      formatNanoSeconds(rtt.min),
      "",
      "",
      "",
    ],
    [
      translatedText("statistics.maximum") + " RTT",
      formatNanoSeconds(rtt.max),
      "",
      "",
      "",
    ],
    ["Jitter", formatNanoSeconds(rtt.jitter), "", "", ""],
    ["#RTT", rtt.n, "", "", ""],
  ];

  return rows;
};

export const createRfcTable = (
  doc: jsPDF,
  test: any,
  graphType: "throughput" | "latency" | "frame_loss_rate" | "reset",
  yOffset: number,
  currentLanguage: string
) => {
  const translatedText = (key: string) => translate(key, currentLanguage);

  const headers =
    graphType === "reset"
      ? [translate("statistics.frameSize", currentLanguage), "64 Bytes"]
      : [
        translate("statistics.frameSize", currentLanguage),
        ...frameSizes.map((size) => `${size} Bytes`),
      ];

  const calculateAverage = (data: { [key: string]: number }): number => {
    const values = Object.values(data);
    const sum = values.reduce((acc, curr) => acc + curr, 0);
    return sum / values.length;
  };

  const createRow = (testType: string, data: any, unit: string) => {
    if (graphType === "reset") {
      return [
        testType + ` [${unit}]`,
        data && data["64"] !== undefined
          ? `${Number(data["64"]).toFixed(3)}`
          : translatedText("other.notRunning"),
      ];
    }
    if (graphType === "frame_loss_rate") {
      return [
        testType + ` [${unit}]`,
        ...frameSizes.map((size) => {
          if (data && data[size] !== undefined) {
            const averageLoss = calculateAverage(data[size]);
            return `${averageLoss.toFixed(3)}`;
          }
          return translatedText("other.notRunning");
        }),
      ];
    }

    if (graphType === "throughput") {
      return [
        testType + ` [${unit}]`,
        ...frameSizes.map((size) => {
          return data && data[size] !== undefined
            ? `${Math.round(Number(data[size]))}`
            : translatedText("other.notRunning");
        }),
      ];
    }
    return [
      testType + ` [${unit}]`,
      ...frameSizes.map((size) => {
        return data && data[size] !== undefined
          ? `${Number(data[size]).toFixed(3)}`
          : translatedText("other.notRunning");
      }),
    ];
  };

  const testMappings = {
    throughput: {
      label: translatedText("input.rfcMode.options.throughput"),
      data: test.throughput,
      unit: "Frames/s",
    },
    latency: {
      label: translatedText("input.rfcMode.options.latency"),
      data: test.latency,
      unit: "mus",
    },
    frame_loss_rate: {
      label: translatedText("statistics.meanFrameLoss"),
      data: test.frame_loss_rate,
      unit: "%",
    },
    reset: {
      label: translatedText("input.rfcMode.options.reset"),
      data: test.reset,
      unit: "Seconds",
    },
  };

  const selectedTest = testMappings[graphType];

  const data = [
    createRow(selectedTest.label, selectedTest.data, selectedTest.unit),
  ];

  autoTable(doc, {
    head: [headers],
    body: data,
    theme: "plain",
    startY: yOffset,
    styles: { fontSize: 10, halign: "center" },
  });
};
