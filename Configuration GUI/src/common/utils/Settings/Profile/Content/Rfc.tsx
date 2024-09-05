import PortMappingTable from "../../../../../components/settings/PortMappingTable";
import StreamTable from "../../../../../components/settings/StreamTable";
import { TrafficGenData, RFCTestResults, Port } from "../../../../Interfaces";
import { SaveResetButtons } from "../../Components";
import ResultTable from "../ResultTable";

const RFCContent = ({
  results,
  running,
  currentLanguage,
  removeStream,
  currentTest,
  ports,
  handlePortChange,
  save,
  reset,
}: {
  results: RFCTestResults;
  running: boolean;
  currentLanguage: string;
  removeStream: () => void;
  currentTest: TrafficGenData | null;
  ports: Port[];
  handlePortChange: (event: any, pid: number) => void;
  save: () => void;
  reset: () => void;
}) => {
  return (
    <>
      <ResultTable
        results={results}
        running={running}
        currentLanguage={currentLanguage}
      />

      <StreamTable
        {...{
          removeStream,
          running,
          currentTest,
          currentLanguage,
        }}
      />

      <PortMappingTable
        {...{
          ports,
          running,
          handlePortChange,
          currentTest,
        }}
      />
      <SaveResetButtons
        onSave={save}
        onReset={reset}
        running={running}
        currentLanguage={currentLanguage}
      />
    </>
  );
};

export { RFCContent };
