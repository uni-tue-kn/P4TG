import {
  Statistics,
  TimeStatistics,
  TrafficGenList,
  TestMode,
  ProfileMode,
} from "../../common/Interfaces";
import { get_csv_data } from "../../common/utils/Csv/csvCreation";
import { get_csv_rfc_data } from "../../common/utils/Csv/formatingData";

const DownloadCsv = ({
  data,
  stats,
  traffic_gen_list,
  selectedProfile,
  test_mode,
  profileData,
}: {
  data: TimeStatistics;
  stats: Statistics;
  traffic_gen_list: TrafficGenList;
  selectedProfile: ProfileMode;
  test_mode: TestMode;
  profileData: any;
}) => {
  const handleDownloadCsv = () => {
    const csvDataList: any = [];

    Object.keys(traffic_gen_list).forEach((testKey: string) => {
      if (Number(testKey) >= 1) {
        const port_mapping =
          traffic_gen_list[Number(testKey)].port_tx_rx_mapping;
        if (stats.previous_statistics && data.previous_time_statistics) {
          const statistics = stats.previous_statistics[Number(testKey)];
          const time_statistics =
            data.previous_time_statistics[Number(testKey)];

          if (statistics === undefined || time_statistics === undefined) {
            return;
          }
          const csvData = get_csv_data(
            time_statistics,
            statistics,
            port_mapping,
            selectedProfile,
            traffic_gen_list,
            Number(testKey)
          );
          csvDataList.push(csvData);
        } else {
          console.log("No previous statistics or time statistics");
          const csvData = get_csv_data(
            data,
            stats,
            port_mapping,
            selectedProfile,
            traffic_gen_list,
            Number(testKey)
          );
          csvDataList.push(csvData);
        }
      } else {
        console.log("Invalid test key");
      }
    });

    if (
      test_mode === TestMode.PROFILE &&
      selectedProfile === ProfileMode.RFC2544
    ) {
      const rfcData = get_csv_rfc_data(profileData);
      csvDataList.push(rfcData);
    }

    if (csvDataList.length !== 0) {
      // Merge all CSV data
      const csvData = csvDataList.flat();
      const csvContent =
        "data:text/csv;charset=utf-8," +
        csvData.map((e: any) => e.join(",")).join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", "Network Report.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      console.log("No data to download");
    }
  };

  return { handleDownloadCsv };
};

export default DownloadCsv;
