import React from "react";
type Row = Record<string, any>;
export function PlanningMapView({ map }: { map: Row }) {
  return (
    <div>
      <h3>Exploration map</h3>
      {[
        "destination",
        "acceptanceCriteria",
        "notes",
        "decisions",
        "suspectedDecisions",
        "ruledOut",
      ].map((key) => (
        <div key={key}>
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
          <p>Depends on: {q.blockedBy.join(", ") || "Nothing"}</p>
          <div className="prose">{q.result ?? "Awaiting work"}</div>
        </details>
      ))}
    </div>
  );
}
