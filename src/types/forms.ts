export type CutFormRow = {
  quantity: number;
  width: number;
  height: number;
};

export type SheetConfigFormValues = {
  kerfSize: number;
  sheetWidth: number;
  sheetHeight: number;
  maxSheets?: number;
  cuts: CutFormRow[];
};
