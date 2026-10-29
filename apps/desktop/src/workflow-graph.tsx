import React, { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons.js";
import { modKey } from "./shell.js";
type Row = Record<string, any>;
type Transform = { x: number; y: number; k: number };
const PAD = 32;
const EDGE = 64;
const LANE_H = 140;
const TITLE_W = 248;
const GAP = 56;
const STEP = 124;
const MIN_K = 0.35;
const MAX_K = 2;
const FIT_MIN_K = 0.75;
export const adrStages = ["classification", "review", "completed"];
export const featureStages = [
  "interview",
  "createMap",
  "exploration",
  "synthesis",
  "classification",
  "review",
  "technicalInterview",
  "design",
  "peerReview",
  "completed",
];
function spaced(value: string) {
  const text = value
    .replace(/([A-Z])/g, " $1")
    .replaceAll("_", " ")
    .trim();
  return text ? text[0]!.toUpperCase() + text.slice(1).toLowerCase() : text;
}
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));
/* Workflows drawn as lanes on a pannable, zoomable canvas: a title node,
   then each stage as a connected step with the current one highlighted. */
export function WorkflowGraph({
  rows,
  tasks,
  selected,
  onSelect,
  compact = false,
}: {
  rows: Row[];
  tasks: Row[];
  selected?: string;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [t, setT] = useState<Transform>({ x: PAD, y: PAD, k: 1 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(
    null,
  );
  const lanes = rows.map((row, i) => {
    const stages = row.kind === "adr" ? adrStages : featureStages;
    return {
      row,
      id: row.id,
      y: i * LANE_H,
      stages,
      current: stages.indexOf(row.stage),
      pending: tasks.filter((task) => task.run_id === row.id).length,
    };
  });
  const maxSteps = Math.max(0, ...lanes.map((l) => l.stages.length));
  const width = TITLE_W + GAP + Math.max(0, maxSteps - 1) * STEP + 96;
  const height = Math.max(1, lanes.length) * LANE_H;
  /* Fit to width at a readable scale; taller graphs are panned, not shrunk. */
  const fit = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    const k = clamp(
      Math.min((el.clientWidth - EDGE * 2) / width, 1),
      FIT_MIN_K,
      MAX_K,
    );
    setT({
      k,
      x: Math.max(EDGE, (el.clientWidth - width * k) / 2),
      y: Math.max(PAD + PAD / 2, (el.clientHeight - height * k) / 2),
    });
  }, [width, height]);
  useEffect(fit, [fit, rows.length]);
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = viewport.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = cx === undefined ? rect.width / 2 : cx - rect.left;
    const py = cy === undefined ? rect.height / 2 : cy - rect.top;
    setT((prev) => {
      const k = clamp(prev.k * factor, MIN_K, MAX_K);
      const ratio = k / prev.k;
      return {
        k,
        x: px - (px - prev.x) * ratio,
        y: py - (py - prev.y) * ratio,
      };
    });
  }, []);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey)
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      else
        setT((prev) => ({
          ...prev,
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);
  return (
    <div
      className={"graph" + (compact ? " compact" : "")}
      style={{
        height: compact
          ? undefined
          : `clamp(260px, ${height + PAD * 3}px, min(56vh, 640px))`,
      }}
    >
      <div
        className="graph-viewport"
        ref={viewport}
        role="group"
        aria-label="Workflow canvas"
        style={{
          backgroundSize: `${24 * t.k}px ${24 * t.k}px`,
          backgroundPosition: `${t.x}px ${t.y}px`,
        }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          drag.current = { px: e.clientX, py: e.clientY, x: t.x, y: t.y };
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.classList.add("dragging");
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          setT((prev) => ({
            ...prev,
            x: d.x + (e.clientX - d.px),
            y: d.y + (e.clientY - d.py),
          }));
        }}
        onPointerUp={(e) => {
          drag.current = null;
          e.currentTarget.classList.remove("dragging");
        }}
        onPointerCancel={(e) => {
          drag.current = null;
          e.currentTarget.classList.remove("dragging");
        }}
      >
        <div
          className="graph-layer"
          style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})` }}
        >
          {lanes.map((lane) => {
            const trackWidth = GAP + (lane.stages.length - 1) * STEP;
            const doneWidth =
              lane.current <= 0
                ? 0
                : GAP + (lane.current - 1) * STEP + STEP / 2;
            return (
              <div
                className="graph-lane"
                key={lane.id}
                style={{ top: lane.y, width: TITLE_W + trackWidth }}
              >
                <button
                  className={
                    "graph-node" +
                    (selected === lane.id ? " active" : "") +
                    (lane.pending ? " pending" : "")
                  }
                  onClick={() => onSelect(lane.id)}
                >
                  <div className="node-head">
                    <span className="eyebrow">
                      {lane.row.kind === "adr"
                        ? "ADR review"
                        : "Feature planning"}
                    </span>
                    <Icon
                      name={lane.row.kind === "adr" ? "file" : "compass"}
                      size={16}
                    />
                  </div>
                  <strong>{lane.row.input?.title ?? lane.row.id}</strong>
                  <small>
                    {lane.pending ? (
                      <span className="tag warning">
                        <Icon name="inbox" size={12} />
                        Needs you
                      </span>
                    ) : lane.row.error ? (
                      <span className="tag danger">Needs attention</span>
                    ) : lane.row.stage === "completed" ? (
                      <span className="tag success">Completed</span>
                    ) : (
                      <span className="tag outline">
                        {spaced(lane.row.stage ?? "")}
                      </span>
                    )}
                  </small>
                </button>
                <div
                  className="graph-track"
                  style={{ left: TITLE_W, width: trackWidth }}
                >
                  <div
                    className="graph-track-done"
                    style={{ width: doneWidth }}
                  />
                  {lane.stages.map((stage, j) => (
                    <div
                      className={
                        "graph-step" +
                        (j < lane.current
                          ? " done"
                          : j === lane.current
                            ? " current"
                            : "")
                      }
                      key={stage}
                      style={{ left: GAP + j * STEP }}
                    >
                      <span className="graph-dot">
                        {j < lane.current && (
                          <Icon name="check" size={10} strokeWidth={3} />
                        )}
                      </span>
                      <span className="graph-label">{spaced(stage)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="graph-controls">
        <button
          className="btn icon sm"
          aria-label="Zoom in"
          onClick={() => zoomAt(1.25)}
        >
          <Icon name="plus" size={15} />
        </button>
        <button
          className="btn icon sm"
          aria-label="Zoom out"
          onClick={() => zoomAt(0.8)}
        >
          <Icon name="minus" size={15} />
        </button>
        <button className="btn icon sm" aria-label="Fit to view" onClick={fit}>
          <Icon name="frame" size={15} />
        </button>
      </div>
      <div className="graph-hint" aria-hidden="true">
        Drag to pan · {modKey} scroll to zoom
      </div>
    </div>
  );
}
