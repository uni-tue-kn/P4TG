import { Col, Row, Table } from "react-bootstrap";
import translate from "../../../../components/translation/Translate";

const RFC2544Info = ({ currentLanguage }: { currentLanguage: string }) => (
  <>
    <h4>{translate("infoBoxes.rfc.title", currentLanguage)}</h4>
    <p>{translate("infoBoxes.rfc.description", currentLanguage)}</p>
    <ul>
      <li>
        <strong>
          {translate("infoBoxes.rfc.tests.throughput", currentLanguage)}:
        </strong>{" "}
        {translate("infoBoxes.rfc.steps.step1", currentLanguage)}
      </li>
      <li>
        <strong>
          {translate("infoBoxes.rfc.tests.latency", currentLanguage)}:
        </strong>{" "}
        {translate("infoBoxes.rfc.steps.step2", currentLanguage)}
      </li>
      <li>
        <strong>
          {translate("infoBoxes.rfc.tests.frameLoss", currentLanguage)}:
        </strong>{" "}
        {translate("infoBoxes.rfc.steps.step3", currentLanguage)}
      </li>
      <li>
        <strong>
          {translate("infoBoxes.rfc.tests.reset", currentLanguage)}:
        </strong>{" "}
        {translate("infoBoxes.rfc.steps.step4", currentLanguage)}
      </li>
    </ul>
  </>
);

const ThroughputInfo = ({ currentLanguage }: { currentLanguage: string }) => (
  <>
    <h4>
      {translate("infoBoxes.throughput.title", currentLanguage)}{" "}
      <a href="https://www.ietf.org/rfc/rfc2544.txt">(Section 26.1)</a>
    </h4>
    <p>{translate("infoBoxes.throughput.description", currentLanguage)}</p>
    <ul>
      <li>
        {translate("infoBoxes.throughput.details.streamRate", currentLanguage)}
      </li>
      <li>
        {translate("infoBoxes.throughput.details.step1", currentLanguage)}
      </li>
      <li>
        {translate("infoBoxes.throughput.details.step2", currentLanguage)}
      </li>
      <li>
        {translate("infoBoxes.throughput.details.step3", currentLanguage)}
      </li>
    </ul>
    <br />
    <code>
      {translate("infoBoxes.throughput.code.frameLossRate", currentLanguage)} =
      round(((input_count - output_count) * 100) / input_count, 2)
    </code>
    <br />
    <br />
    <p>{translate("infoBoxes.throughput.threshold", currentLanguage)}</p>
    <br />
    <strong>
      {translate("infoBoxes.throughput.procedure.title", currentLanguage)}
    </strong>
    <ol>
      <li>
        {translate("infoBoxes.throughput.procedure.step1", currentLanguage)}
      </li>
      <li>
        {translate("infoBoxes.throughput.procedure.step2", currentLanguage)}
      </li>
    </ol>
  </>
);

const LatencyInfo = ({ currentLanguage }: { currentLanguage: string }) => (
  <>
    <h4>
      {translate("infoBoxes.latency.title", currentLanguage)}{" "}
      <a href="https://www.ietf.org/rfc/rfc2544.txt">(Section 26.2)</a>
    </h4>
    <p>{translate("infoBoxes.latency.description", currentLanguage)}</p>
    <ul>
      <li>
        {translate("infoBoxes.latency.details.frameSize", currentLanguage)}
      </li>
      <li>
        {translate(
          "infoBoxes.latency.details.streamThroughput",
          currentLanguage
        )}
      </li>
    </ul>
    <p>{translate("infoBoxes.latency.duration", currentLanguage)}</p>
    <strong>
      {translate("infoBoxes.latency.procedure.title", currentLanguage)}
    </strong>
    <ol>
      <li>{translate("infoBoxes.latency.procedure.step1", currentLanguage)}</li>
      <li>{translate("infoBoxes.latency.procedure.step2", currentLanguage)}</li>
      <li>{translate("infoBoxes.latency.procedure.step3", currentLanguage)}</li>
      <li>{translate("infoBoxes.latency.procedure.step4", currentLanguage)}</li>
      <li>{translate("infoBoxes.latency.procedure.step5", currentLanguage)}</li>
      <li>{translate("infoBoxes.latency.procedure.step6", currentLanguage)}</li>
    </ol>
    <p>{translate("infoBoxes.latency.summary", currentLanguage)}</p>
  </>
);

const FrameLossInfo = ({ currentLanguage }: { currentLanguage: string }) => (
  <>
    <h4>
      {translate("infoBoxes.frameLoss.title", currentLanguage)}{" "}
      <a href="https://www.ietf.org/rfc/rfc2544.txt">(Section 26.3)</a>
    </h4>
    <p>{translate("infoBoxes.frameLoss.description", currentLanguage)}</p>
    <strong>
      {translate("infoBoxes.frameLoss.procedure.title", currentLanguage)}
    </strong>
    <ol>
      <li>
        {translate("infoBoxes.frameLoss.procedure.step1", currentLanguage)}
      </li>
      <li>
        {translate("infoBoxes.frameLoss.procedure.step2", currentLanguage)}
      </li>
      <li>
        {translate("infoBoxes.frameLoss.procedure.step3", currentLanguage)}
      </li>
      <li>
        {translate("infoBoxes.frameLoss.procedure.step4", currentLanguage)}
      </li>
    </ol>
    <p>{translate("infoBoxes.frameLoss.summary", currentLanguage)}</p>
  </>
);

const ResetInfo = ({ currentLanguage }: { currentLanguage: string }) => (
  <>
    <h4>
      {translate("infoBoxes.reset.title", currentLanguage)}{" "}
      <a href="https://www.ietf.org/rfc/rfc2544.txt">(Section 26.6)</a>
    </h4>
    <p>{translate("infoBoxes.reset.description", currentLanguage)}</p>
  </>
);

const ImixInfo = ({ currentLanguage }: { currentLanguage: string }) => (
  <>
    <Row>
      <Col>
        <p>{translate("imixInfo.description", currentLanguage)}</p>
      </Col>
    </Row>
    <Row>
      <Col>
        <Table bordered>
          <thead>
            <tr>
              <th>{translate("imixInfo.table.packetSize", currentLanguage)}</th>
              <th>{translate("imixInfo.table.proportion", currentLanguage)}</th>
              <th>{translate("imixInfo.table.bandwidth", currentLanguage)}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{translate("imixInfo.sizes.size1", currentLanguage)}</td>
              <td>
                {translate("imixInfo.sizes.proportion1", currentLanguage)}
              </td>
              <td>{translate("imixInfo.sizes.bandwidth1", currentLanguage)}</td>
            </tr>
            <tr>
              <td>{translate("imixInfo.sizes.size2", currentLanguage)}</td>
              <td>
                {translate("imixInfo.sizes.proportion2", currentLanguage)}
              </td>
              <td>{translate("imixInfo.sizes.bandwidth2", currentLanguage)}</td>
            </tr>
            <tr>
              <td>{translate("imixInfo.sizes.size3", currentLanguage)}</td>
              <td>
                {translate("imixInfo.sizes.proportion3", currentLanguage)}
              </td>
              <td>{translate("imixInfo.sizes.bandwidth3", currentLanguage)}</td>
            </tr>
          </tbody>
        </Table>
      </Col>
      <p>{translate("imixInfo.note", currentLanguage)}</p>
    </Row>
  </>
);

export {
  ThroughputInfo,
  LatencyInfo,
  FrameLossInfo,
  ResetInfo,
  RFC2544Info,
  ImixInfo,
};
