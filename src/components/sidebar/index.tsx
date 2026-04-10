import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import type { SheetConfigFormValues } from "../../types/forms";

export const Sidebar = () => {
  const { control, register } = useFormContext<SheetConfigFormValues>();
  const [sheetWidth = 2440, sheetHeight = 1220] = useWatch({
    control,
    name: ["sheetWidth", "sheetHeight"],
  });
  const { fields, append, remove } = useFieldArray({
    control,
    name: "cuts",
  });

  return (
    <aside className="h-screen overflow-y-auto bg-gray-200 p-4 sticky top-0 left-0">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">Configuration</h2>
        </div>

        <form className="flex flex-col gap-3">
          <div className="input-control">
            <label>Blade thickness</label>
            <div>
              <input
                type="number"
                step="0.1"
                {...register("kerfSize", { valueAsNumber: true })}
              />
              <span className="input-suffix">mm</span>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div className="input-control min-w-0">
              <label>Sheet width</label>
              <div>
                <input
                  type="number"
                  step="0.1"
                  {...register("sheetWidth", { valueAsNumber: true })}
                />
                <span className="input-suffix">mm</span>
              </div>
            </div>

            <span className="pb-[10px] text-sm font-semibold text-neutral-500">
              x
            </span>

            <div className="input-control min-w-0">
              <label>Sheet height</label>
              <div>
                <input
                  type="number"
                  step="0.1"
                  {...register("sheetHeight", { valueAsNumber: true })}
                />
                <span className="input-suffix">mm</span>
              </div>
            </div>
          </div>

          <div className="input-control">
            <label>Max sheets</label>
            <div>
              <input
                type="number"
                min="1"
                step="1"
                placeholder="Unlimited"
                {...register("maxSheets", { valueAsNumber: true, min: 1 })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <h3 className="text-sm font-semibold text-neutral-800">Cuts</h3>
            <button
              type="button"
              className="rounded border border-neutral-400 bg-white px-2 py-1 text-xs font-medium text-neutral-700"
              onClick={() => append({ quantity: 1, width: 0, height: 0 })}
            >
              Add row
            </button>
          </div>

          <div className="grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)_4rem] items-start text-left gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            <span>Quantity</span>
            <span>Width</span>
            <span>Height</span>
            <span />
          </div>

          <div className="flex flex-col gap-2">
            {fields.map((field, index) => (
              <div
                key={field.id}
                className="grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)_4rem] items-start gap-2"
              >
                <div className="cut-input">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    max="10"
                    {...register(`cuts.${index}.quantity`, {
                      valueAsNumber: true,
                      max: 10,
                    })}
                  />
                </div>

                <div className="cut-input">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    max={sheetWidth}
                    size={4}
                    className="char-input"
                    {...register(`cuts.${index}.width`, {
                      valueAsNumber: true,
                      max: sheetWidth,
                    })}
                  />
                  <span className="input-suffix">mm</span>
                </div>

                <div className="cut-input">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    max={sheetHeight}
                    size={4}
                    className="char-input"
                    {...register(`cuts.${index}.height`, {
                      valueAsNumber: true,
                      max: sheetHeight,
                    })}
                  />
                  <span className="input-suffix">mm</span>
                </div>

                <button
                  type="button"
                  className="rounded border border-neutral-400 px-2 py-2 text-xs font-medium text-neutral-600 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => remove(index)}
                  disabled={fields.length === 1}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </form>
      </div>
    </aside>
  );
};
