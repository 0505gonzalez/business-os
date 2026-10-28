import React from "react";
import { ApiClient } from "../../../packages/api-client/src/index.js";
export function Settings({
  client,
  base,
  role,
  act,
}: {
  client: ApiClient;
  base: string;
  role: string;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <div className="settings">
      <article>
        <h3>Brain index</h3>
        <p>Rebuild the searchable index from authoritative bucket revisions.</p>
        {role === "owner" && (
          <button
            onClick={() =>
              void act(() =>
                client.request(`${base}/memory/reindex`, "POST", {}),
              )
            }
          >
            Rebuild index
          </button>
        )}
      </article>
    </div>
  );
}
