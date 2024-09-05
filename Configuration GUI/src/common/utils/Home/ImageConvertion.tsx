import { TrafficGenList, RFCTestSelection } from "../../Interfaces";

import { activePorts } from "../StatisticUtils";

export const convertProfileData = (
  newImageData: string[],
  selectedRFC: number
) => {
  const profileData = [
    "throughput",
    "packet_loss",
    "latency",
    "frame_loss_rate",
    "reset",
  ];
  const profileImageMap: {
    [key: number]: { Summary: string[]; [key: string]: string[] };
  } = { 1: { Summary: [""] } };

  const profileMappings: { [key: number]: string[] } = {
    [RFCTestSelection.ALL]: profileData,
    [RFCTestSelection.THROUGHPUT]: ["throughput", "packet_loss"],
    [RFCTestSelection.LATENCY]: ["latency"],
    [RFCTestSelection.FRAME_LOSS_RATE]: ["frame_loss_rate"],
    [RFCTestSelection.RESET]: ["reset"],
  };

  const mappings = profileMappings[selectedRFC] || [];
  mappings.forEach((key, index) => {
    profileImageMap[1][key] = [newImageData[index]];
  });

  return profileImageMap;
};

export const convertTestData = (
  newImageData: string[],
  traffic_gen_list: TrafficGenList
) => {
  const newImageMap: {
    [key: number]: { Summary: string[]; [key: string]: string[] };
  } = {};
  let currentIndex = 0;

  Object.keys(traffic_gen_list).forEach((testId) => {
    const portMapping = traffic_gen_list[testId as any].port_tx_rx_mapping;
    const portPairs = activePorts(portMapping);

    newImageMap[Number(testId)] = {
      Summary: newImageData.slice(currentIndex, currentIndex + 6),
    };
    currentIndex += 6;

    portPairs.forEach((pair) => {
      const portPairKey = `${pair.tx}`;
      newImageMap[Number(testId)][portPairKey] = newImageData.slice(
        currentIndex,
        currentIndex + 6
      );
      currentIndex += 6;
    });
  });

  return newImageMap;
};
