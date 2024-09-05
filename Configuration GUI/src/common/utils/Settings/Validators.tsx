import { TrafficGenData, TrafficGenList, TestMode } from "../../Interfaces";

const isTrafficGenData = (data: any): data is TrafficGenData => {
  return (
    data &&
    typeof data === "object" &&
    "streams" in data &&
    "stream_settings" in data &&
    "port_tx_rx_mapping" in data &&
    "mode" in data
  );
};

const isTrafficGenList = (data: any): data is TrafficGenList => {
  if (typeof data !== "object" || data === null) return false;
  for (const key in data) {
    if (!isTrafficGenData(data[key])) return false;
  }
  return true;
};

const isTabValid = (
  index: number,
  currentTestMode: TestMode,
  trafficGenList: TrafficGenList
) => {
  const test = trafficGenList[index];

  if (!test) {
    return { valid: false, reason: "Test not found" };
  }

  if (isEmptyObject(test.port_tx_rx_mapping)) {
    return { valid: false, reason: "Port TX/RX mapping is empty" };
  }

  if (currentTestMode === TestMode.MULTI && test.duration === 0) {
    return { valid: false, reason: "Duration is zero" };
  }

  return { valid: true, reason: "" };
};

const isEmptyObject = (obj: any) => {
  return Object.keys(obj).length === 0 && obj.constructor === Object;
};

export { isTrafficGenData, isTrafficGenList, isTabValid };
