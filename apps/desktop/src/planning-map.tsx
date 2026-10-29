import React from "react";
import { Icon } from "./icons.js";
type Row = Record<string, any>;
const sections = [
  "destination",
  "acceptanceCriteria",
  "notes",
  "decisions",
  "suspectedDecisions",
  "ruledOut",
];
export function PlanningMapView({ map }: { map: Row }) {
  return (
    <div className="planning-map">
      <h3>
        <Icon name="compass" size={16} />
        Exploration map
      </h3>
      {sections.map((key) => (
        <div className="map-section" key={key}>
          <h4>{key.replace(/([A-Z])/g, " $1")}</h4>
          <div className="prose">
            {Array.isArray(map[key]) ? map[key].join("\n") : map[key]}
          </div>
        </div>
      ))}
      {map.questions?.map((q: Row) => (
        <details key={q.id}>
          <summary>
            {q.kind} · {q.title}
          </summary>
          <p className="muted">
            Depends on: {q.blockedBy.join(", ") || "Nothing"}
          </p>
          <div className="prose">{q.result ?? "Awaiting work"}</div>
        </details>
      ))}
    </div>
  );
}
