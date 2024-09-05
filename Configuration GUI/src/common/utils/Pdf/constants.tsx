export const FOOTER_TEXT = "P4TG@Github";
export const FOOTER_URL = "https://github.com/uni-tue-kn/P4TG";
export const FONT = "helvetica";
export const FONT_SIZE_SMALL = 8;
export const FONT_SIZE_NORMAL = 12;
export const FONT_SIZE_HEADER = 17;

export const encapsulation: { [key: number]: string } = {
  0: "None",
  1: "VLAN (+4 byte)",
  2: "Q-in-Q (+8 byte)",
  3: "MPLS (+4 byte / LSE)",
};

export const frameSizes = ["64", "128", "512", "1024", "1518"];

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

export const frameStatsRTTCols = ["Type", "", "", "Type", ""];

export const frameTypes = [
  {
    label1: "Multicast",
    label2: "VLAN",
  },
  {
    label1: "Broadcast",
    label2: "QinQ",
  },
  { label1: "Unicast", label2: "IPv4" },
  { label1: "VxLan", label2: "IPv6" },
  {
    label1: "Non-Unicast",
    label2: "MPLS",
  },
  { label1: null, label2: "ARP" },
  { label1: "Total", label2: "Unknown" },
];

export const modes: { [key: number]: string } = {
  0: "Generation Mode",
  1: "CBR",
  2: "Mpps",
  3: "Poisson",
  4: "Monitor",
};
