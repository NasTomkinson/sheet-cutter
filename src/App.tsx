import { useEffect, useMemo, useRef, useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { Sidebar } from "./components/sidebar";
import {
  normalizeCuts,
  type CutInput,
  type Guide,
  type MultiSheetPackResult,
  type Placement,
  type PlannerWorkerResponse,
  type SheetLayout,
} from "./lib/sheetPlanner";
import type { CutFormRow, SheetConfigFormValues } from "./types/forms";

type AppliedSheetState = SheetConfigFormValues;

const sheetWidth = 2440;
const sheetHeight = 1220;
const kerfSize = 3;
const scale = 3;
const recalculateDelayMs = 150;
const defaultCutRows: CutFormRow[] = [];

function App() {
  const form = useForm<SheetConfigFormValues>({
    defaultValues: {
      kerfSize,
      sheetWidth,
      sheetHeight,
      maxSheets: undefined,
      cuts: defaultCutRows,
    },
  });

  const watchedValues = useWatch({
    control: form.control,
  });

  const liveKerfSize = sanitizeDimension(watchedValues.kerfSize, kerfSize);
  const liveSheetWidth = sanitizeDimension(watchedValues.sheetWidth, sheetWidth);
  const liveSheetHeight = sanitizeDimension(watchedValues.sheetHeight, sheetHeight);
  const liveMaxSheets = sanitizeOptionalPositiveInteger(watchedValues.maxSheets);
  const liveCutRows = useMemo(
    () => normalizeCutRows(watchedValues.cuts),
    [watchedValues.cuts],
  );

  const [appliedState, setAppliedState] = useState<AppliedSheetState>({
    kerfSize,
    sheetWidth,
    sheetHeight,
    maxSheets: undefined,
    cuts: defaultCutRows,
  });
  const [appliedVersion, setAppliedVersion] = useState(0);
  const [layoutResult, setLayoutResult] = useState<{
    version: number;
    layout: MultiSheetPackResult;
  } | null>(null);

  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const workerRef = useRef<Worker | null>(null);

  const appliedCuts = useMemo(
    () => normalizeCuts(expandCutRows(appliedState.cuts)),
    [appliedState.cuts],
  );
  const liveCutRowsSignature = useMemo(
    () => serializeCutRows(liveCutRows),
    [liveCutRows],
  );
  const appliedCutRowsSignature = useMemo(
    () => serializeCutRows(appliedState.cuts),
    [appliedState.cuts],
  );
  const layout = layoutResult?.version === appliedVersion
    ? layoutResult.layout
    : null;
  const isInputPending =
    liveKerfSize !== appliedState.kerfSize ||
    liveSheetWidth !== appliedState.sheetWidth ||
    liveSheetHeight !== appliedState.sheetHeight ||
    liveMaxSheets !== appliedState.maxSheets ||
    liveCutRowsSignature !== appliedCutRowsSignature;
  const isWorkerPending = layoutResult?.version !== appliedVersion;
  const isRecalculating = isInputPending || isWorkerPending;

  const placedCuts = layout?.sheets.flatMap((sheet) => sheet.placed) ?? [];
  const sheetArea = appliedState.sheetWidth * appliedState.sheetHeight;
  const rotatedCuts = placedCuts.filter((cut) => cut.rotated);
  const totalCutCount = layout?.sheets.reduce(
    (total, sheet) =>
      total + countSheetCuts(sheet, appliedState.sheetWidth, appliedState.sheetHeight),
    0,
  ) ?? 0;

  useEffect(() => {
    const nextState = {
      kerfSize: liveKerfSize,
      sheetWidth: liveSheetWidth,
      sheetHeight: liveSheetHeight,
      maxSheets: liveMaxSheets,
      cuts: liveCutRows,
    };

    const hasChanged =
      nextState.kerfSize !== appliedState.kerfSize ||
      nextState.sheetWidth !== appliedState.sheetWidth ||
      nextState.sheetHeight !== appliedState.sheetHeight ||
      nextState.maxSheets !== appliedState.maxSheets ||
      liveCutRowsSignature !== appliedCutRowsSignature;

    if (!hasChanged) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setAppliedState(nextState);
      setAppliedVersion((currentVersion) => currentVersion + 1);
    }, recalculateDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    appliedCutRowsSignature,
    appliedState.kerfSize,
    appliedState.sheetHeight,
    appliedState.maxSheets,
    appliedState.sheetWidth,
    liveKerfSize,
    liveMaxSheets,
    liveCutRows,
    liveCutRowsSignature,
    liveSheetHeight,
    liveSheetWidth,
  ]);

  useEffect(() => {
    const worker = new Worker(
      new URL("./workers/sheetPlanner.worker.ts", import.meta.url),
      { type: "module" },
    );

    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<PlannerWorkerResponse>) => {
      setLayoutResult({
        version: event.data.jobId,
        layout: event.data.layout,
      });
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) {
      return;
    }

    worker.postMessage({
      jobId: appliedVersion,
      cuts: appliedCuts,
      sheetWidth: appliedState.sheetWidth,
      sheetHeight: appliedState.sheetHeight,
      kerfSize: appliedState.kerfSize,
      maxSheets: appliedState.maxSheets,
    });
  }, [
    appliedCuts,
    appliedState.cuts,
    appliedState.kerfSize,
    appliedState.maxSheets,
    appliedState.sheetHeight,
    appliedState.sheetWidth,
    appliedVersion,
  ]);

  useEffect(() => {
    if (!layout) return;

    layout.sheets.forEach((sheet, index) => {
      const canvas = canvasRefs.current[index];
      if (!canvas) {
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }

      drawLayout({
        ctx,
        placed: sheet.placed,
        guides: sheet.guides,
        width: appliedState.sheetWidth,
        height: appliedState.sheetHeight,
        scale,
      });
    });
  }, [appliedState.sheetHeight, appliedState.sheetWidth, layout]);

  const canvasWidth = scaler(appliedState.sheetWidth, scale);
  const canvasHeight = scaler(appliedState.sheetHeight, scale);
  const showEmptyState = !isRecalculating && appliedCuts.length === 0;

  return (
    <FormProvider {...form}>
      <main className="grid min-h-screen grid-cols-[380px_1fr]">
        <Sidebar />
        <div className="flex flex-col gap-4 p-12">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm bg-gray-200 p-4 rounded">
            <div>
              Sheet: {appliedState.sheetWidth} x {appliedState.sheetHeight} mm
            </div>
            <div>Area: {(sheetArea * layout?.sheets.length ?? 0).toLocaleString()} mm2</div>
            <div>Kerf: {appliedState.kerfSize} mm</div>
            <div>Sheets: {layout?.sheets.length ?? 0}</div>
            <div>
              Max sheets: {appliedState.maxSheets?.toString() ?? "Unlimited"}
            </div>
            <div>Total cuts: {totalCutCount}</div>
            {isRecalculating ? <div>Calculating cut plan...</div> : null}
          </div>

          <div className="relative flex flex-col gap-6">
            {layout?.sheets.map((sheet, index) => (
              <SheetCanvas
                key={`sheet-${sheet.sheetNumber}`}
                canvasHeight={canvasHeight}
                canvasWidth={canvasWidth}
                sheetHeight={appliedState.sheetHeight}
                setCanvasRef={(element) => {
                  canvasRefs.current[index] = element;
                }}
                sheetArea={sheetArea}
                sheetWidth={appliedState.sheetWidth}
                sheet={sheet}
              />
            ))}

            {isRecalculating ? (
              <div className="absolute inset-0 flex items-center justify-center bg-white text-sm font-medium text-slate-700">
                Updating cut plan...
              </div>
            ) : null}

            {showEmptyState ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-sm text-slate-600">
                Add cuts to generate a layout.
              </div>
            ) : null}
          </div>

          {rotatedCuts.length > 0 ? (
            <div className="text-sm text-slate-700">
              Rotated: {rotatedCuts.map((cut) => `#${cut.id}`).join(", ")}
            </div>
          ) : null}

          {!isRecalculating &&
          layout &&
          typeof appliedState.maxSheets === "number" ? (
            <div
              className={`text-sm ${
                layout.unplaced.length === 0 ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {layout.unplaced.length === 0
                ? "All cuts fit into the layout."
                : `The cutlist goes outside the selected ${appliedState.maxSheets} ${
                    appliedState.maxSheets === 1 ? "sheet" : "sheets"
                  }.`}
            </div>
          ) : null}

          {layout && layout.unplaced.length > 0 ? (
            <div className="text-sm text-red-700">
              Unplaced cuts:{" "}
              {layout.unplaced
                .map((cut) => `#${cut.id} (${cut.width} x ${cut.height})`)
                .join(", ")}
            </div>
          ) : null}

        </div>
      </main>
    </FormProvider>
  );
}

function SheetCanvas({
  canvasHeight,
  canvasWidth,
  setCanvasRef,
  sheet,
  sheetArea,
  sheetHeight,
  sheetWidth,
}: {
  canvasHeight: number;
  canvasWidth: number;
  setCanvasRef: (element: HTMLCanvasElement | null) => void;
  sheet: SheetLayout;
  sheetArea: number;
  sheetHeight: number;
  sheetWidth: number;
}) {
  const usedArea = sheet.placed.reduce(
    (total, cut) => total + cut.width * cut.height,
    0,
  );
  const usage = sheetArea === 0
    ? 0
    : Math.round((usedArea / sheetArea) * 1000) / 10;

  return (
    <div className="flex flex-col justify-start items-start gap-2">
      <div className="text-sm font-medium text-slate-700">
        Sheet {sheet.sheetNumber}
      </div>
      <div className="flex justify-start items-start gap-6">
        <div className="flex flex-col gap-2">
          <div
            className="relative max-w-full overflow-hidden border="
            style={{ width: canvasWidth, height: canvasHeight }}
          >
            <canvas
              ref={setCanvasRef}
              width={canvasWidth}
              height={canvasHeight}
              className="max-w-full bg-white"
            />
          </div>
        </div>

        <div className="flex w-32 flex-col gap-2 pt-7 text-sm text-slate-700 rounded bg-gray-200 p-4 ">
          <div>
            Packed
            <div className="font-medium text-slate-900">{sheet.placed.length}</div>
          </div>
          <div>
            Usage
            <div className="font-medium text-slate-900">{usage}%</div>
          </div>
          <div>
            Cuts
            <div className="font-medium text-slate-900">
              {countSheetCuts(sheet, sheetWidth, sheetHeight)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function countSheetCuts(
  sheet: SheetLayout,
  sheetWidth: number,
  sheetHeight: number,
) {
  if (sheet.placed.length === 0) {
    return 0;
  }

  const occupiedBounds = sheet.placed.reduce(
    (bounds, cut) => ({
      minX: Math.min(bounds.minX, cut.x),
      minY: Math.min(bounds.minY, cut.y),
      maxX: Math.max(bounds.maxX, cut.x + cut.width),
      maxY: Math.max(bounds.maxY, cut.y + cut.height),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: 0,
      maxY: 0,
    },
  );

  const cutCoordinates = new Set<string>();

  sheet.guides.forEach((guide) => {
    if (guide.orientation === "horizontal") {
      cutCoordinates.add(`H:${guide.y}`);
      return;
    }

    cutCoordinates.add(`V:${guide.x}`);
  });

  if (occupiedBounds.minX > 0) cutCoordinates.add(`V:${occupiedBounds.minX}`);
  if (occupiedBounds.minY > 0) cutCoordinates.add(`H:${occupiedBounds.minY}`);
  if (occupiedBounds.maxX < sheetWidth) cutCoordinates.add(`V:${occupiedBounds.maxX}`);
  if (occupiedBounds.maxY < sheetHeight) cutCoordinates.add(`H:${occupiedBounds.maxY}`);

  return cutCoordinates.size;
}

function normalizeCutRows(rows: Array<Partial<CutFormRow>> | undefined) {
  if (!rows) {
    return defaultCutRows;
  }

  return rows.map((row) => ({
    quantity: sanitizeQuantity(row.quantity),
    width: sanitizeDimension(row.width, 0),
    height: sanitizeDimension(row.height, 0),
  }));
}

function serializeCutRows(rows: CutFormRow[]) {
  return rows
    .map((row) => `${row.quantity}:${row.width}:${row.height}`)
    .join("|");
}

function expandCutRows(rows: Array<Partial<CutFormRow>> | undefined) {
  const expanded: CutInput[] = [];
  let nextId = 1;

  rows?.forEach((row) => {
    const quantity = sanitizeQuantity(row.quantity);
    const width = sanitizeDimension(row.width, 0);
    const height = sanitizeDimension(row.height, 0);

    if (quantity <= 0 || width <= 0 || height <= 0) {
      return;
    }

    for (let index = 0; index < quantity; index += 1) {
      expanded.push({
        id: nextId,
        width,
        height,
      });
      nextId += 1;
    }
  });

  return expanded;
}

function scaler(number: number, scaleFactor: number) {
  return Math.round(number / scaleFactor);
}

function sanitizeDimension(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function sanitizeQuantity(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.min(10, Math.max(0, Math.floor(value)));
}

function sanitizeOptionalPositiveInteger(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return undefined;
  }

  return Math.floor(value);
}

function drawLayout({
  ctx,
  placed,
  guides,
  width,
  height,
  scale,
}: {
  ctx: CanvasRenderingContext2D;
  placed: Placement[];
  guides: Guide[];
  width: number;
  height: number;
  scale: number;
}) {
  ctx.clearRect(0, 0, scaler(width, scale), scaler(height, scale));

  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, scaler(width, scale), scaler(height, scale));

  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, scaler(width, scale), scaler(height, scale));

  ctx.save();
  ctx.setLineDash([8, 4]);
  ctx.strokeStyle = "#94a3b8";

  guides.forEach((guide) => {
    ctx.beginPath();

    if (guide.orientation === "horizontal") {
      ctx.moveTo(guide.x / scale, guide.y / scale);
      ctx.lineTo((guide.x + guide.length) / scale, guide.y / scale);
    } else {
      ctx.moveTo(guide.x / scale, guide.y / scale);
      ctx.lineTo(guide.x / scale, (guide.y + guide.length) / scale);
    }

    ctx.stroke();
  });

  ctx.restore();

  ctx.font = "12px sans-serif";
  ctx.textBaseline = "top";

  placed.forEach((cut, index) => {
    const x = cut.x / scale;
    const y = cut.y / scale;
    const cutWidth = cut.width / scale;
    const cutHeight = cut.height / scale;

    ctx.fillStyle = fillColor(index);
    ctx.fillRect(x, y, cutWidth, cutHeight);

    ctx.strokeStyle = "#111827";
    ctx.strokeRect(x, y, cutWidth, cutHeight);

    ctx.fillStyle = "#111827";
    ctx.fillText(`#${cut.id}`, x + 6, y + 6);
    ctx.fillText(`${cut.width} x ${cut.height}`, x + 6, y + 22);
  });
}

function fillColor(index: number) {
  const palette = [
    "#ffffff",
  ];

  return palette[index % palette.length];
}

export default App;
