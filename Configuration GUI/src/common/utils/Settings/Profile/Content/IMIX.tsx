import {
  DefaultStreamSettings,
  IMIXTestSelection,
  Port,
} from "../../../../Interfaces";
import translate from "../../../../../components/translation/Translate";
import { ImixInfo } from "../InfoText";
import { SaveResetButtons } from "../../Components";
import PortMappingTable from "../../../../../components/settings/PortMappingTable";
import { useState, useEffect, useMemo } from "react";

const IMIXContent = ({
  running,
  currentLanguage,
  ports,
}: {
  running: boolean;
  currentLanguage: string;
  ports: Port[];
}) => {
  const storedTest = JSON.parse(localStorage.getItem("test") || "{}");
  const [trafficGen, setTrafficGen] = useState(
    JSON.parse(localStorage.getItem("traffic_gen") || "{}")
  );

  const imix: IMIXTestSelection =
    storedTest.selectedIMIX || IMIXTestSelection.SIMPLE;

  const [portMapping, setPortMapping] = useState(
    trafficGen["1"]?.port_tx_rx_mapping || {}
  );

  const defaultStreams = useMemo(
    () => [
      {
        stream_id: 1,
        app_id: 1,
        frame_size: 64,
        traffic_rate: 1.38135,
        vxlan: false,
        number_of_lse: 0,
        burst: 100,
        encapsulation: 0,
      },
      {
        stream_id: 2,
        app_id: 2,
        frame_size: 512,
        traffic_rate: 5.0116,
        vxlan: false,
        number_of_lse: 0,
        burst: 100,
        encapsulation: 0,
      },
      {
        stream_id: 3,
        app_id: 3,
        frame_size: 1518,
        traffic_rate: 3.6166,
        vxlan: false,
        number_of_lse: 0,
        burst: 100,
        encapsulation: 0,
      },
    ],
    []
  );

  const defaultStreamSettings = useMemo(
    () =>
      ports
        .filter((port) => port.loopback === "BF_LPBK_NONE")
        .flatMap((port) => [
          DefaultStreamSettings(1, port.pid),
          DefaultStreamSettings(2, port.pid),
          DefaultStreamSettings(3, port.pid),
        ]),
    [ports]
  );

  const [streamSettings, setStreamSettings] = useState(() => {
    const savedStreamSettings = trafficGen["1"]?.stream_settings;
    if (savedStreamSettings) {
      // Merge saved settings with default settings
      return defaultStreamSettings.map((defaultSetting) => {
        const savedSetting = savedStreamSettings.find(
          (setting: any) =>
            setting.stream_id === defaultSetting.stream_id &&
            setting.port === defaultSetting.port
        );
        return savedSetting
          ? { ...defaultSetting, ...savedSetting }
          : defaultSetting;
      });
    }
    return defaultStreamSettings;
  });

  useEffect(() => {
    const storedMapping = trafficGen["1"]?.port_tx_rx_mapping || {};
    setPortMapping(storedMapping);
  }, [trafficGen, ports]);

  const onSave = () => {
    const updatedTrafficGen = {
      ...trafficGen,
      "1": {
        ...trafficGen["1"],
        streams: defaultStreams,
        stream_settings: streamSettings,
        port_tx_rx_mapping: portMapping,
      },
    };

    setTrafficGen(updatedTrafficGen);

    localStorage.setItem("traffic_gen", JSON.stringify(updatedTrafficGen));
    localStorage.setItem(
      "test",
      JSON.stringify({
        ...storedTest,
        selectedIMIX: imix,
      })
    );

    alert(translate("alert.saved", currentLanguage));
  };

  const onReset = () => {
    const resetMapping = {};
    setPortMapping(resetMapping);
    setStreamSettings(defaultStreamSettings);
    alert(translate("alert.reset", currentLanguage));
  };

  const handlePortChange = (event: any, pid: number) => {
    const newMapping = { ...portMapping };
    newMapping[pid] = parseInt(event.target.value, 10);
    setPortMapping(newMapping);
  };

  return (
    <div style={{ marginTop: "20px" }}>
      <ImixInfo currentLanguage={currentLanguage} />
      <PortMappingTable
        ports={ports}
        running={running}
        currentTest={{
          streams: defaultStreams,
          stream_settings: streamSettings,
          port_tx_rx_mapping: portMapping,
          mode: 1,
        }}
        handlePortChange={handlePortChange}
        activateAllInRow={true}
      />
      <SaveResetButtons
        onSave={onSave}
        onReset={onReset}
        running={running}
        currentLanguage={currentLanguage}
      />
    </div>
  );
};

export { IMIXContent };
