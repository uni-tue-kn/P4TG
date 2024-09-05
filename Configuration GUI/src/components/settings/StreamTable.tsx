import { Row, Col, Table } from "react-bootstrap";
import StreamElement from "./StreamElement";
import { GenerationMode, TrafficGenData } from "../../common/Interfaces";
import translate from "../translation/Translate";

const StreamTable = ({
  removeStream,
  running,
  currentTest,
  currentLanguage,
}: {
  removeStream: (id: number) => void;
  running: boolean;
  currentTest: TrafficGenData | null;
  currentLanguage: string;
}) => {
  if (currentTest && currentTest.mode !== GenerationMode.ANALYZE) {
    return (
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
                <th>Stream-ID</th>
                <th>{translate("statistics.frameSize", currentLanguage)}</th>
                <th>Rate</th>
                <th>{translate("other.mode", currentLanguage)}</th>
                <th>VxLAN &nbsp;</th>
                <th>
                  {translate("statistics.encapsulation", currentLanguage)}
                  &nbsp;
                </th>
                <th>{translate("other.options", currentLanguage)}</th>
              </tr>
            </thead>
            <tbody>
              {currentTest.streams.map((v, i) => {
                v.app_id = i + 1;
                return (
                  <StreamElement
                    key={i}
                    mode={currentTest.mode}
                    data={v}
                    remove={removeStream}
                    running={running}
                    stream_settings={currentTest.stream_settings || []}
                  />
                );
              })}
            </tbody>
          </Table>
        </Col>
      </Row>
    );
  }
  return null;
};

export default StreamTable;
