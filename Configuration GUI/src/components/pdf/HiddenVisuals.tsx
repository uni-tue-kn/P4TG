import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Statistics,
  TimeStatistics,
  TrafficGenList,
  TestMode,
  ChartRef,
  ProfileMode,
} from "../../common/Interfaces";

import { activePorts } from "../../common/utils/StatisticUtils";

import HiddenProfileCharts from "./Charts/HiddenProfileCharts";
import HiddenTestCharts from "./Charts/HiddenTestCharts";

const createRefArray = (length: number): ChartRef[] => {
  return Array.from({ length }, () => React.createRef<HTMLDivElement>());
};

const HiddenGraphs = ({
  data,
  stats,
  traffic_gen_list,
  testMode,
  selectedProfile,
  selectedRFC,
  onConvert,
}: {
  data: TimeStatistics;
  stats: Statistics;
  traffic_gen_list: TrafficGenList;
  testMode: TestMode;
  selectedProfile: ProfileMode;
  selectedRFC: number;
  onConvert: (data: string[]) => void;
}) => {
  // References for all tests
  const allRefs = useRef(
    Object.keys(traffic_gen_list).reduce((acc, testId) => {
      // Summary refs
      const refsSummary = createRefArray(6);

      // Active port refs
      const port_mapping = traffic_gen_list[testId as any].port_tx_rx_mapping;
      const activePortRefs = activePorts(port_mapping).reduce((acc, port) => {
        acc[port.tx] = createRefArray(6);
        return acc;
      }, {} as { [key: number]: ChartRef[] });

      acc[testId as any] = { refsSummary, activePortRefs };
      return acc;
    }, {} as { [key: number]: { refsSummary: ChartRef[]; activePortRefs: { [key: number]: ChartRef[] } } })
  );

  const [isChartRendered, setIsChartRendered] = useState(false);

  // Throughput, Packet Loss, Latency, Frame Loss, Reset
  const barChartRefs: [ChartRef, ChartRef, ChartRef, ChartRef, ChartRef] = [
    useRef(null),
    useRef(null),
    useRef(null),
    useRef(null),
    useRef(null),
  ];

  const download = useCallback(
    (refs: ChartRef[], isProfile: boolean = false) => {
      const data: string[] = [];

      if (isProfile) {
        refs.forEach((ref: any, index: number) => {
          const link = document.createElement("a");
          link.download = `bar-chart-${index + 1}.png`;
          console.log(ref);
          if (ref.current) {
            link.href = ref.current.toBase64Image();
            console.log("downloaded " + (index + 1) + "th bar-chart");
            // @ts-ignore
            data.push(ref.current.toBase64Image());
          } else {
            console.log(`Chart ${index + 1} is not downloaded`);
          }
        });
      } else {
        refs.forEach((ref: any, index: number) => {
          console.log("downloaded " + (index + 1) + "th chart");
          const link = document.createElement("a");
          link.download = `chart-${index + 1}.png`;
          console.log(ref);
          if (ref.current) {
            // @ts-ignore
            link.href = ref.current.toBase64Image();
            data.push(link.href);
          } else {
            console.error("Error in rendering" + (index + 1) + "th chart");
          }
        });
      }

      onConvert(data);
    },
    [onConvert]
  );

  const firstRenderRef = useRef(true);
  const firstProfileDownloadRef = useRef(true);

  useEffect(() => {
    if (firstRenderRef.current && selectedProfile !== ProfileMode.RFC2544) {
      firstRenderRef.current = false;
      const allTestRefs = Object.values(allRefs.current).reduce(
        (acc, { refsSummary, activePortRefs }) => {
          return acc.concat(
            ...refsSummary,
            ...Object.values(activePortRefs).flat()
          );
        },
        [] as ChartRef[]
      );

      download(allTestRefs);
    }
  }, [download, selectedProfile]);

  useEffect(() => {
    if (
      isChartRendered &&
      testMode === TestMode.PROFILE &&
      selectedProfile === ProfileMode.RFC2544 &&
      firstProfileDownloadRef.current
    ) {
      firstProfileDownloadRef.current = false;
      download(barChartRefs, true);
    }
  }, [isChartRendered, testMode, download, barChartRefs]);

  return (
    <>
      {testMode === TestMode.PROFILE &&
      selectedProfile === ProfileMode.RFC2544 &&
      traffic_gen_list[1] ? (
        <HiddenProfileCharts
          refs={barChartRefs}
          selectedRFC={selectedRFC}
          stats={stats}
          port_mapping={traffic_gen_list[1].port_tx_rx_mapping}
          onRenderComplete={() => setIsChartRendered(true)}
        />
      ) : (
        Object.keys(traffic_gen_list).map((testId) => {
          const { refsSummary, activePortRefs } =
            allRefs.current[parseInt(testId)];
          const port_mapping =
            traffic_gen_list[parseInt(testId)].port_tx_rx_mapping;

          const currentData =
            data.previous_time_statistics?.[parseInt(testId)] || data;
          const currentStats =
            stats.previous_statistics?.[parseInt(testId)] || stats;

          return (
            <div key={testId}>
              <HiddenTestCharts
                key={`summary-${testId}`}
                data={currentData}
                stats={currentStats}
                port_mapping={port_mapping}
                chartRefs={refsSummary}
              />
              {activePorts(port_mapping).map((v) => (
                <HiddenTestCharts
                  key={`port-${v.tx}`}
                  data={currentData}
                  stats={currentStats}
                  port_mapping={{ [v.tx]: v.rx }}
                  chartRefs={activePortRefs[v.tx]}
                />
              ))}
            </div>
          );
        })
      )}
    </>
  );
};

export default HiddenGraphs;
