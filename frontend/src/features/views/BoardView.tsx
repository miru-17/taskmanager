import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useTasks, useUpdateTask } from "../../data/queries";
import { getErrorMessage } from "../../data/errors";
import { STATUSES, STATUS_LABELS, type Task, type TaskStatus } from "../../types/Task";
import { ErrorState, IconButton, Spinner, StatusIcon } from "../../ui";
import { cx } from "../../ui/cx";
import { TaskCardBody } from "../tasks/TaskBits";
import { useComposer, useTaskParam } from "../tasks/composer";
import { useProjectOutlet } from "../projects/ProjectLayout";
import { canEditTask } from "./permissions";
import { positionAt } from "./logic";

type Columns = Record<TaskStatus, Task[]>;

const group = (tasks: Task[]): Columns => {
  const cols = Object.fromEntries(STATUSES.map((s) => [s, [] as Task[]])) as unknown as Columns;
  for (const t of tasks) cols[t.status].push(t);
  for (const s of STATUSES) cols[s].sort((a, b) => a.position - b.position || a.id - b.id);
  return cols;
};


const Card = ({ task, draggable, onOpen }: { task: Task; draggable: boolean; onOpen: () => void }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: !draggable });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // A card you can't move is just a button: no drag attributes (they'd announce it as "disabled")
      {...(draggable ? { ...attributes, ...listeners } : { role: "button", tabIndex: 0 })}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (!draggable) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
          return;
        }
        // Space/Enter are taken by dnd-kit for keyboard dragging; "o" opens the task
        if (e.key === "o") onOpen();
        listeners?.onKeyDown?.(e);
      }}
      aria-label={`${task.key} ${task.title}`}
      aria-roledescription={draggable ? "draggable task" : undefined}
      className={cx(
        "rounded-lg border border-line bg-surface p-3 shadow-card transition-shadow hover:border-line-strong",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        isDragging && "opacity-40"
      )}
    >
      <TaskCardBody task={task} />
    </div>
  );
};

const Column = ({ status, tasks, children, onAdd }: { status: TaskStatus; tasks: Task[]; children: React.ReactNode; onAdd?: () => void }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });
  return (
    <section aria-label={STATUS_LABELS[status]} className="flex w-68 shrink-0 flex-col rounded-xl bg-elev/60">
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <StatusIcon status={status} />
        <h2 className="text-sm font-medium">{STATUS_LABELS[status]}</h2>
        <span className="text-xs text-muted">{tasks.length}</span>
        {onAdd && (
          <IconButton label={`Add task to ${STATUS_LABELS[status]}`} className="ml-auto size-7" onClick={onAdd}>
            <Plus className="size-4" />
          </IconButton>
        )}
      </header>
      <div ref={setNodeRef} className={cx("scroll-thin flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3", isOver && "rounded-lg bg-accent/5")}>
        {children}
      </div>
    </section>
  );
};

const BoardView = () => {
  const { project, filters, readOnly } = useProjectOutlet();
  const { user } = useAuth();
  const { openTask } = useTaskParam();
  const { open } = useComposer();
  const update = useUpdateTask();
  const { data, isPending, isError, error, refetch } = useTasks({ ...filters, status: undefined, sort: "position", limit: 500 });

  const [columns, setColumns] = useState<Columns>(() => group([]));
  const [activeId, setActiveId] = useState<number | null>(null);
  const [origin, setOrigin] = useState<TaskStatus | null>(null);

  // Server data is the source of truth except while a card is in the air
  useEffect(() => {
    if (activeId === null && data) setColumns(group(data.items));
  }, [data, activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), // a click still opens the card
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const caps = project.capabilities;
  const canDrag = (t: Task) => project.status !== "ARCHIVED" && canEditTask(caps, user?.id, t);
  const findColumn = (id: number | string): TaskStatus | null => {
    if (typeof id === "string" && id.startsWith("col:")) return id.slice(4) as TaskStatus;
    return STATUSES.find((s) => columns[s].some((t) => t.id === id)) ?? null;
  };
  const active = useMemo(() => (activeId === null ? null : STATUSES.flatMap((s) => columns[s]).find((t) => t.id === activeId) ?? null), [activeId, columns]);

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(Number(e.active.id));
    setOrigin(findColumn(e.active.id));
  };

  // Moving across columns while dragging so the card visibly lands in the new one
  const onDragOver = ({ active: a, over }: DragOverEvent) => {
    if (!over) return;
    const from = findColumn(a.id);
    const to = findColumn(over.id);
    if (!from || !to || from === to) return;
    setColumns((cols) => {
      const moving = cols[from].find((t) => t.id === a.id);
      if (!moving) return cols;
      const target = cols[to].filter((t) => t.id !== a.id);
      const overIndex = target.findIndex((t) => t.id === over.id);
      target.splice(overIndex < 0 ? target.length : overIndex, 0, { ...moving, status: to });
      return { ...cols, [from]: cols[from].filter((t) => t.id !== a.id), [to]: target };
    });
  };

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    const id = Number(a.id);
    const to = over ? findColumn(over.id) : null;
    if (!to || !origin) {
      setActiveId(null);
      return;
    }
    const list = [...columns[to]];
    const from = list.findIndex((t) => t.id === id);
    let index = list.findIndex((t) => t.id === over!.id);
    if (index < 0) index = from;
    if (from !== index) {
      const [m] = list.splice(from, 1);
      list.splice(index, 0, m);
    }
    const original = data?.items.find((t) => t.id === id);
    const position = positionAt(list, index);
    setColumns((cols) => ({ ...cols, [to]: list.map((t) => (t.id === id ? { ...t, position, status: to } : t)) }));
    setActiveId(null);
    if (!original || (original.status === to && original.position === position)) return;
    update.mutate({ id, input: to !== original.status ? { status: to, position } : { position } });
  };

  if (isPending) return <Spinner />;
  if (isError) return <div className="p-6"><ErrorState message={getErrorMessage(error, "Couldn't load tasks")} onRetry={() => refetch()} /></div>;

  return (
    <div className="h-full overflow-x-auto scroll-thin">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
        accessibility={{
          announcements: {
            onDragStart: ({ active: a }) => `Picked up task ${a.id}.`,
            onDragOver: ({ over }) => (over ? `Over ${String(over.id).startsWith("col:") ? STATUS_LABELS[String(over.id).slice(4) as TaskStatus] : "another task"}.` : "Not over a column."),
            onDragEnd: ({ over }) => (over ? "Dropped." : "Dropped outside the board; nothing changed."),
            onDragCancel: () => "Cancelled; nothing changed.",
          },
        }}
      >
        <div className="flex h-full min-h-[24rem] gap-3 p-4 sm:px-6">
          {STATUSES.map((s) => (
            <Column key={s} status={s} tasks={columns[s]} onAdd={readOnly ? undefined : () => open({ projectId: project.id, status: s })}>
              <SortableContext items={columns[s].map((t) => t.id)} strategy={verticalListSortingStrategy}>
                {columns[s].map((t) => (
                  <Card key={t.id} task={t} draggable={canDrag(t)} onOpen={() => openTask(t.id)} />
                ))}
              </SortableContext>
              {columns[s].length === 0 && <p className="px-2 py-6 text-center text-xs text-muted">No tasks</p>}
            </Column>
          ))}
        </div>
        <DragOverlay>
          {active && (
            <div className="w-64 rotate-1 rounded-lg border border-line-strong bg-surface p-3 shadow-pop">
              <TaskCardBody task={active} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {data.total > data.items.length && <p className="px-6 pb-4 text-xs text-muted">Showing {data.items.length} of {data.total} tasks. Use filters or the List view to see the rest.</p>}
    </div>
  );
};

export default BoardView;
