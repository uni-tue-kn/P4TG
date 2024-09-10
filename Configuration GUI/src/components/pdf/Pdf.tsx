import { useEffect, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import { get } from "../../common/API";
import {
  Statistics,
  TestMode,
  TrafficGenList,
  RFCTestResults,
  Port,
  ProfileMode,
} from "../../common/Interfaces";

import {
  createPdf,
  createProfilePdf,
} from "../../common/utils/Pdf/pdfCreation";
import {
  createToC,
  createProfileToC,
} from "../../common/utils/Pdf/tocCreation";
import { createTestExplanation } from "../../common/utils/Pdf/explanation";
import { mergePdfs } from "../../common/utils/Pdf/helper";

const DownloadPdf = ({
  stats,
  traffic_gen_list,
  test_mode,
  selectedProfile,
  selectedRFC,
  graph_images,
}: {
  stats: Statistics;
  traffic_gen_list: TrafficGenList;
  test_mode: TestMode;
  selectedProfile: ProfileMode;
  selectedRFC: number;
  graph_images: {
    [key: number]: { Summary: string[];[key: string]: string[] };
  };
}) => {
  const [ports, set_ports] = useState<Port[]>([]);
  const [results, set_results] = useState<RFCTestResults>({
    throughput: null,
    latency: null,
    frame_loss_rate: null,
    back_to_back: null,
    reset: null,
  });

  const loadPorts = async () => {
    let ports;
    try {
      ports = await get({ route: "/ports" });
    } catch (error) {
      return;
    }

    if (ports && ports.status === 200) {
      set_ports(ports.data);
    }
  };

  const loadRFCResults = async () => {
    const res = await get({ route: "/profiles" });

    if (res && res.status === 200) {
      set_results(res.data);
    }
  };

  useEffect(() => {
    loadPorts();
    loadRFCResults();
  }, []);

  const [currentLanguage, setCurrentLanguage] = useState(
    localStorage.getItem("language") || "en-US"
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const storedLanguage = localStorage.getItem("language") || "en-US";
      if (storedLanguage !== currentLanguage) {
        setCurrentLanguage(storedLanguage);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [currentLanguage]);

  const subHeadersMap: any = useRef({});

  const handleDownloadPdf = async () => {
    if (
      test_mode === TestMode.PROFILE &&
      selectedProfile === ProfileMode.RFC2544
    ) {
      const profilePdfBuffer = createProfilePdf(
        traffic_gen_list,
        stats,
        results,
        selectedRFC,
        graph_images[1],
        currentLanguage
      );

      const tocProfileDoc = new jsPDF("p", "mm", [297, 210]);
      createProfileToC(tocProfileDoc, selectedRFC, results, currentLanguage);
      const tocProfileBuffer = tocProfileDoc.output("arraybuffer");

      const expDoc = new jsPDF("p", "mm", [297, 210]);
      createTestExplanation(expDoc, test_mode, currentLanguage);
      const expPdfBuffer = expDoc.output("arraybuffer");

      const mergedPdfFile = await mergePdfs([
        tocProfileBuffer,
        expPdfBuffer,
        profilePdfBuffer,
      ]);

      const blob = new Blob([mergedPdfFile], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ProfileNetworkReport.pdf";
      a.click();
    } else {
      const pdfBuffers = await Promise.all(
        Object.keys(traffic_gen_list).map((key) =>
          createPdf(
            traffic_gen_list,
            stats,
            graph_images[Number(key)],
            Number(key),
            subHeadersMap,
            ports,
            currentLanguage
          )
        )
      );

      const tocDoc = new jsPDF("p", "mm", [297, 210]);
      createToC(
        tocDoc,
        subHeadersMap.current,
        traffic_gen_list,
        currentLanguage
      );
      const tocPdfBuffer = tocDoc.output("arraybuffer");

      const expDoc = new jsPDF("p", "mm", [297, 210]);
      createTestExplanation(expDoc, test_mode, currentLanguage);
      const expPdfBuffer = expDoc.output("arraybuffer");

      const mergedPdfFile = await mergePdfs([
        tocPdfBuffer,
        expPdfBuffer,
        ...pdfBuffers,
      ]);

      const blob = new Blob([mergedPdfFile], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "MergedNetworkReport.pdf";
      a.click();
      console.log(subHeadersMap.current);
    }
  };

  return { handleDownloadPdf };
};

export default DownloadPdf;
