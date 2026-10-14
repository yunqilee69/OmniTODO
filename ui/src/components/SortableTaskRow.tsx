import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "antd";
import { HolderOutlined } from "@ant-design/icons";
import TaskRow, { type TaskRowProps } from "./TaskRow";

/** Task row wired into the app-level sortable context (design §13.2). */
export default function SortableTaskRow(props: TaskRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
  });

  return (
    <TaskRow
      {...props}
      innerRef={setNodeRef}
      // `is-dragging` keeps the hover-only handle showing for the whole drag,
      // not just while the pointer happens to be over the row.
      className={isDragging ? "is-dragging opacity-50" : ""}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
      }}
      handle={
        <Button
          type="text"
          size="small"
          aria-label="拖动排序"
          className="row-action cursor-grab active:cursor-grabbing"
          style={{
            padding: 0,
            width: 16,
            height: 16,
            minWidth: 16,
            color: "var(--text-tertiary)",
          }}
          icon={<HolderOutlined />}
          {...attributes}
          {...listeners}
        />
      }
    />
  );
}
