import { useEffect, useState, forwardRef, useImperativeHandle } from "react";
import { Line, Bar } from "react-chartjs-2";
import { Chart, registerables } from "chart.js";

import { get } from "../../../common/API";
import { Statistics } from "../../../common/Interfaces";

Chart.register(...registerables);

interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor?: string;
    borderColor?: string;
    barThickness?: number;
    fill?: boolean;
    yAxisID?: string;
  }[];
}

interface ProfileData {
  throughput: { [key: string]: number };
  latency: { [key: string]: number };
  packet_loss: { [key: string]: number };
  frame_loss_rate: { [key: string]: { [key: string]: number } };
  reset: { [key: string]: number };
}

interface BarChartProps {
  refs: React.MutableRefObject<any>[];
  selectedRFC: number;
  onRenderComplete: () => void;
  stats: Statistics;
  port_mapping: { [name: number]: number };
}

const fetchChartData = async (
  setThroughputData: (data: ChartData | null) => void,
  setLatencyData: (data: ChartData | null) => void,
  setFrameLossRateData: (data: ChartData | null) => void,
  setResetData: (data: ChartData | null) => void,
  setPacketLossData: (data: ChartData | null) => void,
  total_rx: number
) => {
  try {
    const response = await get({ route: "/profiles" });
    if (response && response.status === 200) {
      const data = response.data;
      setThroughputData(generateThroughputData(data));
      setLatencyData(generateLatencyData(data));
      setFrameLossRateData(generateFrameLossRateData(data));
      setResetData(generateResetData(data));
    }

    const statsResponse = await get({ route: "/statistics" });
    if (statsResponse && statsResponse.status === 200) {
      const statsData = statsResponse.data;
      setPacketLossData(generatePacketLossData(statsData, total_rx));
    }
  } catch (error) {
    console.error("Error fetching data:", error);
  }
};

const generateChartData = (
  data: { [key: string]: number } | undefined,
  label: string,
  backgroundColor: string,
  isLineChart: boolean = false
): ChartData | null => {
  if (!data || Object.keys(data).length === 0) {
    return null;
  }

  return {
    labels: Object.keys(data),
    datasets: [
      {
        label: label,
        data: Object.values(data).map((value) => Number(value.toFixed(3))),
        backgroundColor: isLineChart ? undefined : backgroundColor,
        borderColor: isLineChart ? backgroundColor : undefined,
        barThickness: isLineChart ? undefined : 50,
        fill: isLineChart ? false : undefined,
        // @ts-ignore
        pointBorderColor: isLineChart ? "#C70039" : undefined,
      },
    ],
  };
};

const createChartOptions = (
  yAxisTitle: string,
  tooltipCallback?: (value: any) => string,
  xAxisTitle?: string
) => {
  return {
    ...commonChartOptions,
    scales: {
      ...commonChartOptions.scales,
      x: {
        ...commonChartOptions.scales.x,
        title: {
          ...commonChartOptions.scales.x.title,
          text: xAxisTitle || commonChartOptions.scales.x.title.text,
        },
      },
      y: {
        ...commonChartOptions.scales.y,
        title: {
          ...commonChartOptions.scales.y.title,
          text: yAxisTitle,
        },
      },
    },
    plugins: {
      ...commonChartOptions.plugins,
      tooltip: {
        callbacks: {
          label: tooltipCallback
            ? tooltipCallback
            : (context: any) => context.raw,
        },
      },
    },
    elements: {
      point: {
        pointStyle: "crossRot",
        radius: 8,
        borderWidth: 2,
      },
      line: {
        borderWidth: 2,
      },
    },
  };
};

const checkRenderComplete = (
  refs: React.MutableRefObject<any>[],
  onRenderComplete: () => void,
  data: any,
  selectedRFC: number
) => {
  const chartsRendered = {
    all: refs.every((ref) => ref.current),
    throughputAndPacketLoss: refs[0].current && refs[1].current,
    latency: refs[2].current,
    frameLossRate: refs[3].current,
    reset: refs[4].current,
  };

  const dataAvailable = {
    all:
      data.throughput &&
      data.packet_loss &&
      data.latency &&
      data.frame_loss_rate &&
      data.reset,
    throughputAndPacketLoss: data.throughput && data.packet_loss,
    latency: data.latency,
    frameLossRate: data.frame_loss_rate,
    reset: data.reset,
  };

  const conditions = [
    { rfc: 0, dataCheck: dataAvailable.all, renderCheck: chartsRendered.all },
    {
      rfc: 1,
      dataCheck: dataAvailable.throughputAndPacketLoss,
      renderCheck: chartsRendered.throughputAndPacketLoss,
    },
    {
      rfc: 2,
      dataCheck: dataAvailable.latency,
      renderCheck: chartsRendered.latency,
    },
    {
      rfc: 3,
      dataCheck: dataAvailable.frameLossRate,
      renderCheck: chartsRendered.frameLossRate,
    },
    {
      rfc: 4,
      dataCheck: dataAvailable.reset,
      renderCheck: chartsRendered.reset,
    },
  ];

  const conditionMet = conditions.find(
    (condition) =>
      condition.rfc === selectedRFC &&
      condition.dataCheck &&
      condition.renderCheck
  );

  if (conditionMet) {
    onRenderComplete();
  }
};

const calculateTotalReceivedPackets = (
  stats: Statistics,
  port_mapping: { [name: number]: number }
): number => {
  let totalReceived = 0;

  Object.keys(stats.frame_size).forEach((v) => {
    if (Object.values(port_mapping).map(Number).includes(parseInt(v))) {
      stats.frame_size[v]["rx"].forEach((f) => {
        totalReceived += f.packets;
      });
    }
  });

  return totalReceived;
};

// Chart data

const generateThroughputData = (data: ProfileData): ChartData | null => {
  return generateChartData(
    data.throughput,
    "Throughput",
    "rgba(0, 0, 255, 0.6)",
    true
  );
};

const generateLatencyData = (data: ProfileData): ChartData | null => {
  return generateChartData(
    data.latency,
    "Latency",
    "rgba(0, 255, 0, 0.6)",
    true
  );
};

const generateFrameLossRateData = (data: ProfileData): ChartData | null => {
  if (!data.frame_loss_rate) {
    return null;
  }

  const labels = Object.keys(data.frame_loss_rate["64"]);
  const datasets = Object.keys(data.frame_loss_rate).map((frameSize) => {
    return {
      label: `${frameSize} Bytes`,
      data: Object.values(data.frame_loss_rate[frameSize]).map((value) =>
        Number(value.toFixed(3))
      ),
      borderColor: getColorForFrameSize(frameSize),
      fill: false,
    };
  });

  return {
    labels,
    datasets,
  };
};

const generateResetData = (data: ProfileData): ChartData | null => {
  return generateChartData(data.reset, "Reset", "rgba(153, 102, 255, 0.6)");
};

const generatePacketLossData = (
  data: Statistics,
  total_rx: number
): ChartData => {
  const frameSizes = ["64", "128", "512", "1024", "1518"];

  const packetLossData = frameSizes.map((_, index: number) => {
    let totalPacketLoss = 0;
    const statIndex = index + 1; // Map index to 1-based index for statistics
    if (
      data.previous_statistics &&
      data.previous_statistics[statIndex] &&
      data.previous_statistics[statIndex].packet_loss
    ) {
      for (let key in data.previous_statistics[statIndex].packet_loss) {
        totalPacketLoss +=
          data.previous_statistics[statIndex].packet_loss[key] || 0;
      }
    }
    return totalPacketLoss;
  });

  const totalPackets =
    packetLossData.reduce((acc, val) => acc + val, 0) + total_rx;
  const packetLossPercentageData = packetLossData.map(
    (value) => (value / totalPackets) * 100
  );

  return {
    labels: frameSizes,
    datasets: [
      {
        label: "Packet Loss (%)",
        data: packetLossPercentageData.map((value) => Number(value.toFixed(3))),
        backgroundColor: "rgba(62, 255, 236, 0.631)",
        barThickness: 50,
        yAxisID: "y",
      },
    ],
  };
};

// Chart options

const commonChartOptions = {
  responsive: true,
  plugins: {
    legend: {
      display: true,
      position: "top" as const,
      labels: {
        color: "black",
        font: {
          size: 20, // Increase the font size for the legend labels
        },
      },
    },
    datalabels: {
      display: true,
      align: "end",
      anchor: "end",
      color: "black",
    },
  },
  scales: {
    x: {
      title: {
        display: true,
        text: "Frame Size (Bytes)",
        color: "black",
        font: {
          size: 20, // Increase the font size for the x-axis title
        },
      },
      ticks: {
        color: "black",
        font: {
          size: 18, // Increase the font size for the x-axis ticks
        },
      },
      barPercentage: 0.8, // Ensure consistent bar percentage
      categoryPercentage: 0.8, // Ensure consistent category percentage
    },
    y: {
      title: {
        display: true,
        text: "Throughput (Gbps)",
        color: "black",
        font: {
          size: 20, // Increase the font size for the y-axis title
        },
      },
      ticks: {
        color: "black",
        font: {
          size: 18, // Increase the font size for the y-axis ticks
        },
      },
    },
  },
  animation: {
    duration: 0,
  },
};

const createThroughputChartOptions = () => {
  const baseOptions = createChartOptions("Throughput (Frames per Second)");

  return {
    ...baseOptions,
    scales: {
      x: {
        type: "linear",
        title: {
          display: true,
          text: "Frame Size (Bytes)",
          color: "black",
          font: {
            size: 20,
          },
        },
        ticks: {
          callback: function (value: any) {
            return Number(value).toFixed(0);
          },
          font: {
            size: 20,
          },
          color: "black",
        },
      },
      y: {
        ...baseOptions.scales.y,
        ticks: {
          ...baseOptions.scales.y.ticks,
          callback: function (value: any) {
            return Number(value).toExponential();
          },
        },
      },
    },
    elements: {
      point: {
        pointStyle: "crossRot",
        radius: 8,
        borderWidth: 2,
      },
      line: {
        borderWidth: 2,
      },
    },
  };
};

const packetLossChartOptions = createChartOptions(
  "Packet Loss (%)",
  (value: any) => value.toFixed(4) + "%"
);

const latencyChartOptions = createChartOptions("Latency (μs)");

const frameLossRateChartOptions = createChartOptions(
  "Frame Loss Rate (%)",
  undefined,
  "Bandwidth (%)"
);

const resetChartOptions = createChartOptions("Seconds");

const throughputChartOptions = createThroughputChartOptions();

// Chart components

const ThroughputChart = forwardRef<any, { data: ChartData | null }>(
  ({ data }, ref) => {
    return data ? (
      // @ts-ignore
      <Line data={data} options={throughputChartOptions} ref={ref} />
    ) : null;
  }
);

const PacketLossChart = forwardRef<any, { data: ChartData | null }>(
  ({ data }, ref) => {
    return data ? (
      <Bar data={data} options={packetLossChartOptions} ref={ref} />
    ) : null;
  }
);

const LatencyChart = forwardRef<any, { data: ChartData | null }>(
  ({ data }, ref) => {
    // @ts-ignore
    latencyChartOptions.scales.x.type = "linear";
    return data ? (
      <Line data={data} options={latencyChartOptions} ref={ref} />
    ) : null;
  }
);

const FrameLossRateChart = forwardRef<any, { data: ChartData | null }>(
  ({ data }, ref) => {
    // @ts-ignore
    frameLossRateChartOptions.scales.x.min = 0;
    // @ts-ignore
    frameLossRateChartOptions.scales.y.min = 0;
    return data ? (
      <Line data={data} options={frameLossRateChartOptions} ref={ref} />
    ) : null;
  }
);

const ResetChart = forwardRef<any, { data: ChartData | null }>(
  ({ data }, ref) => {
    return data ? (
      <Bar data={data} options={resetChartOptions} ref={ref} />
    ) : null;
  }
);

// Main BarChart component

const HiddenProfileCharts = forwardRef(
  (
    { refs, selectedRFC, onRenderComplete, stats, port_mapping }: BarChartProps,
    ref
  ) => {
    const [throughput, setThroughput] = useState<ChartData | null>(null);
    const [packet_loss, setPacketLoss] = useState<ChartData | null>(null);
    const [latency, setLatency] = useState<ChartData | null>(null);
    const [frame_loss_rate, setFrameLossRate] = useState<ChartData | null>(
      null
    );

    const [reset, setReset] = useState<ChartData | null>(null);

    useEffect(() => {
      const total_rx = calculateTotalReceivedPackets(stats, port_mapping);
      fetchChartData(
        setThroughput,
        setLatency,
        setFrameLossRate,
        setReset,
        setPacketLoss,
        total_rx
      );
    }, [stats, port_mapping]);

    useImperativeHandle(ref, () => ({
      throughputChartRef: refs[0],
      packetLossChartRef: refs[1],
      latencyChartRef: refs[2],
      frameLossRateChartRef: refs[3],
      resetChartRef: refs[4],
    }));

    useEffect(() => {
      const data = {
        throughput,
        packet_loss,
        latency,
        frame_loss_rate,
        reset,
      };
      checkRenderComplete(refs, onRenderComplete, data, selectedRFC);
    }, [
      throughput,
      packet_loss,
      latency,
      frame_loss_rate,
      reset,
      refs,
      onRenderComplete,
      selectedRFC,
    ]);

    return (
      <div className="hidden-div">
        {(selectedRFC === 0 || selectedRFC === 1) && (
          <ThroughputChart data={throughput} ref={refs[0]} />
        )}
        {(selectedRFC === 0 || selectedRFC === 1) && (
          <PacketLossChart data={packet_loss} ref={refs[1]} />
        )}
        {(selectedRFC === 0 || selectedRFC === 2) && (
          <LatencyChart data={latency} ref={refs[2]} />
        )}
        {(selectedRFC === 0 || selectedRFC === 3) && (
          <FrameLossRateChart data={frame_loss_rate} ref={refs[3]} />
        )}
        {(selectedRFC === 0 || selectedRFC === 4) && (
          <ResetChart data={reset} ref={refs[4]} />
        )}
      </div>
    );
  }
);

export default HiddenProfileCharts;

// Helper function to get color for different frame sizes
const getColorForFrameSize = (frameSize: string): string => {
  const colors: { [key: string]: string } = {
    "64": "rgba(255, 99, 132)",
    "128": "rgba(54, 162, 235)",
    "512": "rgba(75, 192, 192)",
    "1024": "rgba(153, 102, 255)",
    "1518": "rgba(255, 159, 64)",
  };

  return colors[frameSize] || "rgba(0, 0, 0)";
};
