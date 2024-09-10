import React from "react";
import { Tabs, Tab } from "react-bootstrap";
import {
  TrafficGenList,
  TrafficGenData,
  RFCTestSelection,
  TestMode,
  Statistics,
  StatisticsObject,
  TimeStatistics,
  TimeStatisticsObject,
  Port,
  ProfileMode,
} from "../../../Interfaces";

import {
  activePorts,
  getStreamFrameSize,
  getStreamIDsByPort,
} from "../../StatisticUtils";

import { getPortAndChannelFromPid } from "../../Pdf/helper";

import StatView from "../../../../components/StatView";
import StreamView from "../../../../components/StreamView";
import translate from "../../../../components/translation/Translate";
import TabsProfile from "./TabsProfile";
import TabsSingle from "./TabsSingle";

interface RenderTabsProps {
  test_mode: number;
  selectedRFC: number;
  selectedProfile: ProfileMode;
  statistics: Statistics;
  time_statistics: TimeStatistics;
  traffic_gen_list: TrafficGenList;
  currentTestNumber: number;
  visual: boolean;
  currentLanguage: string;
  ports: Port[];
  handleSelectTest: (testNumber: number) => void;
  selectedTest: {
    statistics: Statistics | null;
    timeStatistics: TimeStatistics | null;
    trafficGen: TrafficGenData | null;
  };
}

const RenderTabs: React.FC<RenderTabsProps> = ({
  test_mode,
  selectedRFC,
  selectedProfile,
  statistics,
  time_statistics,
  traffic_gen_list,
  currentTestNumber,
  visual,
  currentLanguage,
  ports,
  handleSelectTest,
  selectedTest,
}) => {
  const categories = [
    { id: RFCTestSelection.THROUGHPUT, name: "Throughput" },
    { id: RFCTestSelection.LATENCY, name: "Latency" },
    { id: RFCTestSelection.FRAME_LOSS_RATE, name: "Frame Loss Rate" },
    { id: RFCTestSelection.RESET, name: "Reset" },
  ];

  const filteredCategories =
    selectedRFC === RFCTestSelection.ALL
      ? categories
      : categories.filter((category) => category.id === selectedRFC);

  const completedCategories = filteredCategories.filter((category) =>
    Object.keys(traffic_gen_list).some(
      (key) =>
        traffic_gen_list[key as any]?.name?.startsWith(category.name) &&
        statistics.previous_statistics?.[key as any]
    )
  );

  if (
    test_mode === TestMode.PROFILE &&
    selectedProfile === ProfileMode.RFC2544
  ) {
    return (
      <TabsProfile
        traffic_gen_list={traffic_gen_list}
        statistics={statistics}
        time_statistics={time_statistics}
        completedCategories={completedCategories}
        currentTestNumber={currentTestNumber}
        visual={visual}
        currentLanguage={currentLanguage}
      />
    );
  } else if (
    test_mode === TestMode.SINGLE ||
    (test_mode === TestMode.PROFILE && selectedProfile === ProfileMode.IMIX)
  ) {
    return (
      <TabsSingle
        statistics={statistics}
        time_statistics={time_statistics}
        traffic_gen_list={traffic_gen_list}
        currentTestNumber={currentTestNumber}
        currentLanguage={currentLanguage}
        visual={visual}
        ports={ports}
      />
    );
  } else {
    return (
      <Tabs
        defaultActiveKey="current"
        className="mt-3"
        onSelect={(eventKey) => handleSelectTest(Number(eventKey))}
      >
        <Tab
          eventKey="current"
          title={translate("visualization.currentTest", currentLanguage)}
        >
          <TabsSingle
            statistics={statistics}
            time_statistics={time_statistics}
            traffic_gen_list={traffic_gen_list}
            currentTestNumber={currentTestNumber}
            currentLanguage={currentLanguage}
            visual={visual}
            ports={ports}
          />
        </Tab>
        {Object.keys(statistics.previous_statistics || {}).map((key) => {
          const testTitle = traffic_gen_list[key as any]?.name || `Test ${key}`;
          return (
            <Tab key={Number(key)} eventKey={Number(key)} title={testTitle}>
              <Tabs defaultActiveKey="Summary" className="mt-3">
                <Tab
                  eventKey="Summary"
                  title={translate("visualization.summary", currentLanguage)}
                >
                  {selectedTest.statistics && selectedTest.timeStatistics && (
                    <>
                      <StatView
                        stats={
                          statistics.previous_statistics?.[Number(key)] ||
                          StatisticsObject
                        }
                        time_stats={
                          time_statistics.previous_time_statistics?.[
                          Number(key)
                          ] || TimeStatisticsObject
                        }
                        port_mapping={
                          selectedTest.trafficGen?.port_tx_rx_mapping || {}
                        }
                        mode={selectedTest.trafficGen?.mode || 0}
                        visual={visual}
                      />
                    </>
                  )}
                </Tab>
                {activePorts(
                  selectedTest.trafficGen?.port_tx_rx_mapping || {}
                ).map((v, i) => {
                  let mapping: { [name: number]: number } = { [v.tx]: v.rx };
                  return (
                    <Tab
                      eventKey={i}
                      key={i}
                      title={
                        v.tx +
                        ` (${getPortAndChannelFromPid(v.tx, ports).port}) ` +
                        "-> " +
                        v.rx +
                        ` (${getPortAndChannelFromPid(v.rx, ports).port}) `
                      }
                    >
                      <Tabs defaultActiveKey={"Overview"} className={"mt-3"}>
                        <Tab eventKey={"Overview"} title={"Overview"}>
                          {selectedTest.statistics &&
                            selectedTest.timeStatistics && (
                              <>
                                <StatView
                                  stats={
                                    statistics.previous_statistics?.[
                                    Number(key)
                                    ] || StatisticsObject
                                  }
                                  time_stats={
                                    time_statistics.previous_time_statistics?.[
                                    Number(key)
                                    ] || TimeStatisticsObject
                                  }
                                  port_mapping={mapping}
                                  mode={selectedTest.trafficGen?.mode || 0}
                                  visual={visual}
                                />
                              </>
                            )}
                        </Tab>
                        {Object.keys(mapping)
                          .map(Number)
                          .map((v) => {
                            let stream_ids = getStreamIDsByPort(
                              v,
                              selectedTest.trafficGen?.stream_settings || [],
                              selectedTest.trafficGen?.streams || []
                            );
                            return stream_ids.map((stream: number, i) => {
                              let stream_frame_size = getStreamFrameSize(
                                selectedTest.trafficGen?.streams || [],
                                stream
                              );
                              return (
                                <Tab
                                  key={i}
                                  eventKey={stream}
                                  title={"Stream " + stream}
                                >
                                  {selectedTest.statistics &&
                                    selectedTest.timeStatistics && (
                                      <>
                                        <StreamView
                                          stats={
                                            statistics.previous_statistics?.[
                                            Number(key)
                                            ] || StatisticsObject
                                          }
                                          port_mapping={mapping}
                                          stream_id={stream}
                                          frame_size={stream_frame_size}
                                          currentLanguage={currentLanguage}
                                        />
                                      </>
                                    )}
                                </Tab>
                              );
                            });
                          })}
                      </Tabs>
                    </Tab>
                  );
                })}
              </Tabs>
            </Tab>
          );
        })}
      </Tabs>
    );
  }
};

export default RenderTabs;
