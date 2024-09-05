import { useState, useEffect } from "react";
import { Dropdown } from "react-bootstrap";
import DownloadCsv from "./csv/Csv";
import DownloadPdf from "./pdf/Pdf";

import {
  ProfileMode,
  Statistics,
  TestMode,
  TimeStatistics,
} from "../common/Interfaces";
import { TrafficGenList } from "../common/Interfaces";
import translate from "./translation/Translate";

const Download = ({
  data,
  stats,
  traffic_gen_list,
  test_mode,
  selectedProfile,
  selectedRFC,
  graph_images,
  profileData,
  currentLanguage,
}: {
  data: TimeStatistics;
  stats: Statistics;
  traffic_gen_list: TrafficGenList;
  test_mode: TestMode;
  selectedProfile: ProfileMode;
  selectedRFC: number;
  graph_images: {
    [key: number]: { Summary: string[]; [key: string]: string[] };
  };
  profileData: any;
  currentLanguage: string;
}) => {
  const [isDisabled, setIsDisabled] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsDisabled(false);
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  const csvButtonProps = {
    data,
    stats,
    traffic_gen_list,
    selectedProfile,
    test_mode,
    profileData,
  };

  const pdfButtonProps = {
    stats,
    traffic_gen_list,
    test_mode,
    selectedProfile,
    selectedRFC,
    graph_images,
  };

  const { handleDownloadCsv } = DownloadCsv(csvButtonProps);
  const { handleDownloadPdf } = DownloadPdf(pdfButtonProps);

  return (
    <div style={{ position: "absolute", width: "100%" }}>
      <Dropdown>
        <Dropdown.Toggle
          variant="dark"
          className="mb-1 w-100"
          disabled={isDisabled}
        >
          {translate("buttons.download", currentLanguage)}{" "}
        </Dropdown.Toggle>

        <Dropdown.Menu className="w-100">
          <Dropdown.Item
            onClick={handleDownloadPdf}
            className="custom-dropdown-item"
          >
            <i className="bi bi-filetype-pdf"></i> PDF
          </Dropdown.Item>
          <Dropdown.Item
            onClick={handleDownloadCsv}
            className="custom-dropdown-item"
          >
            <i className="bi bi-filetype-csv"></i> CSV
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>
    </div>
  );
};
export default Download;
