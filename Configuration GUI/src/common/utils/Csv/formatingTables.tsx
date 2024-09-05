import {
  ethernetTypes,
  frameSizesMap as frameSizes,
  frameTypes,
  iatMetrics,
  rttMetrics,
} from "./constants";
import { Statistics } from "../../Interfaces";
import {
  formatFrameCount,
  formatNanoSeconds,
  get_frame_stats,
  get_frame_types,
} from "../StatisticUtils";

export const formatFrameStatistics = (
  stats: Statistics,
  port_mapping: { [name: number]: number },
  total_tx: number,
  total_rx: number
) => {
  const frameStats = frameSizes.map((frameSize, index) => {
    if (frameSize[0] === "Total") {
      return ["Total", formatFrameCount(total_tx), formatFrameCount(total_rx)];
    } else {
      const txCount = formatFrameCount(
        get_frame_stats(
          stats,
          port_mapping,
          "tx",
          Number(frameSize[1]),
          Number(frameSize[2])
        )
      );
      const rxCount = formatFrameCount(
        get_frame_stats(
          stats,
          port_mapping,
          "rx",
          Number(frameSize[1]),
          Number(frameSize[2])
        )
      );

      return [frameSize[0], txCount, rxCount];
    }
  });
  return frameStats;
};

export const formatFrameTypeStatistics = (
  stats: Statistics,
  mapping: { [name: number]: number },
  total_tx: number,
  total_rx: number
) => {
  return frameTypes.map((type) => {
    if (type === "Total") {
      // Für den "Total"-Eintrag, direkt die Gesamtsummen verwenden
      return [
        "Total",
        formatFrameCount(total_tx), // total_tx ist eine vorhandene Konstante
        formatFrameCount(total_rx), // total_rx ist eine vorhandene Konstante
      ];
    } else {
      // Berechnung und Formatierung für den spezifischen Frame-Typ
      const txCount = formatFrameCount(
        get_frame_types(stats, mapping, type.toLowerCase())["tx"]
      );
      const rxCount = formatFrameCount(
        get_frame_types(stats, mapping, type.toLowerCase())["rx"]
      );

      return [type, txCount, rxCount];
    }
  });
};

export const formatEthernetStatistics = (
  stats: Statistics,
  mapping: { [name: number]: number }
) => {
  return ethernetTypes.map((type) => {
    const txCount = formatFrameCount(
      get_frame_types(stats, mapping, type.toLowerCase())["tx"]
    );
    const rxCount = formatFrameCount(
      get_frame_types(stats, mapping, type.toLowerCase())["rx"]
    );

    return [type, txCount, rxCount];
  });
};

export const formatIatStatistics = (iat_tx: any, iat_rx: any) => {
  return iatMetrics.map((metric) => {
    return [
      metric.name,
      formatNanoSeconds(iat_tx[metric.tx]),
      formatNanoSeconds(iat_rx[metric.rx]),
    ];
  });
};

export const formatRttStatistics = (rtt: any) => {
  return rttMetrics.map((metric) => {
    const formattedValue = metric.format
      ? metric.format(rtt[metric.value])
      : formatNanoSeconds(rtt[metric.value]);

    return [metric.name, formattedValue];
  });
};

export const formatDataCategories = (categories: any) => {
  return categories.flatMap((category: any) => {
    return [
      [category.title],
      [["time"], ...category.labels],
      [[category.unit], ...category.data],
      [""],
    ];
  });
};

export const formatRFCTable = (
  data: { [key: string]: number | { [key: string]: number } | null } | null,
  frameSize: string,
  unit: string = ""
): string => {
  if (!data || data[frameSize] === undefined || data[frameSize] === null) {
    return "N/A";
  }

  const value = data[frameSize];

  if (typeof value === "object" && value !== null) {
    // Falls `value` ein Objekt ist, berechnen wir den Mittelwert der enthaltenen Werte
    const meanValue =
      Object.values(value).reduce((a, b) => a + b, 0) /
      Object.values(value).length;
    return `${meanValue.toFixed(3)}${unit}`;
  } else if (typeof value === "number") {
    // Falls `value` eine einzelne Zahl ist
    return `${value.toFixed(3)}${unit}`;
  }

  return "N/A";
};
