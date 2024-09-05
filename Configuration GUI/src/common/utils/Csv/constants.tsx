import { formatFrameCount } from "../StatisticUtils";

export const frameSizesMap = [
  ["0 - 63", 0, 63],
  ["64", 64, 64],
  ["65 - 127", 65, 127],
  ["128 - 255", 128, 255],
  ["256 - 511", 256, 511],
  ["512 - 1023", 512, 1023],
  ["1024 - 1518", 1024, 1518],
  ["1518 - 21519", 1518, 21519],
  ["Total"],
];

export const frameTypes = [
  "Multicast",
  "Broadcast",
  "Unicast",
  "VxLan",
  "Non-Unicast",
  "Total",
];

export const ethernetTypes = [
  "VLAN",
  "QinQ",
  "IPv4",
  "IPv6",
  "MPLS",
  "ARP",
  "Unknown",
];

export const iatMetrics = [
  { name: "iat mean", tx: "mean", rx: "mean" },
  { name: "iat std", tx: "std", rx: "std" },
  { name: "iat mae", tx: "mae", rx: "mae" },
];

export const rttMetrics = [
  { name: "mean rtt", value: "mean" },
  { name: "max rtt", value: "max" },
  { name: "min rtt", value: "min" },
  { name: "number of rtt", value: "n", format: formatFrameCount },
  { name: "jitter", value: "jitter" },
];

export const RFCframeSizes = ["64", "128", "512", "1024", "1518"];
