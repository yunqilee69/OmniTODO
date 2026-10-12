import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
      className={isDragging ? "bg-neutral-50 opacity-40" : ""}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
      }}
      handle={
        <button
          type="button"
          className="shrink-0 cursor-grab text-neutral-300 hover:text-neutral-500"
          aria-label="拖动排序"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      }
    />
  );
}
