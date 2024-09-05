// @ts-nocheck
export const generateDataCategories = (
  labels_tx,
  line_data_tx,
  labels_rx,
  line_data_rx,
  labels_rtt,
  line_data_rtt,
  labels_loss,
  line_data_loss,
  labels_out_of_order,
  line_data_out_of_order
) => {
  return [
    {
      title: "line data tx",
      labels: labels_tx,
      data: line_data_tx.map((val) => (val * 10 ** -9).toFixed(4)),
      unit: "data in GBit/s",
    },
    {
      title: "line data rx",
      labels: labels_rx,
      data: line_data_rx.map((val) => (val * 10 ** -9).toFixed(4)),
      unit: "data in GBit/s",
    },
    {
      title: "rtt",
      labels: labels_rtt,
      data: line_data_rtt,
      unit: "rtt in μs",
    },
    {
      title: "packet loss",
      labels: labels_loss,
      data: line_data_loss,
      unit: "lost packets",
    },
    {
      title: "out of order packets",
      labels: labels_out_of_order,
      data: line_data_out_of_order,
      unit: "out of order packets",
    },
  ];
};
