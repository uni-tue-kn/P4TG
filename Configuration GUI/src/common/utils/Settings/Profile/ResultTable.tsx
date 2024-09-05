import { Col, Row, Table } from "react-bootstrap";
import { RFCTestResults } from "../../../Interfaces";
import InfoBox from "../../../../components/InfoBox";
import translate from "../../../../components/translation/Translate";
import {
  FrameLossInfo,
  LatencyInfo,
  ResetInfo,
  ThroughputInfo,
} from "./InfoText";

const renderCell = (
  data: any,
  size: string,
  unit: string,
  running: boolean,
  currentLanguage: string,
  noDecimal: boolean = false
) => {
  if (data?.[size] !== undefined && data[size] !== null) {
    const value = noDecimal ? Math.round(data[size]) : data[size].toFixed(3);
    return `${value} ${unit}`;
  } else {
    return running
      ? translate("other.notFinished", currentLanguage)
      : translate("other.notRunning", currentLanguage);
  }
};

const renderFrameLossCell = (
  data: any,
  size: string,
  running: boolean,
  currentLanguage: string
) => {
  const frameLossData = data?.[size];
  if (!frameLossData) {
    return running
      ? translate("other.notFinished", currentLanguage)
      : translate("other.notRunning", currentLanguage);
  }

  const entries = Object.entries(frameLossData).map(([key, value]) => ({
    key,
    value: (value as number).toFixed(3),
  }));

  const midpoint = Math.ceil(entries.length / 2);
  const firstHalf = entries.slice(0, midpoint);
  const secondHalf = entries.slice(midpoint);

  return (
    <Table bordered size="sm" className="m-0">
      <thead>
        <tr>
          <th>{translate("statistics.bandwidth", currentLanguage)}</th>
          <th>
            {translate("input.rfcMode.options.frameLoss", currentLanguage)}
          </th>
          <th>{translate("statistics.bandwidth", currentLanguage)}</th>
          <th>
            {translate("input.rfcMode.options.frameLoss", currentLanguage)}
          </th>
        </tr>
      </thead>
      <tbody>
        {firstHalf.map((entry, index) => (
          <tr key={index}>
            <td>{entry.key}%</td>
            <td>{entry.value}</td>
            {secondHalf[index] && (
              <>
                <td>{secondHalf[index].key}%</td>
                <td>{secondHalf[index].value}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
};
const ResultTable = ({
  results,
  running,
  currentLanguage,
}: {
  results: RFCTestResults;
  running: boolean;
  currentLanguage: string;
}) => {
  const frameSizes = ["64", "128", "512", "1024", "1518"];
  return (
    <>
      <Row>
        <Col>
          <Table
            striped
            bordered
            hover
            size="sm"
            className={"mt-3 mb-3 text-center"}
          >
            <thead className={"table-dark"}>
              <tr>
                <th>{translate("statistics.frameSize", currentLanguage)}</th>
                <th>
                  {translate(
                    "input.rfcMode.options.throughput",
                    currentLanguage
                  )}{" "}
                  <InfoBox>
                    <ThroughputInfo currentLanguage={currentLanguage} />
                  </InfoBox>
                </th>
                <th>
                  {translate("input.rfcMode.options.latency", currentLanguage)}{" "}
                  <InfoBox>
                    <LatencyInfo currentLanguage={currentLanguage} />
                  </InfoBox>
                </th>
                <th>
                  {translate(
                    "input.rfcMode.options.frameLoss",
                    currentLanguage
                  )}{" "}
                  <InfoBox>
                    <FrameLossInfo currentLanguage={currentLanguage} />
                  </InfoBox>
                </th>
                <th>
                  {translate("input.rfcMode.options.reset", currentLanguage)}{" "}
                  <InfoBox>
                    <ResetInfo currentLanguage={currentLanguage} />
                  </InfoBox>
                </th>
              </tr>
            </thead>
            <tbody>
              {frameSizes.map((size) => (
                <tr key={size}>
                  <td>{`${size} Bytes`}</td>
                  <td>
                    {renderCell(
                      results.throughput,
                      size,
                      "Frames/s",
                      running,
                      currentLanguage,
                      true
                    )}
                  </td>
                  <td>
                    {renderCell(
                      results.latency,
                      size,
                      "µs",
                      running,
                      currentLanguage
                    )}
                  </td>
                  <td>
                    {renderFrameLossCell(
                      results.frame_loss_rate,
                      size,
                      running,
                      currentLanguage
                    )}
                  </td>
                  <td>
                    {size === "64"
                      ? renderCell(
                          results.reset,
                          size,
                          "s",
                          running,
                          currentLanguage
                        )
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Col>
      </Row>
    </>
  );
};

export default ResultTable;
