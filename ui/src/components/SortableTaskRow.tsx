import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "antd";
import { HolderOutlined } from "@ant-design/icons";
import { rowDomAttrs, useTaskListScope } from "../lib/visibleRows";
import TaskRow, { type TaskRowProps } from "./TaskRow";

/** Task row wired into the app-level sortable context (design §13.2). */
export default function SortableTaskRow(props: TaskRowProps) {
  const depth = props.depth ?? 0;
  const parentId = props.task.parent_id ?? null;
  // The list this row renders into, so the drag layer can read the visible rows
  // of the list a drop lands in back off the DOM (`lib/visibleRows.ts`).
  const listId = useTaskListScope();

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    // The drop maths needs the row's level and parent to clamp the landing
    // depth, and the list to look up the rows it will be dropped among.
    data: { depth, parentId, listId },
  });

  return (
    <TaskRow
      {...props}
      innerRef={setNodeRef}
      domAttrs={rowDomAttrs(props.task.id, depth, parentId, props.task.section_id)}
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
