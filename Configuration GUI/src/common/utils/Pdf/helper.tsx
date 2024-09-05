import {
  Port,
  Statistics,
  TrafficGenList,
  RFCTestResults,
} from "../../Interfaces";
import { jsPDF } from "jspdf";
import {
  FOOTER_TEXT,
  FONT_SIZE_SMALL,
  FONT_SIZE_NORMAL,
  FONT_SIZE_HEADER,
  FOOTER_URL,
  FONT,
  frameSizesMap as frameSizes,
  frameStatsRTTCols,
  frameTypes,
} from "./constants";
import {
  formatFrameCount,
  secondsToTime,
  calculateStatistics,
} from "../StatisticUtils";
import autoTable from "jspdf-autotable";
import translate from "../../../components/translation/Translate";
import { PDFDocument } from "pdf-lib";

import {
  createAutoTableConfig,
  createRfcTable,
  frameEthernetRow,
  frameSizeCountRow,
  formatFrameStatsRTTRows,
} from "./tables";

export const getPortAndChannelFromPid = (
  pid: number | string,
  ports: Port[]
) => {
  const numericPid = typeof pid === "string" ? parseInt(pid) : pid;
  const pidData = ports.find((p) => p.pid === numericPid);
  return pidData
    ? { port: pidData.port, channel: pidData.channel }
    : { port: "N/A", channel: "N/A" };
};

export const generateStreamStatusArray = (
  indices: number[],
  arraySize: number
): string[] =>
  Array.from({ length: arraySize }, (_, i) =>
    indices.includes(i + 1) ? "on" : "off"
  );

export const createSummaryPage = (
  doc: jsPDF,
  current_statistics: Statistics,
  port_tx_rx_mapping: { [name: number]: number },
  currentLanguage: string
) => {
  const translatedText = (key: string) => translate(key, currentLanguage);

  const {
    total_tx,
    total_rx,
    rtt,
    iat_tx,
    iat_rx,
    lost_packets,
    out_of_order_packets,
  } = calculateStatistics(current_statistics, port_tx_rx_mapping);

  // Packet statistics summary and RTT
  const frameStatsRTTRows = formatFrameStatsRTTRows({
    lost_packets,
    total_rx,
    out_of_order_packets,
    iat_tx,
    iat_rx,
    rtt,
    currentLanguage,
  });

  autoTable(
    doc,
    createAutoTableConfig(
      doc,
      frameStatsRTTCols,
      frameStatsRTTRows,
      {
        0: { cellWidth: 40 },
        1: { cellWidth: 20 },
        2: { cellWidth: 40 },
        3: { cellWidth: 30 },
      },
      [0, 1, 3, 4],
      {
        startY: 35,
      },
      true
    )
  );

  // Frame and Ethernet Type Table
  const frameEthernetRows = frameTypes.map((type) =>
    frameEthernetRow(
      current_statistics,
      port_tx_rx_mapping,
      type.label1 as string,
      type.label2 as string,
      total_tx,
      total_rx
    )
  );
  const frameEthernetCols = [
    translatedText("statistics.frameType"),
    "#TX Count",
    "#RX Count",
    "",
    translatedText("statistics.ethernetType"),
    "#TX Count",
    "#RX Count",
  ];

  autoTable(
    doc,
    createAutoTableConfig(
      doc,
      frameEthernetCols,
      frameEthernetRows,
      {
        0: { cellWidth: 30 },
        1: { cellWidth: 30 },
        2: { cellWidth: 30 },
        3: { cellWidth: 10 },
        4: { cellWidth: 30 },
        5: { cellWidth: 25 },
      },
      [0, 1, 2, 4, 5, 6]
    )
  );

  // Frame Size Count Table
  const frameSizeCountRows = [
    ...frameSizes.map(([label, low, high]) =>
      label !== "Total"
        ? frameSizeCountRow(
            current_statistics,
            port_tx_rx_mapping,
            label as string,
            low as number,
            high as number,
            total_tx,
            total_rx
          )
        : [
            "Total",
            formatFrameCount(total_tx),
            "",
            "",
            "Total",
            formatFrameCount(total_rx),
            "",
          ]
    ),
  ];

  const frameSizeCountCols = [
    translatedText("statistics.frameSize"),
    "#TX Count",
    translatedText("statistics.percentage"),
    "",
    translatedText("statistics.frameSize"),
    "#RX Count",
    translatedText("statistics.percentage"),
  ];

  autoTable(
    doc,
    createAutoTableConfig(
      doc,
      frameSizeCountCols,
      frameSizeCountRows,
      {
        0: { cellWidth: 30 },
        1: { cellWidth: 30 },
        2: { cellWidth: 30 },
        3: { cellWidth: 10 },
        4: { cellWidth: 30 },
        5: { cellWidth: 25 },
      },
      [0, 1, 2, 4, 5, 6]
    )
  );
};

export const addHeadersAndFooters = (
  doc: jsPDF,
  elapsed_time: number,
  testName: string,
  currentLanguage: string
) => {
  const translatedText = (key: string) => translate(key, currentLanguage);
  const totalPages = doc.getNumberOfPages();

  for (let index = 1; index <= totalPages; index++) {
    doc.setPage(index);
    doc.setFontSize(FONT_SIZE_SMALL);
    doc.setFont(FONT, "normal");
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Test duration and report generation time
    doc.text(
      translatedText("pdf.testDuration") + " " + secondsToTime(elapsed_time),
      pageWidth - 5,
      5,
      {
        align: "right",
      }
    );

    // Github Link
    doc.textWithLink(FOOTER_TEXT, pageWidth / 2, pageHeight - 5, {
      url: FOOTER_URL,
      align: "center",
    });

    // P4TG Network Report Header
    doc.setFontSize(FONT_SIZE_HEADER);
    doc.setFont(FONT, "bold");
    doc.text(translatedText("pdf.header") + testName, pageWidth / 2, 15, {
      align: "center",
    });
    doc.setFont(FONT, "normal");
  }
};

export const addSubHeaders = (doc: jsPDF, subHeaders: string[]) => {
  let currentPage = 1;

  // Add Subheaders to every page
  for (let i = 0; i < subHeaders.length; i++) {
    doc.setPage(currentPage);
    doc.setFontSize(FONT_SIZE_NORMAL);

    doc.text(subHeaders[i], 105, 25, { align: "center" });

    currentPage++;
  }
};

export const createSummaryPages = (
  doc: jsPDF,
  testList: TrafficGenList,
  stats: Statistics,
  currentLanguage: string,
  start: number,
  end: number
) => {
  const translatedText = (key: string) => translate(key, currentLanguage);
  const pageWidth = doc.internal.pageSize.getWidth();
  const keys = Object.keys(testList).slice(start, end);

  keys.forEach((key, index, array) => {
    const testNumber = Number(key);
    const current_test = testList[testNumber];
    const test_name = current_test.name || `Test ${testNumber}`;

    const { port_tx_rx_mapping } = current_test;

    const current_statistics = stats.previous_statistics?.[testNumber] || stats;

    // Create summary page for the current test
    createSummaryPage(
      doc,
      current_statistics,
      port_tx_rx_mapping,
      currentLanguage
    );

    // P4TG Network Report Header
    doc.setFontSize(FONT_SIZE_HEADER);
    doc.setFont(FONT, "bold");
    doc.text(translatedText("pdf.header") + test_name, pageWidth / 2, 15, {
      align: "center",
    });
    doc.setFont(FONT, "normal");

    doc.setFontSize(FONT_SIZE_NORMAL);

    doc.text(translatedText("visualization.summary"), pageWidth / 2, 25, {
      align: "center",
    });

    // Add new page unless it's the last test in this batch
    if (index < array.length - 1) {
      doc.addPage();
    }
  });
};

export const addGraphsAndTables = (
  doc: jsPDF,
  graph_images: { Summary: string[]; [key: string]: string[] },
  rfc_results: RFCTestResults,
  graphType: "throughput" | "latency" | "frame_loss_rate" | "reset",
  currentLanguage: string
) => {
  const translatedText = (key: string) => translate(key, currentLanguage);
  const pageWidth = doc.internal.pageSize.getWidth();
  const getDisplayName = (test_name: string) => {
    switch (test_name) {
      case "throughput":
        return translatedText("input.rfcMode.options.throughput");
      case "latency":
        return translatedText("input.rfcMode.options.latency");
      case "frame_loss_rate":
        return translatedText("input.rfcMode.options.frameLoss");
      case "reset":
        return translatedText("input.rfcMode.options.reset");
      default:
        return test_name;
    }
  };
  doc.setFontSize(FONT_SIZE_HEADER);
  doc.setFont(FONT, "bold");
  doc.text(
    `P4TG Network Report - ${getDisplayName(graphType)}`,
    pageWidth / 2,
    15,
    {
      align: "center",
    }
  );
  doc.setFont(FONT, "normal");

  doc.setFontSize(FONT_SIZE_NORMAL);
  doc.text(translatedText("pdf.testGraph"), pageWidth / 2, 25, {
    align: "center",
  });

  let yOffset = 35;

  if (graph_images[graphType]) {
    graph_images[graphType].forEach((imageData) => {
      doc.addImage(imageData, "JPEG", 15, yOffset, 180, 90, "", "FAST");
      yOffset += 100; // Adjust yOffset for the next image
    });
  }

  // If graphType is "throughput", add the packet_loss image below the throughput image
  if (graphType === "throughput" && graph_images["packet_loss"]) {
    graph_images["packet_loss"].forEach((imageData) => {
      doc.addImage(imageData, "JPEG", 11, yOffset, 180, 90, "", "FAST");
      yOffset += 100;
    });
  }

  createRfcTable(doc, rfc_results, graphType, yOffset, currentLanguage);
};

export const addDots = (
  doc: jsPDF,
  text: string,
  targetX: number,
  startX: number,
  buffer: number
) => {
  let textWidth = doc.getTextWidth(text);
  let dots = "";
  while (doc.getTextWidth(dots) < targetX - startX - textWidth - buffer * 2) {
    dots += ".";
  }
  return dots;
};

export const mergePdfs = async (pdfsToMerge: ArrayBuffer[]) => {
  const mergedPdf = await PDFDocument.create();

  for (const pdfBuffer of pdfsToMerge) {
    const pdf = await PDFDocument.load(pdfBuffer);
    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((page) => {
      mergedPdf.addPage(page);
    });
  }

  const mergedPdfFile = await mergedPdf.save();
  return mergedPdfFile;
};

export const addToCEntry = (
  doc: jsPDF,
  title: string,
  page: string,
  startX: number,
  targetX: number,
  yPosition: number,
  buffer: number,
  weight?: "bold" | "normal"
) => {
  doc.setFont(FONT, weight || "normal");
  doc.text(title, startX, yPosition);
  doc.setFont(FONT, "normal");

  const textWidth = doc.getTextWidth(title);
  const dots = addDots(doc, title, targetX, startX, buffer);
  doc.text(dots, startX + textWidth + buffer, yPosition);

  doc.setFont(FONT, "bold");
  doc.text(page, targetX + buffer, yPosition);
  doc.setFont(FONT, "normal");
};
