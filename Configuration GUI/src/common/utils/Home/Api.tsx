import { get } from "../../API";
import {
  Statistics as StatInterface,
  TimeStatistics,
  TrafficGenList,
  TrafficGenData,
  DefaultTrafficGenData,
  Port,
  RFCTestSelection,
  TestMode,
} from "../../Interfaces";

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

export const loadPorts = async (set_ports: SetState<Port[]>) => {
  try {
    const stats = await get({ route: "/ports" });
    if (stats && stats.status === 200) {
      set_ports(stats.data);
    }
  } catch (error) {
    console.error("Error fetching ports:", error);
  }
};

export const loadStatistics = async (
  set_statistics: SetState<StatInterface>
) => {
  try {
    const stats = await get({ route: "/statistics" });
    if (stats && stats.status === 200) {
      set_statistics(stats.data);
    }
  } catch (error) {
    console.error("Error fetching statistics:", error);
  }
};

export const loadTimeStatistics = async (
  set_time_statistics: SetState<TimeStatistics>
) => {
  try {
    const stats = await get({ route: "/time_statistics?limit=100" });
    if (stats && stats.status === 200) {
      set_time_statistics(stats.data);
    }
  } catch (error) {
    console.error("Error fetching time statistics:", error);
  }
};

export const loadGen = async (
  set_traffic_gen_list: SetState<TrafficGenList>,
  set_running: SetState<boolean>
) => {
  try {
    const tg = await get({ route: "/trafficgen" });
    if (tg && Object.keys(tg.data).length > 1 && tg.data.all_test) {
      const allTests = tg.data.all_test;
      const trafficGenList: TrafficGenList = Object.fromEntries(
        Object.entries(allTests).map(([testKey, test]: [string, any]) => [
          parseInt(testKey, 10),
          {
            streams: test.streams,
            stream_settings: test.stream_settings,
            port_tx_rx_mapping: test.port_tx_rx_mapping,
            mode: test.mode,
            duration: test.duration,
            name: test.name,
          } as TrafficGenData,
        ])
      );
      localStorage.setItem("traffic_gen", JSON.stringify(trafficGenList));
      set_traffic_gen_list(trafficGenList);
      set_running(true);
    } else {
      set_running(false);
    }
  } catch (error) {
    console.error("Error fetching traffic gen data:", error);
  }
};

export const loadDefaultGen = async (
  set_traffic_gen_list: SetState<TrafficGenList>
) => {
  try {
    const stats = await get({ route: "/ports" });
    if (stats.status === 200) {
      const trafficGenData: TrafficGenList = JSON.parse(
        localStorage.getItem("traffic_gen") ?? "{}"
      );
      if (Object.keys(trafficGenData).length === 0) {
        const defaultData = DefaultTrafficGenData(stats.data);
        set_traffic_gen_list({ 1: defaultData });
        localStorage.setItem("traffic_gen", JSON.stringify({ 1: defaultData }));
        window.location.reload();
      }
      if (!localStorage.getItem("test")) {
        localStorage.setItem(
          "test",
          JSON.stringify({
            mode: TestMode.SINGLE,
            selectedRFC: RFCTestSelection.ALL,
          })
        );
        window.location.reload();
      }
    }
  } catch (error) {
    console.error("Error fetching default traffic gen data:", error);
  }
};

export const refresh = async (
  set_loaded: SetState<boolean>,
  loadGen: () => Promise<void>,
  loadDefaultGen: () => Promise<void>,
  loadStatistics: () => Promise<void>,
  loadTestInfo: () => Promise<void>,
  loadPorts: () => Promise<void>
) => {
  await loadGen();
  await loadDefaultGen();
  await loadStatistics();
  await loadTestInfo();
  await loadPorts();
  set_loaded(true);
};

export const reset = async (set_overlay: SetState<boolean>) => {
  set_overlay(true);
  await get({ route: "/reset" });
  set_overlay(false);
};

export const restart = async (set_overlay: SetState<boolean>) => {
  set_overlay(true);
  await get({ route: "/restart" });
  set_overlay(false);
};

export const loadTestInfo = async (
  setTotalTestsNumber: SetState<number>,
  setCurrentTestNumber: SetState<number>,
  setCurrentTestDuration: SetState<number>,
  traffic_gen_list: TrafficGenList
) => {
  let stats, tg;
  try {
    stats = await get({ route: "/statistics" });
    tg = await get({ route: "/trafficgen" });
  } catch (error) {
    console.error("Error fetching test info:", error);
    return;
  }

  if (tg && tg.status === 200 && tg.data.all_test) {
    const allTests = tg.data.all_test;
    const newTotalTestsNumber = Object.keys(allTests).length;

    setTotalTestsNumber(newTotalTestsNumber);

    if (stats && stats.status === 200) {
      const previousStats = stats.data.previous_statistics ?? {};
      const testNumbersArray = Object.keys(previousStats).map(Number);

      let currentTestNumber =
        testNumbersArray.length > 0 ? Math.max(...testNumbersArray) + 1 : 1;

      if (currentTestNumber > newTotalTestsNumber) {
        currentTestNumber = newTotalTestsNumber;
      }

      setCurrentTestNumber(currentTestNumber);

      const newTestDuration =
        traffic_gen_list[currentTestNumber]?.duration || 0;
      setCurrentTestDuration(newTestDuration);
    }
  }
};

export const loadProfileInfo = async (
  setCurrentProfileTest: SetState<string | null>,
  setProfileData: SetState<any>
) => {
  let profile;
  try {
    profile = await get({ route: "/profiles" });
  } catch (error) {
    console.error("Error fetching profile info:", error);
    return;
  }

  if (profile && profile.status === 200) {
    const testResults = profile.data;

    const currentTest = testResults.current_test
      ? testResults.current_test
      : "All tests completed or unknown test state.";

    setCurrentProfileTest(currentTest);
    setProfileData(testResults);
  }
};
