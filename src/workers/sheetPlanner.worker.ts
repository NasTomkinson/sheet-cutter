import {
  planSheetCuts,
  type PlannerWorkerRequest,
  type PlannerWorkerResponse,
} from "../lib/sheetPlanner";

self.onmessage = (event: MessageEvent<PlannerWorkerRequest>) => {
  const { jobId, cuts, sheetWidth, sheetHeight, kerfSize, maxSheets } = event.data;

  const response: PlannerWorkerResponse = {
    jobId,
    layout: planSheetCuts(cuts, sheetWidth, sheetHeight, kerfSize, maxSheets),
  };

  self.postMessage(response);
};

export {};
