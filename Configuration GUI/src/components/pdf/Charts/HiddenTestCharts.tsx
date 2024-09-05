import { Doughnut, Line } from "react-chartjs-2";
import { Statistics, TimeStatistics } from "../../../common/Interfaces";

import {
  get_loss_options,
  get_frame_size_data,
  get_rtt_data,
  get_loss_data,
  get_rate_data,
  get_frame_type_data,
  get_ethernet_type_data,
  get_rate_options,
  get_rtt_options,
  get_frame_options,
} from "../../../common/utils/VisualUtils";

const HiddenTestCharts = ({
  data,
  stats,
  port_mapping,
  chartRefs,
}: {
  data: TimeStatistics;
  stats: Statistics;
  port_mapping: { [name: number]: number };
  chartRefs: any[];
}) => {
  const [
    rateChartRef,
    lossChartRef,
    rttChartRef,
    frameTypeChartRef,
    ethernetTypeChartRef,
    frameSizeChartRef,
  ] = chartRefs;

  // Resolution of Graphs
  const devicePixelRatio = 1;

  const loss_options = get_loss_options("light");

  const loss_options_hidden = {
    ...loss_options,
    aspectRatio: 5,
    animation: {
      duration: 0,
    },
    devicePixelRatio,
  };

  const loss_data = get_loss_data(data, port_mapping);

  const rate_data = get_rate_data(data, port_mapping);

  const rate_options = get_rate_options("light");

  const rate_options_hidden = {
    ...rate_options,
    aspectRatio: 5,
    animation: {
      duration: 0,
    },
    devicePixelRatio,
  };

  const rtt_options = get_rtt_options("light");

  const rtt_options_hidden = {
    ...rtt_options,
    aspectRatio: 5,
    animation: {
      duration: 0,
    },
    devicePixelRatio,
  };

  const rtt_data = get_rtt_data(data, port_mapping);

  const frame_options = get_frame_options("light");

  const frame_options_hidden = {
    ...frame_options,
    aspectRatio: 5,
    devicePixelRatio,
  };

  const frame_type_data = get_frame_type_data(stats, port_mapping);

  const ethernet_type_data = get_ethernet_type_data(stats, port_mapping);

  const frame_size_data = get_frame_size_data(stats, port_mapping);

  return (
    <div className="hidden-div">
      <Line options={rate_options_hidden} data={rate_data} ref={rateChartRef} />
      <Line options={loss_options_hidden} data={loss_data} ref={lossChartRef} />
      <Line data={rtt_data} options={rtt_options_hidden} ref={rttChartRef} />
      <Doughnut
        data={frame_type_data}
        options={frame_options_hidden}
        title={"Frame types"}
        ref={frameTypeChartRef}
      />
      <Doughnut
        data={ethernet_type_data}
        options={frame_options_hidden}
        ref={ethernetTypeChartRef}
      />
      <Doughnut
        data={frame_size_data}
        options={frame_options_hidden}
        ref={frameSizeChartRef}
      />
    </div>
  );
};

export default HiddenTestCharts;
