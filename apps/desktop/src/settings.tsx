import React from "react";
import { ApiClient } from "../../../packages/api-client/src/index.js";
import { Icon } from "./icons.js";
export function Settings({
  client,
  base,
  role,
  act,
  workspaceName,
}: {
  client: ApiClient;
  base: string;
  role: string;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  workspaceName?: string;
}) {
  return (
    <div className="settings">
      <article>
        <h3>Workspace</h3>
        <p>Your shared company workspace and your role in it.</p>
        <dl>
          <dt>Name</dt>
          <dd>{workspaceName ?? "Workspace"}</dd>
          <dt>Your role</dt>
          <dd>{role ? role[0]!.toUpperCase() + role.slice(1) : role}</dd>
        </dl>
      </article>
      <article>
        <h3>Brain index</h3>
        <p>Rebuild the searchable index from authoritative bucket revisions.</p>
        {role === "owner" ? (
          <button
            className="btn"
            onClick={() =>
              void act(() =>
                client.request(`${base}/memory/reindex`, "POST", {}),
              )
            }
          >
            <Icon name="database" size={15} />
            Rebuild index
          </button>
        ) : (
          <p className="muted">Only workspace owners can rebuild the index.</p>
        )}
      </article>
    </div>
  );
}
