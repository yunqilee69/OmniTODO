import { Button, Popover } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import { useState } from "react";
import { PROJECT_COLORS } from "../lib/projectColors";

/**
 * Picks the colour a project is drawn in (design §3.2 / §13.1).
 *
 * A grid of ten swatches behind a real button, rather than antd's `ColorPicker`:
 * the project colour is a choice from a fixed palette (see `lib/projectColors.ts`
 * for why), and the wheel's trigger is a plain `div` — not focusable, so a
 * keyboard user could not open it at all (DESIGN §13).
 *
 * The button itself is the current colour, which is where the eye already is:
 * the same dot appears beside the project's name in the rail.
 */
export default function ProjectColorPicker({
  value,
  onChange,
  label = "项目颜色",
}: {
  value: string;
  onChange: (color: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomLeft"
      content={
        <div role="radiogroup" aria-label={label} className="grid grid-cols-5 gap-1.5">
          {PROJECT_COLORS.map((color) => {
            const selected = color.toLowerCase() === value.toLowerCase();
            return (
              <Button
                key={color}
                type="text"
                role="radio"
                aria-checked={selected}
                aria-label={`颜色 ${color}`}
                title={color}
                onClick={() => {
                  onChange(color);
                  setOpen(false);
                }}
                style={{ width: 26, height: 26, minWidth: 26, padding: 0 }}
                icon={
                  <span
                    className="grid size-4 place-items-center rounded-full"
                    style={{ background: color }}
                  >
                    {selected && (
                      <CheckOutlined style={{ color: "#fff", fontSize: 10 }} aria-hidden="true" />
                    )}
                  </span>
                }
              />
            );
          })}
        </div>
      }
    >
      <Button
        size="small"
        aria-label={label}
        title={value}
        style={{ width: 26, height: 26, minWidth: 26, padding: 0 }}
        icon={<span className="size-3.5 rounded-full" style={{ background: value }} />}
      />
    </Popover>
  );
}
