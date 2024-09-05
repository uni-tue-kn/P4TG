import { Row, Col, Table, Form } from "react-bootstrap";
import { GenerationMode, TrafficGenData, Port } from "../../common/Interfaces";
import StreamSettingsList from "./StreamSettingsList";
import { StyledCol } from "../../sites/Settings";
import translate from "../translation/Translate";

const PortMappingTable = ({
  ports,
  running,
  handlePortChange,
  currentTest,
  activateAllInRow = false,
}: {
  ports: Port[];
  running: boolean;
  handlePortChange: (event: any, pid: number) => void;
  currentTest: TrafficGenData | null;
  activateAllInRow?: boolean;
}) => {
  if (
    currentTest &&
    ((currentTest.streams && currentTest.streams.length > 0) ||
      currentTest.mode === GenerationMode.ANALYZE)
  ) {
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
                <th>TX Port</th>
                <th>RX Port</th>
                {currentTest.streams.map((v: any, i: any) => {
                  return <th key={i}>Stream {v.app_id}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {ports.map((v, i) => {
                if (v.loopback === "BF_LPBK_NONE") {
                  const selectValue =
                    currentTest.port_tx_rx_mapping[v.pid] || -1;
                  return (
                    <tr key={i}>
                      <StyledCol>
                        {v.port} ({v.pid})
                      </StyledCol>
                      <StyledCol>
                        <Form.Select
                          disabled={running || !v.status}
                          required
                          value={selectValue}
                          onChange={(event: any) =>
                            handlePortChange(event, v.pid)
                          }
                        >
                          <option value={-1}>
                            {translate("input.selectRxPort")}
                          </option>
                          {ports.map((v, i) => {
                            if (v.loopback === "BF_LPBK_NONE") {
                              return (
                                <option key={i} value={v.pid}>
                                  {v.port} ({v.pid})
                                </option>
                              );
                            }
                          })}
                        </Form.Select>
                      </StyledCol>

                      <StreamSettingsList
                        stream_settings={currentTest.stream_settings || []}
                        streams={currentTest.streams || []}
                        running={running}
                        port={v}
                        activateAllInRow={activateAllInRow}
                      />
                    </tr>
                  );
                }
              })}
            </tbody>
          </Table>
        </Col>
      </Row>
    );
  }
  return null;
};

export default PortMappingTable;
