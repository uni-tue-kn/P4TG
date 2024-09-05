import { Statistics, TimeStatistics, TrafficGenList } from "../../Interfaces";
import {
  formatFrameCount,
  activePorts,
  calculateStatistics,
} from "../StatisticUtils";
import { calculateLineData } from "../VisualUtils";
import { RFCframeSizes } from "./constants";
import { generateDataCategories } from "./helpers";
import {
  formatFrameStatistics,
  formatFrameTypeStatistics,
  formatEthernetStatistics,
  formatIatStatistics,
  formatRttStatistics,
  formatDataCategories,
  formatRFCTable,
} from "./formatingTables";

export const get_csv_summary_data = (
  stats: Statistics,
  data: TimeStatistics,
  port_mapping: { [name: number]: number },
  traffic_gen_list: TrafficGenList,
  testNumber: number
) => {
  const {
    iat_tx,
    iat_rx,
    rtt,
    total_tx,
    total_rx,
    lost_packets,
    out_of_order_packets,
  } = calculateStatistics(stats, port_mapping);

  const {
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
  } = calculateLineData(data, port_mapping);

  const lineDataCategories = generateDataCategories(
    labels_tx,
    line_data_tx,
    labels_rx,
    line_data_rx,
    labels_rtt,
    line_data_rtt,
    labels_loss,
    line_data_loss,
    labels_out_of_order,
    line_data_out_of_order
  );

  const csvSummary = [
    [""],
    [
      traffic_gen_list[testNumber].name
        ? traffic_gen_list[testNumber].name
        : "Test " + testNumber,
    ],
    [
      traffic_gen_list[testNumber].duration
        ? "Test duration: " + traffic_gen_list[testNumber].duration + " seconds"
        : "",
    ],
    ["Summary"],
    [""],
    ["IAT", "TX", "RX"],
    ...formatIatStatistics(iat_tx, iat_rx),
    [""],
    ["RTT"],
    ...formatRttStatistics(rtt),
    ["lost packets", formatFrameCount(lost_packets)],
    ["out of order packets", formatFrameCount(out_of_order_packets)],
    [""],
    ["Frame type", "TX Count", "RX Count"],
    ...formatFrameTypeStatistics(stats, port_mapping, total_tx, total_rx),
    [""],
    ["Ethernet type", "TX Count", "RX Count"],
    ...formatEthernetStatistics(stats, port_mapping),
    [""],
    ["Frame size", "TX Count", "RX Count"],
    ...formatFrameStatistics(stats, port_mapping, total_tx, total_rx),
    [""],
    ...formatDataCategories(lineDataCategories),
  ];
  return csvSummary;
};

export const get_csv_ports_data = (
  stats: Statistics,
  data: TimeStatistics,
  port_mapping: { [name: number]: number }
) => {
  const csvPorts: any = [];

  activePorts(port_mapping).map((v) => {
    let mapping = { [v.tx]: v.rx };

    const {
      iat_tx,
      iat_rx,
      rtt,
      total_tx,
      total_rx,
      lost_packets,
      out_of_order_packets,
    } = calculateStatistics(stats, mapping);

    const {
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
    } = calculateLineData(data, mapping);

    const lineDataCategories = generateDataCategories(
      labels_tx,
      line_data_tx,
      labels_rx,
      line_data_rx,
      labels_rtt,
      line_data_rtt,
      labels_loss,
      line_data_loss,
      labels_out_of_order,
      line_data_out_of_order
    );

    csvPorts.push(
      [""],
      [""],
      ["port pair: " + v.tx + " --> " + v.rx],
      [""],
      ["IAT", "TX", "RX"],
      ...formatIatStatistics(iat_tx, iat_rx),
      [""],
      ["RTT"],
      ...formatRttStatistics(rtt),
      ["lost packets", formatFrameCount(lost_packets)],
      ["out of order packets", formatFrameCount(out_of_order_packets)],
      [""],
      ["Frame type", "TX Count", "RX Count"],
      ...formatFrameTypeStatistics(stats, mapping, total_tx, total_rx),
      [""],
      ["Ethernet type", "TX Count", "RX Count"],
      ...formatEthernetStatistics(stats, mapping),
      [""],
      ["Frame size", "TX Count", "RX Count"],
      ...formatFrameStatistics(stats, mapping, total_tx, total_rx),
      [""],
      ...formatDataCategories(lineDataCategories)
    );
  });
  return csvPorts;
};

export const get_csv_rfc_data = (profileData: any) => {
  const csvRFC = [
    ["RFC 2544 Test Results"],
    ["Frame Size", "Throughput", "Latency", "Frame Loss Rate", "Reset"],
    ...RFCframeSizes.map((size) => [
      `${size} Bytes`,
      formatRFCTable(profileData.throughput, size, " Frames/s"),
      formatRFCTable(profileData.latency, size, " mus"),
      formatRFCTable(profileData.frame_loss_rate, size, " %"),
      formatRFCTable(profileData.reset, size, " s"),
    ]),
  ];

  return csvRFC;
};
