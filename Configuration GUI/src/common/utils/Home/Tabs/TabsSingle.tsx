import React from "react";
import { Tabs, Tab } from "react-bootstrap";
import {
  Statistics,
  TimeStatistics,
  TrafficGenList,
  Port,
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

interface TabsSingleProps {
  statistics: Statistics;
  time_statistics: TimeStatistics;
  traffic_gen_list: TrafficGenList;
  currentTestNumber: number;
  visual: boolean;
  currentLanguage: string;
  ports: Port[];
}

const TabsSingle: React.FC<TabsSingleProps> = ({
  statistics,
  time_statistics,
  traffic_gen_list,
  currentTestNumber,
  visual,
  currentLanguage,
  ports,
}) => {
  return (
    <Tabs defaultActiveKey="Summary" className="mt-3">
      <Tab
        eventKey="Summary"
        title={translate("visualization.summary", currentLanguage)}
      >
        <StatView
          stats={statistics}
          time_stats={time_statistics}
          port_mapping={
            traffic_gen_list[currentTestNumber]?.port_tx_rx_mapping || {}
          }
          visual={visual}
          mode={traffic_gen_list[currentTestNumber]?.mode || 0}
        />
      </Tab>
      {activePorts(
        traffic_gen_list[currentTestNumber]?.port_tx_rx_mapping || {}
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
              <Tab
                eventKey={"Overview"}
                title={translate("visualization.overview", currentLanguage)}
              >
                <StatView
                  stats={statistics}
                  time_stats={time_statistics}
                  port_mapping={mapping}
                  mode={traffic_gen_list[currentTestNumber]?.mode || 0}
                  visual={visual}
                />
              </Tab>
              {Object.keys(mapping)
                .map(Number)
                .map((v) => {
                  let stream_ids = getStreamIDsByPort(
                    v,
                    traffic_gen_list[currentTestNumber]?.stream_settings || [],
                    traffic_gen_list[currentTestNumber]?.streams || []
                  );
                  return stream_ids.map((stream: number, i) => {
                    let stream_frame_size = getStreamFrameSize(
                      traffic_gen_list[currentTestNumber]?.streams || [],
                      stream
                    );
                    return (
                      <Tab key={i} eventKey={stream} title={"Stream " + stream}>
                        <StreamView
                          stats={statistics}
                          port_mapping={mapping}
                          stream_id={stream}
                          frame_size={stream_frame_size}
                          currentLanguage={currentLanguage}
                        />
                      </Tab>
                    );
                  });
                })}
            </Tabs>
          </Tab>
        );
      })}
    </Tabs>
  );
};

export default TabsSingle;
