import { formatTime } from "../StatisticUtils";
import { TrafficGenList, RFCTestResults } from "../../Interfaces";
import { jsPDF } from "jspdf";
import translate from "../../../components/translation/Translate";
import { addToCEntry } from "./helper";
import {
  FOOTER_TEXT,
  FONT,
  FONT_SIZE_SMALL,
  FONT_SIZE_NORMAL,
  FONT_SIZE_HEADER,
  FOOTER_URL,
} from "./constants";

export const createToC = (
  doc: jsPDF,
  subHeadersMap: { [key: number]: string[] },
  testList: TrafficGenList,
  currentLanguage: string
) => {
  const translatedText = (key: string) => translate(key, currentLanguage);

  doc.setFont(FONT, "normal");
  doc.setFontSize(FONT_SIZE_NORMAL);

  const startX = 15;
  const buffer = 2;
  const targetX = 180 - buffer;
  let currentPage = 1;
  let yPosition = 40;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();

  const numberOfRows = Object.values(subHeadersMap).reduce(
    (sum, array) => sum + array.length,
    0
  );

  const addExtraPage = numberOfRows > 23 ? 1 : 0;

  addToCEntry(
    doc,
    translatedText("pdf.testExplanation"),
    `${translatedText("pdf.page")}${2 + addExtraPage}`,
    startX,
    targetX,
    yPosition,
    buffer
  );

  yPosition += 10;

  addToCEntry(
    doc,
    translatedText("pdf.termExplanation"),
    `${translatedText("pdf.page")}${3 + addExtraPage}`,
    startX,
    targetX,
    yPosition,
    buffer
  );

  yPosition += 10;

  Object.keys(subHeadersMap).forEach((testNumber, index) => {
    const testId = parseInt(testNumber);
    const testName = testList[testId].name || `Test ${testId}`;

    if (yPosition > 290) {
      yPosition = 40;
      doc.addPage();
    }

    doc.setFont(FONT, "bold");
    doc.text(testName, startX, yPosition);
    doc.setFont(FONT, "normal");
    yPosition += 10;

    const subHeaders = subHeadersMap[testNumber as any];
    subHeaders.forEach((header, subIndex) => {
      const pageNumberText = `${translatedText("pdf.page")}${
        currentPage + subIndex + addExtraPage + 3
      }`;

      addToCEntry(
        doc,
        header,
        pageNumberText,
        startX,
        targetX,
        yPosition,
        buffer
      );

      yPosition += 10;
      if (yPosition > 300) {
        yPosition = 40;
        doc.addPage();
        currentPage += subIndex + 1;
      }
    });

    doc.setFontSize(FONT_SIZE_HEADER);
    doc.setFont(FONT, "bold");
    doc.text(translatedText("pdf.headerTOC"), pageWidth / 2, 15, {
      align: "center",
    });
    doc.setFont(FONT, "normal");

    doc.setFontSize(FONT_SIZE_NORMAL);
    doc.text(translatedText("pdf.tableOfContents"), 105, 25, {
      align: "center",
    });

    currentPage += subHeaders.length;

    doc.setFontSize(FONT_SIZE_SMALL);
    doc.text(translatedText("pdf.reportGenerated") + " " + formatTime(), 5, 5, {
      align: "left",
    });
    doc.setFontSize(FONT_SIZE_NORMAL);
  });

  doc.setFontSize(FONT_SIZE_SMALL);
  doc.textWithLink(FOOTER_TEXT, pageWidth / 2, pageHeight - 5, {
    url: FOOTER_URL,
    align: "center",
  });

  return doc;
};

export const createProfileToC = (
  doc: jsPDF,
  selectedRFC: number,
  results: RFCTestResults,
  currentLanguage: string
) => {
  const translatedText = (key: string) => translate(key, currentLanguage);

  doc.setFont(FONT, "normal");
  doc.setFontSize(FONT_SIZE_NORMAL);

  const startX = 15;
  const buffer = 2;
  const targetX = 180 - buffer;
  let currentPage = selectedRFC === 0 ? 3 : 2;

  let yPosition = 40;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();

  const sections = Object.entries(results)
    .filter(([_, result]) => result !== null)
    .map(([key]) => {
      switch (key) {
        case "throughput":
          return {
            name: translatedText("input.rfcMode.options.throughput"),
            key,
          };
        case "latency":
          return {
            name: translatedText("input.rfcMode.options.latency"),
            key,
          };
        case "frame_loss_rate":
          return {
            name: translatedText("input.rfcMode.options.frameLoss"),
            key,
          };
        case "reset":
          return {
            name: translatedText("input.rfcMode.options.reset"),
            key,
          };
        default:
          return null;
      }
    })
    .filter((section) => section !== null);

  let tocEntries: any = [
    {
      title: translatedText("pdf.testExplanation"),
      page: `Page ${currentPage - 1}`,
    },
    {
      title: translatedText("pdf.termExplanation"),
      page: `Page ${currentPage}`,
    },
  ];

  const addSectionEntries = (section: any) => {
    tocEntries.push({
      title: section.name,
      page: `${translatedText("pdf.page")}${currentPage}`,
    });
    currentPage += 1;

    if (results[section.key as keyof RFCTestResults] !== null) {
      const frames = Object.keys(
        results[section.key as keyof RFCTestResults] as any
      );
      frames.forEach((frameSize, index) => {
        tocEntries.push({
          title: `${frameSize} Bytes`,
          page: `${translatedText("pdf.page")}${currentPage + index}`,
        });
      });
      currentPage += frames.length;
      tocEntries.push({
        title: translatedText("pdf.testGraph"),
        page: `${translatedText("pdf.page")}${currentPage}`,
      });
      currentPage += 1; // 1 Graph page
    }
  };

  if (selectedRFC === 0) {
    sections.forEach(addSectionEntries);
  } else {
    const section = sections[0];
    addSectionEntries(section);
  }

  tocEntries.forEach((entry: any) => {
    if (yPosition > 270) {
      yPosition = 40;
      doc.addPage();
    }

    const isBold =
      entry.title !== translatedText("pdf.testGraph") &&
      !entry.title.includes("Bytes");

    addToCEntry(
      doc,
      entry.title,
      entry.page,
      startX,
      targetX,
      yPosition,
      buffer,
      isBold ? "bold" : "normal"
    );

    yPosition += entry.title.includes("Bytes") ? 6 : 8; // Adjusted spacing
    if (entry.title.includes("Bytes")) {
      yPosition += 2; // Add extra space after each frame size
    }
  });

  const totalPages = doc.getNumberOfPages();

  for (let index = 1; index <= totalPages; index++) {
    doc.setPage(index);

    doc.setFontSize(FONT_SIZE_HEADER);
    doc.setFont(FONT, "bold");
    doc.text(translatedText("pdf.headerTOC"), pageWidth / 2, 15, {
      align: "center",
    });
    doc.setFont(FONT, "normal");

    doc.setFontSize(FONT_SIZE_NORMAL);
    doc.text(translatedText("pdf.tableOfContents"), 105, 25, {
      align: "center",
    });

    doc.setFontSize(FONT_SIZE_SMALL);
    doc.text(`${translatedText("pdf.reportGenerated")} ${formatTime()}`, 5, 5, {
      align: "left",
    });
    doc.textWithLink(FOOTER_TEXT, pageWidth / 2, pageHeight - 5, {
      url: FOOTER_URL,
      align: "center",
    });
  }

  return doc;
};
