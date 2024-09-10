import React from "react";
import { Tabs, Tab } from "react-bootstrap";
import {
  TrafficGenList,
  Statistics,
  TimeStatistics,
  StatisticsObject,
  TimeStatisticsObject,
} from "../../../Interfaces";
import StatView from "../../../../components/StatView";
import translate from "../../../../components/translation/Translate";

interface TabsProfileProps {
  traffic_gen_list: TrafficGenList;
  statistics: Statistics;
  time_statistics: TimeStatistics;
  completedCategories: { id: number; name: string }[];
  currentTestNumber: number;
  visual: boolean;
  currentLanguage: string;
}

const TabsProfile: React.FC<TabsProfileProps> = ({
  traffic_gen_list,
  statistics,
  time_statistics,
  completedCategories,
  currentTestNumber,
  visual,
  currentLanguage,
}) => {
  return (
    <Tabs defaultActiveKey="current" className="mt-3">
      <Tab
        eventKey="current"
        title={translate("visualization.currentTest", currentLanguage)}
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
      {completedCategories.map((category) => (
        <Tab
          key={category.name}
          eventKey={category.name}
          title={translate(
            `tabs.${category.name.toLowerCase()}`,
            currentLanguage
          )}
        >
          <Tabs className="mt-3">
            {Object.keys(traffic_gen_list)
              .filter(
                (key) =>
                  traffic_gen_list[key as any]?.name?.startsWith(
                    category.name
                  ) && statistics.previous_statistics?.[key as any]
              )
              .map((key) => (
                <Tab
                  key={key}
                  eventKey={key}
                  title={traffic_gen_list[key as any]?.name?.replace(
                    `${category.name} - `,
                    ""
                  )}
                >
                  <StatView
                    stats={
                      statistics.previous_statistics?.[key as any] ||
                      StatisticsObject
                    }
                    time_stats={
                      time_statistics.previous_time_statistics?.[key as any] ||
                      TimeStatisticsObject
                    }
                    port_mapping={
                      traffic_gen_list[key as any]?.port_tx_rx_mapping || {}
                    }
                    visual={visual}
                    mode={traffic_gen_list[key as any]?.mode || 0}
                  />
                </Tab>
              ))}
          </Tabs>
        </Tab>
      ))}
    </Tabs>
  );
};

export default TabsProfile;
