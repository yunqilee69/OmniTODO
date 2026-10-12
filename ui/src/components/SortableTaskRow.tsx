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
      className={isDragging ? "opacity-50" : ""}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
      }}
      handle={
        <Button
          type="text"
          size="small"
          aria-label="拖动排序"
          className="cursor-grab opacity-0 group-hover:opacity-100 active:cursor-grabbing"
          style={{ color: "inherit" }}
          icon={<HolderOutlined />}
          {...attributes}
          {...listeners}
        />
      }
    />
  );
}
