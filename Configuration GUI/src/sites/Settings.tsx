import { useEffect, useRef, useState } from "react";
import { Col, Form, Row, Tab, Tabs } from "react-bootstrap";
import { get } from "../common/API";
import {
  GenerationMode,
  P4TGInfos,
  DefaultStream,
  DefaultStreamSettings,
  TestMode,
  TrafficGenData,
  TrafficGenList,
  DefaultTrafficGenData,
  TabInterface,
  Port,
} from "../common/Interfaces";
import Loader from "../components/Loader";
import { GitHub } from "./Home";
import translate from "../components/translation/Translate";

import { loadPorts } from "../common/utils/Home/Api";

import {
  SaveResetButtons,
  AddStreamButton,
  TotalDuration,
  ImportExport,
} from "../common/utils/Settings/Components";

import {
  TestModeSelection,
  GenerationModeSelection,
} from "../common/utils/Settings/ModeSelection";

import {
  isTabValid,
  isTrafficGenData,
  isTrafficGenList,
} from "../common/utils/Settings/Validators";

import {
  deleteLocalStorageEntry,
  saveToLocalStorage,
} from "../common/utils/Settings/LocalStorage";

import StreamTable from "../components/settings/StreamTable";
import PortMappingTable from "../components/settings/PortMappingTable";
import { validateStreamSettings, validateStreams } from "../common/Validators";
import Profile from "../components/settings/SettingsProfile";
import styled from "styled-components";

export const StyledRow = styled.tr`
  display: flex;
  align-items: center;
`;

export const StyledCol = styled.td`
  vertical-align: middle;
  display: table-cell;
  text-indent: 5px;
`;

const Settings = ({ p4tg_infos }: { p4tg_infos: P4TGInfos }) => {
  const [ports, set_ports] = useState<Port[]>([]);
  const [traffic_gen_list, set_traffic_gen_list] = useState<TrafficGenList>(
    JSON.parse(localStorage.getItem("traffic_gen") ?? "{}")
  );

  const [currentTestMode, setCurrentTestMode] = useState(
    JSON.parse(
      localStorage.getItem("test") || '{"mode": ' + TestMode.SINGLE + "}"
    ).mode
  );

  const [currentTabIndex, setCurrentTabIndex] = useState<string | null>(
    Object.keys(traffic_gen_list)[0] ?? null
  );
  const [currentTest, setCurrentTest] = useState<TrafficGenData | null>(
    traffic_gen_list[Object.keys(traffic_gen_list)[0] as any] ?? null
  );
  const [key, setKey] = useState<string>("tab-1");

  const [tabs, setTabs] = useState<TabInterface[]>([]);
  const [running, set_running] = useState(false);

  const [totalDuration, setTotalDuration] = useState<number>(0);

  const [currentLanguage, setCurrentLanguage] = useState(
    localStorage.getItem("language") || "en-US"
  );

  const [loaded, set_loaded] = useState(true);

  const ref = useRef();

  const handleTestModeChange = async (event: any) => {
    const newValue = Number(event.target.value);

    const isProfileToSingleOrMulti =
      currentTestMode === TestMode.PROFILE &&
      (newValue === TestMode.SINGLE || newValue === TestMode.MULTI);

    if (isProfileToSingleOrMulti) {
      await get({ route: "/reset" });
    }
    localStorage.removeItem("traffic_gen");
    set_traffic_gen_list({});
    setCurrentTest(DefaultTrafficGenData(ports));
    setTabs([]);
    setTotalDuration(0);

    localStorage.setItem("test", JSON.stringify({ mode: newValue }));
    setCurrentTestMode(newValue);
  };

  const handleTitleChange = (eventKey: string, newTitle: string) => {
    if (currentTestMode === TestMode.MULTI) {
      setTabs((prevTabs) =>
        prevTabs.map((tab) =>
          tab.eventKey === eventKey ? { ...tab, title: newTitle } : tab
        )
      );

      if (currentTabIndex && currentTest) {
        const updatedTest: TrafficGenData = {
          ...currentTest,
          name: newTitle,
        };

        const updatedTrafficGenList: TrafficGenList = {
          ...traffic_gen_list,
          [currentTabIndex]: updatedTest,
        };

        set_traffic_gen_list(updatedTrafficGenList);
        setCurrentTest(updatedTest);
      }
    }
  };

  const toggleTitleEdit = (eventKey: string) => {
    if (currentTestMode === TestMode.MULTI) {
      setTabs((prevTabs) =>
        prevTabs.map((tab) =>
          tab.eventKey === eventKey
            ? { ...tab, titleEditable: !tab.titleEditable }
            : tab
        )
      );
    }
  };

  useEffect(() => {
    if (Object.keys(traffic_gen_list).length > 0) {
      initializeTabs();
    }
  }, [Object.keys(traffic_gen_list).length]);

  const initializeTabs = () => {
    if (currentTestMode === TestMode.MULTI) {
      const initializedTabs: TabInterface[] = Object.keys(traffic_gen_list).map(
        (key) => {
          const test = traffic_gen_list[key as any];
          return {
            eventKey: `tab-${key}`,
            title: test.name ?? `Test ${key}`,
            titleEditable: false,
          };
        }
      );
      initializedTabs.push({
        eventKey: "add",
        title: "+",
        titleEditable: false,
      });
      setTabs(initializedTabs);
    } else {
      const initializedTabs: TabInterface[] = [
        {
          eventKey: "tab-1",
          title: traffic_gen_list[1]?.name ?? "Test 1",
          titleEditable: false,
        },
      ];
      setTabs(initializedTabs);
      setKey("tab-1");
      setCurrentTabIndex("1");
      setCurrentTest(traffic_gen_list[1]);
    }
  };

  const addTab = () => {
    const newTabNumber = Object.keys(traffic_gen_list).length + 1;
    const newTabKey = `tab-${newTabNumber}`;

    const initialStream = DefaultStream(1);
    const initialStreamSettings = ports
      .filter((v) => v.loopback === "BF_LPBK_NONE")
      .map((v) => {
        const settings = DefaultStreamSettings(1, v.pid);
        return settings;
      });

    const newTrafficGenData: TrafficGenData = {
      streams: [initialStream],
      stream_settings: initialStreamSettings,
      port_tx_rx_mapping: {},
      mode: GenerationMode.CBR,
      duration: 0,
    };

    const updatedTrafficGenList = {
      ...traffic_gen_list,
      [newTabNumber]: newTrafficGenData,
    };

    saveToLocalStorage("traffic_gen", updatedTrafficGenList);
    set_traffic_gen_list(updatedTrafficGenList);

    const newTab = {
      eventKey: newTabKey,
      title: `Test ${newTabNumber}`,
      titleEditable: false,
      duration: 0,
    };

    const newTabs = [...tabs];
    newTabs.splice(tabs.length - 1, 0, newTab);
    setTabs(newTabs);
    setKey(newTabKey);
    setCurrentTabIndex(newTabNumber.toString());
    setCurrentTest(newTrafficGenData);
  };

  const deleteStatesEntry = (key: string) => {
    const updatedTrafficGenList = { ...traffic_gen_list };
    delete updatedTrafficGenList[key as any];

    const newTrafficGenList: any = {};
    let newIndex = 1;
    Object.keys(updatedTrafficGenList).forEach((k) => {
      newTrafficGenList[newIndex] = updatedTrafficGenList[k as any];
      newIndex++;
    });

    set_traffic_gen_list(newTrafficGenList);
  };

  const deleteTab = (eventKey: string) => {
    const tabNumber = eventKey.split("-")[1];

    deleteLocalStorageEntry(tabNumber);
    deleteStatesEntry(tabNumber);

    const newTabs = tabs.filter((tab) => tab.eventKey !== eventKey);

    newTabs.forEach((tab, i) => {
      if (tab.title.startsWith("Test")) {
        tab.title = `Test ${i + 1}`;
      }
    });

    setTabs(newTabs);

    if (eventKey === key && newTabs.length >= 2) {
      const newIndex = tabs.findIndex((tab) => tab.eventKey === eventKey);
      const newActiveTabIndex =
        newIndex < newTabs.length - 1 ? newIndex : newIndex - 1;
      setKey(newTabs[newActiveTabIndex].eventKey);
      setCurrentTabIndex(newTabs[newActiveTabIndex].eventKey.split("-")[1]);
      setCurrentTest(
        traffic_gen_list[
        newTabs[newActiveTabIndex].eventKey.split("-")[1] as any
        ]
      );
    } else if (newTabs.length === 1) {
      setKey(newTabs[0].eventKey);
      setCurrentTabIndex(newTabs[0].eventKey.split("-")[1]);
      setCurrentTest(
        traffic_gen_list[newTabs[0].eventKey.split("-")[1] as any]
      );
    }
  };

  const loadDefaultGen = async () => {
    let stats = await get({ route: "/ports" });
    if (stats.status === 200) {
      const trafficGenData = JSON.parse(
        localStorage.getItem("traffic_gen") ?? "{}"
      );

      const isAnyStreamEmpty = Object.keys(trafficGenData).some(
        (key) => trafficGenData[key]?.streams?.length === 0
      );

      if (Object.keys(trafficGenData).length === 0 || isAnyStreamEmpty) {
        const defaultData = DefaultTrafficGenData(stats.data);
        set_traffic_gen_list({ 1: defaultData });
        localStorage.setItem("traffic_gen", JSON.stringify({ 1: defaultData }));
      }
      if (!localStorage.getItem("test")) {
        localStorage.setItem("test", JSON.stringify({ mode: TestMode.SINGLE }));
        setCurrentTestMode(TestMode.SINGLE);
      }
    }
  };

  const handlePortChange = (event: any, pid: number) => {
    if (!currentTest || currentTabIndex === null) return;

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

    const updatedTrafficGenList: TrafficGenList = {
      ...traffic_gen_list,
      [currentTabIndex]: updatedTest,
    };

    saveToLocalStorage("traffic_gen", updatedTrafficGenList);
    set_traffic_gen_list(updatedTrafficGenList);
    setCurrentTest(updatedTest);
  };
  console.log(currentTest);

  const save = () => {
    if (currentTabIndex && currentTest) {
      const { valid, reason } = isTabValid(
        parseInt(currentTabIndex),
        currentTestMode,
        traffic_gen_list
      );

      if (!valid) {
        alert(
          `The selected test is not valid.\nReason: ${reason}.\nSettings could not be saved`
        );
        return;
      }
      const updatedTest: TrafficGenData = {
        streams: currentTest.streams,
        stream_settings: currentTest.stream_settings,
        port_tx_rx_mapping: currentTest.port_tx_rx_mapping,
        mode: currentTest.mode,
        duration: currentTest.duration,
        name: currentTest.name,
      };

      const updatedTrafficGenList: TrafficGenList = {
        ...traffic_gen_list,
        [currentTabIndex]: updatedTest,
      };

      saveToLocalStorage("traffic_gen", updatedTrafficGenList);
      set_traffic_gen_list(updatedTrafficGenList);
      setCurrentTest(updatedTest);

      alert(translate("alert.saved", currentLanguage));
    } else {
      alert(translate("alert.selected", currentLanguage));
    }
  };

  const reset = () => {
    const initialStream = DefaultStream(1);
    const initialStreamSettings = ports
      .filter((v) => v.loopback === "BF_LPBK_NONE")
      .map((v) => {
        const settings = DefaultStreamSettings(1, v.pid);
        return settings;
      });

    if (currentTabIndex) {
      const updatedTest: TrafficGenData = {
        streams: [initialStream],
        stream_settings: initialStreamSettings,
        port_tx_rx_mapping: {},
        mode: GenerationMode.CBR,
        duration: 0,
      };

      const updatedTrafficGenList: TrafficGenList = {
        ...traffic_gen_list,
        [currentTabIndex]: updatedTest,
      };

      saveToLocalStorage("traffic_gen", updatedTrafficGenList);
      set_traffic_gen_list(updatedTrafficGenList);
      setCurrentTest(updatedTest);
      window.location.reload();

      alert(translate("alert.reset", currentLanguage));
    } else {
      alert(translate("alert.selected", currentLanguage));
    }
  };

  const removeStream = (id: number) => {
    if (!currentTest || currentTabIndex === null) return;

    const updatedStreams = currentTest.streams.filter(
      (v) => v.stream_id !== id
    );
    const updatedStreamSettings = currentTest.stream_settings.filter(
      (v) => v.stream_id !== id
    );

    const updatedTest: TrafficGenData = {
      ...currentTest,
      streams: updatedStreams,
      stream_settings: updatedStreamSettings,
    };

    const updatedTrafficGenList: TrafficGenList = {
      ...traffic_gen_list,
      [currentTabIndex]: updatedTest,
    };

    saveToLocalStorage("traffic_gen", updatedTrafficGenList);
    set_traffic_gen_list(updatedTrafficGenList);
    setCurrentTest(updatedTest);
  };

  const addStream = () => {
    if (!currentTest || currentTabIndex === null) return;

    if (currentTest.streams.length > 6) {
      alert(translate("alert.streamLimit", currentLanguage));
    } else {
      let id = 0;

      if (currentTest.streams.length > 0) {
        id = Math.max(...currentTest.streams.map((s) => s.stream_id));
      }

      const newStream = DefaultStream(id + 1);
      const newStreamSettings = ports
        .filter((v) => v.loopback === "BF_LPBK_NONE")
        .map((v) => DefaultStreamSettings(id + 1, v.pid));

      const updatedStreams = [...currentTest.streams, newStream];
      const updatedStreamSettings = [
        ...(currentTest.stream_settings || []),
        ...newStreamSettings,
      ];

      const updatedTest: TrafficGenData = {
        ...currentTest,
        streams: updatedStreams,
        stream_settings: updatedStreamSettings,
      };

      const updatedTrafficGenList: TrafficGenList = {
        ...traffic_gen_list,
        [currentTabIndex]: updatedTest,
      };

      set_traffic_gen_list(updatedTrafficGenList);
      setCurrentTest(updatedTest);
    }
  };

  const handleModeChange = (event: any) => {
    if (!currentTest || currentTabIndex === null) return;

    const newMode = parseInt(event.target.value);

    let updatedTest: TrafficGenData = {
      ...currentTest,
      mode: newMode,
    };

    if (newMode === GenerationMode.POISSON && currentTest.streams.length > 0) {
      updatedTest = {
        ...updatedTest,
        streams: currentTest.streams.slice(0, 1),
        stream_settings: currentTest.stream_settings.filter(
          (setting) => setting.stream_id === currentTest.streams[0].stream_id
        ),
      };
    }

    const updatedTrafficGenList: TrafficGenList = {
      ...traffic_gen_list,
      [currentTabIndex]: updatedTest,
    };

    set_traffic_gen_list(updatedTrafficGenList);
    setCurrentTest(updatedTest);
  };

  const handleDurationChange = (event: any) => {
    if (!currentTest || currentTabIndex === null) return;

    const newDuration = isNaN(parseInt(event.target.value))
      ? 0
      : parseInt(event.target.value);

    if (newDuration < 0) {
      return;
    }

    const updatedTest: TrafficGenData = {
      ...currentTest,
      duration: newDuration,
    };

    const updatedTrafficGenList: TrafficGenList = {
      ...traffic_gen_list,
      [currentTabIndex]: updatedTest,
    };

    set_traffic_gen_list(updatedTrafficGenList);
    setCurrentTest(updatedTest);
  };

  const handleTotalDurationChange = (tests: TrafficGenList) => {
    let total = 0;
    Object.keys(tests).forEach((key) => {
      const test = tests[key as any];
      if (test && test.duration) {
        total += test.duration;
      }
    });
    setTotalDuration(total);
  };

  const exportSettings = () => {
    const settings = traffic_gen_list;

    const json = `data:text/json;charset=utf-8,${encodeURIComponent(
      JSON.stringify(settings, null, "\t")
    )}`;

    const link = document.createElement("a");
    link.href = json;
    link.download = "settings.json";

    link.click();
  };

  const importSettings = (e: any) => {
    // @ts-ignore
    ref.current.click();
  };

  const loadSettings = (e: any) => {
    e.preventDefault();

    const fileReader = new FileReader();
    fileReader.readAsText(e.target.files[0], "UTF-8");

    fileReader.onload = (e: any) => {
      let data: any = JSON.parse(e.target.result);

      if (isTrafficGenData(data)) {
        data = { 1: data };
      }

      if (!isTrafficGenList(data)) {
        alert(translate("Settings not valid.", currentLanguage));
        // @ts-ignore
        ref.current.value = "";
        return;
      }

      for (const key in data) {
        if (
          !validateStreams(data[key].streams) ||
          !validateStreamSettings(data[key].stream_settings)
        ) {
          alert(translate("Settings not valid.", currentLanguage));
          // @ts-ignore
          ref.current.value = "";
          return;
        }
      }

      localStorage.setItem("traffic_gen", JSON.stringify(data));

      set_traffic_gen_list(data);
      setCurrentTest(data[currentTabIndex as any]);

      alert(translate("Import successful. Reloading...", currentLanguage));
      window.location.reload();
    };
  };

  const loadGen = async () => {
    let tg = await get({ route: "/trafficgen" });
    let profile = await get({ route: "/profiles" });

    if (Object.keys(tg.data).length > 1) {
      let old_gen_string = JSON.stringify(traffic_gen_list);
      let new_gen: TrafficGenList;

      set_running(true);

      new_gen = tg.data.all_test[1].duration
        ? tg.data.all_test
        : { "1": tg.data };

      // Ich will auch nach dem der Test abgeschlossen ist die Profile anzeigen können
      if (profile.data.running) {
        setCurrentTestMode(TestMode.PROFILE);
      } else if (tg.data.all_test[1].duration) {
        setCurrentTestMode(TestMode.MULTI);
      } else {
        setCurrentTestMode(TestMode.SINGLE);
      }

      let new_gen_string = JSON.stringify(new_gen);

      if (new_gen_string !== old_gen_string) {
        localStorage.setItem("traffic_gen", new_gen_string);
        set_traffic_gen_list(new_gen);

        const firstTabKey = Object.keys(new_gen)[0];
        setCurrentTabIndex(firstTabKey);
        setCurrentTest(new_gen[firstTabKey as any]);

        if (currentTestMode !== TestMode.PROFILE) {
          window.location.reload();
        }
      }
    } else {
      set_running(false);
    }
  };

  const refresh = async () => {
    set_loaded(false);
    await loadPorts(set_ports);
    await loadGen();
    await loadDefaultGen();
    set_loaded(true);
  };

  useEffect(() => {
    refresh();

    const interval = setInterval(loadGen, 2000);
    const intervalDefault = setInterval(loadDefaultGen, 2000);

    return () => {
      clearInterval(interval);
      clearInterval(intervalDefault);
    };
  }, []);

  useEffect(() => {
    loadDefaultGen();
    initializeTabs();
  }, [currentTestMode]);

  useEffect(() => {
    handleTotalDurationChange(traffic_gen_list);
    loadDefaultGen();
  }, [traffic_gen_list]);

  useEffect(() => {
    const interval = setInterval(() => {
      const storedLanguage = localStorage.getItem("language") || "en-US";
      if (storedLanguage != currentLanguage) {
        setCurrentLanguage(storedLanguage);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [currentLanguage]);

  // @ts-ignore
  return (
    <Loader loaded={loaded}>
      <Row className="align-items-end justify-content-between">
        <TestModeSelection
          currentTestMode={currentTestMode}
          handleTestModeChange={handleTestModeChange}
          running={running}
          currentLanguage={currentLanguage}
        />

        {currentTestMode !== TestMode.PROFILE && (
          <Col className={"col-auto"}>
            <ImportExport
              currentLanguage={currentLanguage}
              handleImport={importSettings}
              handleExport={exportSettings}
              running={running}
            />
            {currentTestMode === TestMode.MULTI && (
              <>
                {" "}
                <TotalDuration
                  currentLanguage={currentLanguage}
                  totalDuration={totalDuration}
                />
              </>
            )}
          </Col>
        )}
      </Row>

      <div style={{ marginTop: "20px" }}></div>
      {currentTestMode !== TestMode.PROFILE ? (
        <Tabs
          onSelect={(k: string | null) => {
            if (k === "add") {
              addTab();
            } else if (k) {
              setKey(k);
              setCurrentTabIndex(k.split("-")[1]);
              setCurrentTest(traffic_gen_list[k.split("-")[1] as any]);
            }
          }}
          activeKey={key}
        >
          {tabs.map((tab, index) => (
            <Tab
              key={tab.eventKey}
              eventKey={tab.eventKey}
              title={
                tab.eventKey !== "add" ? (
                  <div className="d-flex align-items-center">
                    {tab.titleEditable ? (
                      <input
                        type="text"
                        value={tab.title}
                        onChange={(e) =>
                          handleTitleChange(tab.eventKey, e.target.value)
                        }
                        onBlur={() => toggleTitleEdit(tab.eventKey)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            toggleTitleEdit(tab.eventKey);
                          }
                        }}
                        autoFocus
                      />
                    ) : (
                      <span
                        onDoubleClick={() => toggleTitleEdit(tab.eventKey)}
                        style={{
                          color: "inherit",
                          textAlign: "inherit",
                          flexGrow: "inherit",
                          display: "inline",
                          opacity: "1",
                        }}
                      >
                        {(() => {
                          const { valid } = isTabValid(
                            index + 1,
                            currentTestMode,
                            traffic_gen_list
                          );
                          return valid ? (
                            tab.title
                          ) : (
                            <div>
                              <i className="bi bi-exclamation-triangle"></i>{" "}
                              {tab.title}
                            </div>
                          );
                        })()}
                      </span>
                    )}

                    {tab.eventKey !== "tab-1" && (
                      <button
                        className="outline-none border-0 bg-transparent"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTab(tab.eventKey);
                        }}
                      >
                        <i className="bi bi-x"></i>
                      </button>
                    )}
                  </div>
                ) : (
                  tab.title
                )
              }
            >
              <div style={{ marginTop: "20px" }}></div>

              <Row>
                <Col className={"col-2"}>
                  <Form.Text className="text-muted">
                    {translate("input.generationMode", currentLanguage)}
                  </Form.Text>
                </Col>
                {currentTestMode === TestMode.MULTI && (
                  <Col className={"col-2"}>
                    <Form.Text className="text-muted">
                      {translate("input.testDuration", currentLanguage)}
                    </Form.Text>
                  </Col>
                )}
              </Row>

              <Row className="align-items-end">
                <GenerationModeSelection
                  {...{
                    currentLanguage,
                    currentTest,
                    handleModeChange,
                    running,
                  }}
                />
                <Col className={"col-3 d-flex flex-row align-items-center"}>
                  {currentTestMode === TestMode.MULTI && (
                    <>
                      <Form onChange={handleDurationChange}>
                        <Form.Control
                          type="number"
                          min={0}
                          placeholder={translate(
                            "other.testDuration",
                            currentLanguage
                          )}
                          value={currentTest?.duration}
                          required
                        />
                      </Form>
                    </>
                  )}
                </Col>
              </Row>

              <StreamTable
                {...{
                  removeStream,
                  running,
                  currentTest,
                  currentLanguage,
                }}
              />

              <AddStreamButton
                {...{
                  addStream,
                  running,
                  currentTest,
                  currentLanguage,
                }}
              />

              <PortMappingTable
                {...{
                  ports,
                  running,
                  handlePortChange,
                  currentTest,
                }}
              />
              <SaveResetButtons
                onSave={save}
                onReset={reset}
                running={running}
                currentLanguage={currentLanguage}
              />
            </Tab>
          ))}
        </Tabs>
      ) : (
        <Profile {...{ ports }} />
      )}
      <input
        style={{ display: "none" }}
        accept=".json"
        // @ts-ignore
        ref={ref}
        onChange={loadSettings}
        type="file"
      />
      <GitHub />
    </Loader>
  );
};

export default Settings;
