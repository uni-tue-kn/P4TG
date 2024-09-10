import {
  Statistics,
  TimeStatistics,
  TrafficGenList,
  ProfileMode,
} from "../../Interfaces";
import { get_csv_summary_data, get_csv_ports_data } from "./formatingData";

export const get_csv_data = (
  data: TimeStatistics,
  stats: Statistics,
  port_mapping: { [name: number]: number },
  selectedProfile: ProfileMode,
  traffic_gen_list: TrafficGenList,
  testNumber: number
) => {
  const csvSummary = get_csv_summary_data(
    stats,
    data,
    port_mapping,
    traffic_gen_list,
    testNumber
  );
  const csvPorts =
    selectedProfile !== ProfileMode.RFC2544
      ? get_csv_ports_data(stats, data, port_mapping)
      : [];
  const csvData = [...csvSummary, ...csvPorts];

  return csvData;
};
