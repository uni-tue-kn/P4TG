import { useEffect, useState } from "react";
import {
  DefaultTrafficGenData,
  DefaultStream,
  DefaultStreamSettings,
  TrafficGenData,
  TrafficGenList,
  GenerationMode,
  RFCTestResults,
  RFCTestSelection,
  Port,
  ProfileMode,
} from "../../common/Interfaces";
import { get } from "../../common/API";
import { Col, Row } from "react-bootstrap";
import {
  renderRFCSelect,
  renderProfileDropdown,
} from "../../common/utils/Settings/Profile/Selection";
import { RFCContent } from "../../common/utils/Settings/Profile/Content/Rfc";
import { IMIXContent } from "../../common/utils/Settings/Profile/Content/IMIX";
import translate from "../translation/Translate";

const Profile = ({ ports }: { ports: Port[] }) => {
  const [running, set_running] = useState(false);

  const [traffic_gen_list, set_traffic_gen_list] = useState<TrafficGenList>(
    JSON.parse(localStorage.getItem("traffic_gen") ?? "{}")
  );

  const storedTest = JSON.parse(localStorage.getItem("test") || "{}");

  const [selected_profile, setSelectedProfile] = useState<ProfileMode>(
    storedTest.profile ?? ProfileMode.RFC2544
  );

  const [rfc, setRFC] = useState<RFCTestSelection>(
    storedTest.selectedRFC ?? RFCTestSelection.ALL
  );

  const [currentTest, setCurrentTest] = useState<TrafficGenData | null>(null);

  const [results, set_results] = useState<RFCTestResults>({
    throughput: null,
    latency: null,
    frame_loss_rate: null,
    back_to_back: null,
    reset: null,
  });

  const handleRFCChange = (event: any) => {
    setRFC(event.target.value);
  };

  const loadDefaultGen = async () => {
    if (Object.keys(traffic_gen_list).length === 0) {
      const defaultData = DefaultTrafficGenData(ports);
      set_traffic_gen_list({
        ...traffic_gen_list,
        [selected_profile]: defaultData,
      });
      setCurrentTest(defaultData);
    } else {
      const savedCurrentTest = traffic_gen_list[selected_profile];
      setCurrentTest(savedCurrentTest);

      const testObj = JSON.parse(localStorage.getItem("test") || "{}");

      if (!testObj) {
        testObj.selectedRFC = RFCTestSelection.ALL;
        testObj.mode = 2;
        localStorage.setItem("test", JSON.stringify(testObj));
      }
    }
  };

  const loadTestResults = async () => {
    try {
      let results = await get({ route: "/profiles" });

      if (results && results.status === 200) {
        set_results(results.data);
        if (!results.data.running) {
          set_running(false);
        } else {
          set_running(true);
        }
      } else {
        console.error("Failed to load results:", results);
      }
    } catch (error) {
      console.error("Error loading results:", error);
    }
  };

  useEffect(() => {
    const results = setInterval(loadTestResults, 1000);
    loadTestResults();
    const savedTrafficGenList = JSON.parse(
      localStorage.getItem("traffic_gen") ?? "{}"
    );
    set_traffic_gen_list(savedTrafficGenList);
    setCurrentTest(savedTrafficGenList[0] || null);
    loadDefaultGen();
    return () => {
      clearInterval(results);
    };
  }, [selected_profile]);

  const handlePortChange = (event: any, pid: number) => {
    if (!currentTest) return;

    const newPortTxRxMapping = { ...currentTest.port_tx_rx_mapping };

    if (parseInt(event.target.value) === -1) {
      delete newPortTxRxMapping[pid];
    } else {
      newPortTxRxMapping[pid] = parseInt(event.target.value);
    }

    const updatedTest: TrafficGenData = {
      ...currentTest,
      port_tx_rx_mapping: newPortTxRxMapping,
    };

    setCurrentTest(updatedTest);
  };

  const removeStream = () => {
    alert("For RFC2544 one stream is required.");
  };

  const save = () => {
    if (!currentTest) return;

    const updatedTrafficGenList: TrafficGenList = {
      [selected_profile]: { ...currentTest },
    };

    localStorage.setItem(
      "test",
      JSON.stringify({
        mode: 2,
        selectedRFC: Number(rfc),
        profile: Number(selected_profile),
      })
    );
    localStorage.setItem("traffic_gen", JSON.stringify(updatedTrafficGenList));
    set_traffic_gen_list(updatedTrafficGenList);
    alert("Settings saved.");
  };

  const reset = () => {
    if (!currentTest) return;

    const initialStream = DefaultStream(1);
    const initialStreamSettings = ports
      .filter((v) => v.loopback === "BF_LPBK_NONE")
      .map((v) => DefaultStreamSettings(1, v.pid));

    const updatedTest: TrafficGenData = {
      ...currentTest,
      streams: [initialStream],
      stream_settings: initialStreamSettings,
      port_tx_rx_mapping: {},
      mode: GenerationMode.CBR,
      duration: 0,
    };

    const updatedTrafficGenList: TrafficGenList = {
      [selected_profile]: updatedTest,
    };

    localStorage.setItem("traffic_gen", JSON.stringify(updatedTrafficGenList));
    localStorage.setItem(
      "test",
      JSON.stringify({
        mode: 2,
        selectedRFC: RFCTestSelection.ALL,
        profile: ProfileMode.RFC2544,
      })
    );
    set_traffic_gen_list(updatedTrafficGenList);
    setCurrentTest(updatedTest);
    alert(translate("alert.reset", currentLanguage));
    window.location.reload();
  };

  const handleProfileChange = (profile: string | null) => {
    if (profile !== null) {
      const profileNumber = parseInt(profile, 10);

      setSelectedProfile(profileNumber as ProfileMode);

      localStorage.removeItem("traffic_gen");
      set_traffic_gen_list({});

      const testObj = JSON.parse(localStorage.getItem("test") || "{}");
      testObj.profile = profileNumber;
      localStorage.setItem("test", JSON.stringify(testObj));
    }
  };

  const [currentLanguage, setCurrentLanguage] = useState(
    localStorage.getItem("language") || "en-US"
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const storedLanguage = localStorage.getItem("language") || "en-US";
      if (storedLanguage != currentLanguage) {
        setCurrentLanguage(storedLanguage);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [currentLanguage]);

  return (
    <>
      <Row className="align-items-end d-flex justify-content-between">
        {renderProfileDropdown(
          selected_profile,
          handleProfileChange,
          running,
          currentLanguage
        )}
        <Col className="col-2">
          {selected_profile === ProfileMode.RFC2544 &&
            renderRFCSelect(running, rfc, currentLanguage, handleRFCChange)}
        </Col>
      </Row>
      {selected_profile === ProfileMode.RFC2544 && (
        <RFCContent
          results={results}
          running={running}
          currentLanguage={currentLanguage}
          removeStream={removeStream}
          currentTest={currentTest}
          ports={ports}
          handlePortChange={handlePortChange}
          save={save}
          reset={reset}
        />
      )}
      {selected_profile === ProfileMode.IMIX && (
        <IMIXContent
          running={running}
          currentLanguage={currentLanguage}
          ports={ports}
        />
      )}
    </>
  );
};

export default Profile;
