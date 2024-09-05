import {
  Statistics,
  TrafficGenList,
  Port,
  RFCTestResults,
} from "../../Interfaces";
import { activePorts } from "../StatisticUtils";

import { jsPDF } from "jspdf";
import translate from "../../../components/translation/Translate";
import {
  getPortAndChannelFromPid,
  createSummaryPage,
  createSummaryPages,
  addHeadersAndFooters,
  addSubHeaders,
  addGraphsAndTables,
} from "./helper";
import {
  createAutoTableConfig,
  formatActivePortsRows,
  formatActiveStreamRows,
  formatPortStreamCols,
  formatPortStreamRows,
} from "./tables";

import autoTable from "jspdf-autotable";
import { modes, FONT } from "./constants";

export const createPdf = (
  testList: TrafficGenList,
  stats: Statistics,
  graph_images: { Summary: string[]; [key: string]: string[] },
  testNumber: number,
  subHeadersMap: any,
  ports: Port[],
  currentLanguage: string
) => {
  const translatedText = (key: string) => translate(key, currentLanguage);

  const current_test = testList[testNumber];

  const test_name = current_test.name || `Test ${testNumber}`;

  const { mode, stream_settings, streams, port_tx_rx_mapping } = current_test;

  const current_statistics = stats.previous_statistics?.[testNumber] || stats;

  const elapsed_time =
    current_test?.duration || current_statistics.elapsed_time;

  const doc = new jsPDF("p", "mm", [297, 210]);
  doc.setFont(FONT, "normal");

  const subHeaders: string[] = [
    `${translatedText("pdf.streamConfig")} ${
      modes[mode as any]
    } ${translatedText("other.mode")}`,
    `${translatedText("visualization.summary")}`,
    `${translatedText("pdf.networkGraphsSummary")}`,
  ];

  activePorts(port_tx_rx_mapping).forEach((v) => {
    subHeaders.push(
      `${translatedText("visualization.overview")} ${v.tx} (${
        getPortAndChannelFromPid(v.tx, ports).port
      }) --> ${v.rx} (${getPortAndChannelFromPid(v.rx, ports).port})`,
      `${translatedText("pdf.networkGraphs")} ${v.tx} (${
        getPortAndChannelFromPid(v.tx, ports).port
      }) --> ${v.rx} (${getPortAndChannelFromPid(v.rx, ports).port})`
    );
  });

  subHeadersMap.current[testNumber] = subHeaders;

  /* Stream Configuration */

  // Active Ports Table

  const activePortsRows = formatActivePortsRows(port_tx_rx_mapping, ports);
  const activePortsCols = [
    "Port TX",
    translatedText("pdf.channel") + " TX",
    "PID TX",
    "Port RX",
    translatedText("pdf.channel") + " RX",
    "PID RX",
  ];

  autoTable(
    doc,
    createAutoTableConfig(
      doc,
      activePortsCols,
      activePortsRows,
      {
        0: { cellWidth: 30 },
        1: { cellWidth: 30 },
        2: { cellWidth: 30 },
        3: { cellWidth: 30 },
        4: { cellWidth: 30 },
      },
      [0, 1, 2, 3, 4, 5],
      {
        styles: {
          halign: "center",
        },
        startY: 35,
      }
    )
  );

  // Active Stream Table

  const activeStreamRows = formatActiveStreamRows(streams);

  const activeStreamCols = [
    "Stream ID",
    translatedText("statistics.frameSize"),
    translatedText("statistics.rate"),
    translatedText("other.mode"),
    "VxLan",
    translatedText("statistics.encapsulation"),
    translatedText("other.options"),
  ];

  autoTable(
    doc,
    createAutoTableConfig(
      doc,
      activeStreamCols,
      activeStreamRows,
      {
        0: { cellWidth: 25 },
        1: { cellWidth: 25 },
        2: { cellWidth: 25 },
        3: { cellWidth: 25 },
        4: { cellWidth: 25 },
        5: { cellWidth: 35 },
      },
      [0, 1, 2, 3, 4, 5, 6],
      {
        styles: {
          halign: "center",
        },
      }
    )
  );

  // Port stream activation Table

  const portStreamCols = formatPortStreamCols(streams);

  const portStreamRows = formatPortStreamRows(
    port_tx_rx_mapping,
    ports,
    stream_settings,
    streams,
    portStreamCols
  );

  autoTable(
    doc,
    createAutoTableConfig(
      doc,
      portStreamCols,
      portStreamRows,
      { 0: { cellWidth: 25 }, 1: { cellWidth: 25 } },
      [0, 1, 2, 3, 4, 5, 6, 7, 8],
      {
        styles: {
          halign: "center",
        },
      }
    )
  );

  doc.addPage();

  /* Summary Table */
  createSummaryPage(
    doc,
    current_statistics,
    port_tx_rx_mapping,
    currentLanguage
  );

  doc.addPage();

  /* Network Graphs Summary */

  graph_images.Summary.forEach((imageData, index) => {
    doc.addImage(imageData, "JPEG", 15, 35 + 40 * index, 180, 36, "", "FAST");
  });

  doc.addPage();

  /* Active ports report */

  activePorts(port_tx_rx_mapping).map((v, i, array) => {
    let mapping: { [name: number]: number } = { [v.tx]: v.rx };

    createSummaryPage(doc, current_statistics, mapping, currentLanguage);

    doc.addPage();

    graph_images[v.tx]?.forEach((imageData, index) => {
      doc.addImage(imageData, "JPEG", 15, 35 + 40 * index, 180, 36, "", "FAST");
    });

    // Don't add a new page if it's the last page
    if (i < array.length - 1) {
      doc.addPage();
    }
  });

  /* Add header and footer to every page */
  addHeadersAndFooters(doc, elapsed_time, test_name, currentLanguage);
  addSubHeaders(doc, subHeaders);

  return doc.output("arraybuffer");
};

export const createProfilePdf = (
  testList: TrafficGenList,
  stats: Statistics,
  rfc_results: RFCTestResults,
  selectedRFC: number,
  graph_images: { Summary: string[]; [key: string]: string[] },
  currentLanguage: string
) => {
  const doc = new jsPDF("p", "mm", [297, 210]);
  doc.setFont(FONT, "normal");

  const pageSize = 5;
  const totalTests = Object.keys(testList).length;

  // Mapping selectedRFC to graph array
  const rfcGraphMap: {
    [key: number]: ("throughput" | "latency" | "frame_loss_rate" | "reset")[];
  } = {
    0: ["throughput", "latency", "frame_loss_rate", "reset"],
    1: ["throughput"],
    2: ["latency"],
    3: ["frame_loss_rate"],
    4: ["reset"],
  };

  const graphArray = rfcGraphMap[selectedRFC] || [];

  for (let i = 0; i < totalTests; i += pageSize) {
    // Create summary pages for current batch
    createSummaryPages(
      doc,
      testList,
      stats,
      currentLanguage,
      i,
      Math.min(i + pageSize, totalTests)
    );
    doc.addPage();

    // Determine graph type based on current index
    const graphIndex = (i / pageSize) % graphArray.length;
    const graphType = graphArray[graphIndex];

    // Add graphs and tables if graphType exists
    if (graphType) {
      addGraphsAndTables(
        doc,
        graph_images,
        rfc_results,
        graphType,
        currentLanguage
      );
    }

    // Add new page unless it's the last batch
    if (i + pageSize < totalTests) {
      doc.addPage();
    }
  }

  return doc.output("arraybuffer");
};
