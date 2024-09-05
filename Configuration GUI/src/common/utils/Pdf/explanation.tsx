import { TestMode } from "../../Interfaces";
import autoTable from "jspdf-autotable";
import { jsPDF } from "jspdf";
import translate from "../../../components/translation/Translate";

import {
  FOOTER_TEXT,
  FONT,
  FONT_SIZE_NORMAL,
  FONT_SIZE_HEADER,
  FOOTER_URL,
} from "./constants";

export const createTestExplanation = (
  doc: jsPDF,
  test_mode: TestMode,
  currentLanguage: string,
  startX = 20,
  startY = 35,
  maxWidth = 170
) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const translatedText = (key: string) => translate(key, currentLanguage);

  const reportExplanation = translatedText("pdf.infoText.reportExplanation");
  const rfcExplanation = translatedText("pdf.infoText.rfcExplanation");

  const glossaryEntries = [
    "cbr",
    "poissonMode",
    "monitorMode",
    "p4tg",
    "packetLoss",
    "rtt",
    "iat",
    "jitter",
    "tx",
    "rx",
    "vxLan",
    "frameSize",
    "frameLossRatio",
    "mae",
    "multicast",
    "unicast",
    "vlan",
    "qinq",
    "mpls",
    "iatPrecision",
    "ratePrecision",
  ].map((term) => [
    translatedText(`pdf.glossary.${term}.title`),
    translatedText(`pdf.glossary.${term}.description`),
  ]);

  const centerText = (
    text: string,
    y: number,
    fontSize = FONT_SIZE_NORMAL,
    fontStyle = "normal"
  ) => {
    doc.setFont(FONT, fontStyle);
    doc.setFontSize(fontSize);
    doc.text(text, pageWidth / 2, y, { align: "center" });
  };

  const addTextBlock = (text: string, x: number, y: number, width: number) => {
    const wrappedText = doc.splitTextToSize(text, width);
    doc.text(wrappedText, x, y);
  };

  const addGlossaryTable = () => {
    autoTable(doc, {
      startY,
      head: [[translatedText("pdf.term"), translatedText("pdf.explanation")]],
      body: glossaryEntries,
      theme: "plain",
      styles: { fontSize: 10 },
      margin: { left: startX },
      columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 110 } },
    });
  };

  const addFooterLink = () => {
    doc.setFontSize(8);
    doc.textWithLink(FOOTER_TEXT, pageWidth / 2, pageHeight - 5, {
      url: FOOTER_URL,
      align: "center",
    });
  };

  centerText(translatedText("pdf.testExplanation"), 25);
  addTextBlock(reportExplanation, startX, startY, maxWidth);

  if (test_mode === TestMode.PROFILE) {
    centerText("RFC explanation", 3 * startY - 10);
    addTextBlock(rfcExplanation, startX, 3 * startY, maxWidth);
  }
  centerText(translatedText("pdf.headerTOC"), 15, FONT_SIZE_HEADER, "bold");

  doc.addPage();

  centerText(translatedText("pdf.headerTOC"), 15, FONT_SIZE_HEADER, "bold");
  centerText(translatedText("pdf.termExplanation"), 25);

  addGlossaryTable();
  addFooterLink();
};
