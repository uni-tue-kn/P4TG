import { useEffect, useState } from "react";
import { Button, Col, Form, Row, Alert } from "react-bootstrap";
import { del, post } from "../common/API";
import SendReceiveMonitor from "../components/SendReceiveMonitor";
import Loader from "../components/Loader";
import {
  GenerationMode,
  TestMode,
  Statistics as StatInterface,
  StatisticsObject,
  TimeStatistics,
  TimeStatisticsObject,
  TrafficGenData,
  TrafficGenList,
  Port,
  RFCTestSelection,
  ProfileMode,
} from "../common/Interfaces";
import styled from "styled-components";
import translate from "../components/translation/Translate";
import HiddenGraphs from "../components/pdf/HiddenVisuals";
import Download from "../components/Download";

import RenderTabs from "../common/utils/Home/Tabs";
import TestInfoTooltip from "../common/utils/Home/Tooltip";

import {
  convertTestData,
  convertProfileData,
} from "../common/utils/Home/ImageConvertion";

import {
  loadPorts,
  loadStatistics,
  loadTimeStatistics,
  loadGen,
  loadDefaultGen,
  loadProfileInfo,
  loadTestInfo,
  refresh,
  reset,
  restart,
} from "../common/utils/Home/Api";

const StyledLink = styled.a`
  color: var(--color-secondary);
  text-decoration: none;
  opacity: 0.5;

  :hover {
    opacity: 1;
    color: var(--color-primary);
  }
`;

export const GitHub = () => {
  return (
    <Row className="mt-2">
      <Col className="text-center col-12 mt-3">
        <StyledLink href="https://github.com/uni-tue-kn/P4TG" target="_blank">
          P4TG @ <i className="bi bi-github"></i>
        </StyledLink>
      </Col>
    </Row>
  );
};

const Home = () => {
  const [loaded, set_loaded] = useState(false);
  const [overlay, set_overlay] = useState(false);
  const [running, set_running] = useState(false);
  const [visual, set_visual] = useState(true);

  const [imageData, setImageData] = useState<{
    [key: number]: { Summary: string[]; [key: string]: string[] };
  }>({});

  const [traffic_gen_list, set_traffic_gen_list] = useState<TrafficGenList>(
    JSON.parse(localStorage.getItem("traffic_gen") ?? "{}")
  );

  const [statistics, set_statistics] =
    useState<StatInterface>(StatisticsObject);
  const [time_statistics, set_time_statistics] =
    useState<TimeStatistics>(TimeStatisticsObject);

  const [selectedTest, setSelectedTest] = useState<{
    statistics: StatInterface | null;
    timeStatistics: TimeStatistics | null;
    trafficGen: TrafficGenData | null;
  }>({
    statistics: null,
    timeStatistics: null,
    trafficGen: null,
  });

  const [currentTestNumber, setCurrentTestNumber] = useState<number>(1);
  const [totalTestsNumber, setTotalTestsNumber] = useState<number>(1);
  const [currentTestDuration, setCurrentTestDuration] = useState<number>(0);
  const [currentProfileTest, setCurrentProfileTest] = useState<string | null>(
    null
  );
  const [profileData, setProfileData] = useState<any>(null);

  const [ports, set_ports] = useState<Port[]>([]);

  const storedTest = JSON.parse(localStorage.getItem("test") || "{}");
  const test_mode = storedTest.mode ?? TestMode.SINGLE;
  const selectedRFC = storedTest.selectedRFC ?? RFCTestSelection.ALL;
  const selectedProfile = storedTest.profile;

  useEffect(() => {
    refresh(
      set_loaded,
      () => loadGen(set_traffic_gen_list, set_running),
      () => loadDefaultGen(set_traffic_gen_list),
      () => loadStatistics(set_statistics),
      () =>
        loadTestInfo(
          setTotalTestsNumber,
          setCurrentTestNumber,
          setCurrentTestDuration,
          traffic_gen_list
        ),
      () => loadPorts(set_ports)
    );

    const interval_stats = setInterval(
      async () => await Promise.all([loadStatistics(set_statistics)]),
      500
    );
    const interval_info = setInterval(
      async () => await Promise.all([loadInfo()]),
      500
    );
    const interval_loadgen = setInterval(
      async () =>
        await Promise.all([loadGen(set_traffic_gen_list, set_running)]),
      5000
    );
    const interval_default_loadgen = setInterval(
      async () => await Promise.all([loadDefaultGen(set_traffic_gen_list)]),
      2000
    );
    const inverval_timestats = setInterval(
      async () => await Promise.all([loadTimeStatistics(set_time_statistics)]),
      2000
    );

    return () => {
      clearInterval(interval_stats);
      clearInterval(interval_info);
      clearInterval(interval_loadgen);
      clearInterval(interval_default_loadgen);
      clearInterval(inverval_timestats);
    };
  }, []);

  const [currentLanguage, setCurrentLanguage] = useState(
    localStorage.getItem("language") || "en-US"
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const storedLanguage = localStorage.getItem("language") || "en-US";
      if (storedLanguage !== currentLanguage) {
        setCurrentLanguage(storedLanguage);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [currentLanguage]);

  const onSubmit = async (event: any) => {
    event.preventDefault();
    set_overlay(true);

    if (running) {
      if (test_mode === TestMode.PROFILE) {
        await del({ route: "/profiles" });
      } else {
        await del({ route: "/trafficgen" });
      }
      set_running(false);
    } else {
      const oneModeAnalyze = Object.values(traffic_gen_list).some(
        (test) => test.mode === GenerationMode.ANALYZE
      );

      const streamsIsZero = Object.values(traffic_gen_list).every(
        (test) => test.streams.length === 0
      );

      if (streamsIsZero && oneModeAnalyze) {
        alert("You need to define at least one stream.");
      } else {
        let overall_rates = [];

        for (const test of Object.values(traffic_gen_list)) {
          let overall_rate = 0;
          test.streams.forEach((v: any) => {
            overall_rate += v.traffic_rate;
          });
          overall_rates.push(overall_rate);
        }

        const max_rate = Math.max(...overall_rates);

        const oneModeMPPS = Object.values(traffic_gen_list).some(
          (test) => test.gen_mode === GenerationMode.MPPS
        );

        if (oneModeMPPS && max_rate > 100) {
          alert("Sum of stream rates > 100 Gbps!");
        } else {
          if (test_mode === TestMode.SINGLE) {
            const singleTest = traffic_gen_list[1];

            const modifiedSingleTest =
              singleTest.mode === GenerationMode.ANALYZE
                ? { ...singleTest, streams: [] }
                : singleTest;

            await post({
              route: "/trafficgen",
              body: {
                streams: modifiedSingleTest.streams,
                stream_settings: modifiedSingleTest.stream_settings,
                port_tx_rx_mapping: modifiedSingleTest.port_tx_rx_mapping,
                mode: modifiedSingleTest.mode,
              },
            });
          } else if (test_mode === TestMode.MULTI) {
            const traffic_generations = Object.keys(traffic_gen_list).map(
              (test_number: any) => {
                const test = traffic_gen_list[test_number];
                const modifiedTest =
                  test.mode === GenerationMode.ANALYZE
                    ? { ...test, streams: [] }
                    : test;
                return {
                  streams: modifiedTest.streams,
                  stream_settings: modifiedTest.stream_settings,
                  port_tx_rx_mapping: modifiedTest.port_tx_rx_mapping,
                  mode: modifiedTest.mode,
                  duration: modifiedTest.duration,
                  name: modifiedTest.name,
                };
              }
            );

            await post({
              route: "/multiple_trafficgen",
              body: traffic_generations,
            });
            setTotalTestsNumber(traffic_generations.length);
          } else if (test_mode === TestMode.PROFILE) {
            await post({
              route: "/profiles",
              body: {
                profile_id: selectedProfile,
                test_id: selectedRFC,
                payload: {
                  streams: traffic_gen_list[1].streams,
                  stream_settings: traffic_gen_list[1].stream_settings,
                  port_tx_rx_mapping: traffic_gen_list[1].port_tx_rx_mapping,
                  mode: traffic_gen_list[1].mode,
                },
              },
            });
          }
          set_running(true);
        }
      }
    }
    set_overlay(false);
  };

  const loadInfo = async () => {
    if (test_mode === TestMode.MULTI) {
      await loadTestInfo(
        setTotalTestsNumber,
        setCurrentTestNumber,
        setCurrentTestDuration,
        traffic_gen_list
      );
    } else if (test_mode === TestMode.PROFILE) {
      await loadProfileInfo(setCurrentProfileTest, setProfileData);
    }
  };

  const shouldShowDownloadButton = (
    running: boolean,
    statistics: TimeStatistics,
    test_mode: TestMode,
    selectedProfile: ProfileMode,
    selectedRFC: RFCTestSelection,
    profileData: any
  ) => {
    if (
      test_mode === TestMode.PROFILE &&
      selectedProfile === ProfileMode.RFC2544 &&
      profileData
    ) {
      const profileKeys = ["throughput", "latency", "frame_loss_rate", "reset"];

      if (selectedRFC === RFCTestSelection.ALL) {
        const allTestsValid = profileKeys.every(
          (key) => profileData[key] !== null
        );
        return allTestsValid && profileData.running === false;
      } else {
        const profileKey = profileKeys[selectedRFC - 1];
        console.log(profileKey);
        return (
          profileData[profileKey] !== null && profileData.running === false
        );
      }
    }

    return (
      !running &&
      Object.keys(statistics.tx_rate_l1).length > 0 &&
      currentTestNumber === totalTestsNumber
    );
  };

  const handleGraphConvert = (newImageData: string[]) => {
    if (
      test_mode === TestMode.PROFILE &&
      selectedProfile === ProfileMode.RFC2544
    ) {
      setImageData(convertProfileData(newImageData, selectedRFC));
    } else {
      setImageData(convertTestData(newImageData, traffic_gen_list));
    }
  };

  const handleSelectTest = (testNumber: number) => {
    const selectedStatistics =
      statistics?.previous_statistics?.[testNumber] || null;
    const selectedTimeStatistics =
      time_statistics?.previous_time_statistics?.[testNumber] || null;

    const selectedTrafficGen = traffic_gen_list[testNumber] || null;

    setSelectedTest({
      statistics: selectedStatistics,
      timeStatistics: selectedTimeStatistics,
      trafficGen: selectedTrafficGen,
    });
  };

  return (
    <Loader loaded={loaded} overlay={overlay}>
      <form onSubmit={onSubmit}>
        <Row className={"mb-3"}>
          {running &&
            test_mode === TestMode.PROFILE &&
            selectedProfile === ProfileMode.RFC2544 &&
            currentProfileTest === "Reset - 64 Bytes" && (
              <Col className="col-12">
                <Alert variant={"primary"}>
                  Cause a Reset in the DUT in the next 120 Seconds
                </Alert>
              </Col>
            )}
          <SendReceiveMonitor stats={statistics} running={running} />
          <Col className={"text-end col-4"}>
            {running ? (
              <>
                <Button type={"submit"} className="mb-1" variant="danger">
                  <i className="bi bi-stop-fill" /> Stop
                </Button>{" "}
                <Button
                  onClick={() => restart(set_overlay)}
                  className="mb-1"
                  variant="primary"
                >
                  <i className="bi bi-arrow-clockwise" />{" "}
                  {translate("buttons.restart", currentLanguage)}{" "}
                </Button>
              </>
            ) : (
              <>
                <div style={{ display: "inline-block", position: "relative" }}>
                  <div>
                    <Button type={"submit"} className="mb-1" variant="primary">
                      <i className="bi bi-play-circle-fill" /> Start{" "}
                    </Button>{" "}
                    <Button
                      onClick={() => {
                        reset(set_overlay);
                      }}
                      className="mb-1"
                      variant="warning"
                    >
                      <i className="bi bi-trash-fill" />{" "}
                      {translate("buttons.reset", currentLanguage)}{" "}
                    </Button>{" "}
                  </div>
                  {shouldShowDownloadButton(
                    running,
                    time_statistics,
                    test_mode,
                    selectedProfile,
                    selectedRFC,
                    profileData
                  ) && (
                    <>
                      <HiddenGraphs
                        data={time_statistics}
                        stats={statistics}
                        traffic_gen_list={traffic_gen_list}
                        testMode={test_mode}
                        selectedProfile={selectedProfile}
                        selectedRFC={selectedRFC}
                        onConvert={handleGraphConvert}
                      />
                      <Download
                        data={time_statistics}
                        stats={statistics}
                        traffic_gen_list={traffic_gen_list}
                        test_mode={test_mode}
                        selectedProfile={selectedProfile}
                        selectedRFC={selectedRFC}
                        profileData={profileData}
                        graph_images={imageData}
                        currentLanguage={currentLanguage}
                      />
                    </>
                  )}
                </div>
              </>
            )}
          </Col>
        </Row>
      </form>
      <Row className="d-flex align-items-center">
        <Col className={"col-auto"}>
          <Form>
            <Form.Check // prettier-ignore
              type="switch"
              id="custom-switch"
              checked={visual}
              onClick={() => set_visual(!visual)}
              label={translate("visualization.visualization", currentLanguage)}
            />
          </Form>
        </Col>
        <TestInfoTooltip
          running={running}
          testMode={test_mode}
          currentTestNumber={currentTestNumber}
          totalTestsNumber={totalTestsNumber}
          currentTestDuration={currentTestDuration}
          currentProfileTest={currentProfileTest}
          profileMode={selectedProfile}
          currentLanguage={currentLanguage}
        />
      </Row>
      <RenderTabs
        test_mode={test_mode}
        selectedRFC={selectedRFC}
        statistics={statistics}
        time_statistics={time_statistics}
        traffic_gen_list={traffic_gen_list}
        currentTestNumber={currentTestNumber}
        visual={visual}
        ports={ports}
        handleSelectTest={handleSelectTest}
        selectedTest={selectedTest}
        currentLanguage={currentLanguage}
      />
      <GitHub />
    </Loader>
  );
};

export default Home;
