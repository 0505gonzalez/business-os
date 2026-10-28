import React, { useEffect, useState } from "react";
import { ApiClient } from "../../../packages/api-client/src/index.js";
type Member = {
  user_id: string;
  display_name: string;
  role: string;
  joined_at: string;
};
type Invitation = {
  id: string;
  label: string;
  role: string;
  status: string;
  expires_at: string;
};
export function Team({
  client,
  base,
  userId,
  role,
}: {
  client: ApiClient;
  base: string;
  userId: string;
  role: string;
}) {
  const [members, setMembers] = useState<Member[]>([]),
    [invites, setInvites] = useState<Invitation[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [loaded, setLoaded] = useState(false),
    [label, setLabel] = useState(""),
    [inviteRole, setInviteRole] = useState("engineer"),
    [days, setDays] = useState(7),
    [code, setCode] = useState(""),
    [codeId, setCodeId] = useState(""),
    [copied, setCopied] = useState(false),
    [removing, setRemoving] = useState<Member | null>(null),
    [edits, setEdits] = useState<Record<string, string>>({});
  const load = async () => {
    const [m, i] = await Promise.all([
      client.request<Member[]>(`${base}/members`),
      role === "owner"
        ? client.request<Invitation[]>(`${base}/invitations`)
        : Promise.resolve([]),
    ]);
    setMembers(m);
    setInvites(i);
    setLoaded(true);
  };
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, [base, role]);
  if (loading)
    return (
      <article role="status">
        <h3>Loading team…</h3>
        <p>Getting members and invitations.</p>
      </article>
    );
  if (!loaded)
    return (
      <article role="alert">
        <h3>Couldn’t load your team</h3>
        <p>{error}</p>
        <button onClick={() => void refresh()}>Try again</button>
      </article>
    );
  return (
    <div className="team-page">
      {error && (
        <div role="alert" className="team-error">
          {error}
        </div>
      )}
      <article>
        <div className="team-heading">
          <h2>
            Members <small>{members.length}</small>
          </h2>
          <button disabled={busy} onClick={() => void refresh()}>
            Refresh team
          </button>
        </div>
        <p>
          Owners manage membership and invitations. Roles also determine
          workflow reviews.
        </p>
        <datalist id="team-roles">
          {["owner", "ceo", "engineer", "product", "finance", "member"].map(
            (r) => (
              <option key={r} value={r} />
            ),
          )}
        </datalist>
        {members.map((m) => (
          <div className="team-member" key={m.user_id}>
            <div>
              <strong>{m.display_name}</strong>
              {m.user_id === userId && <span className="tag">You</span>}
              <small>Joined {new Date(m.joined_at).toLocaleDateString()}</small>
            </div>
            {role === "owner" ? (
              <>
                <input
                  aria-label={`Role for ${m.display_name}`}
                  list="team-roles"
                  value={edits[m.user_id] ?? m.role}
                  onChange={(e) =>
                    setEdits({ ...edits, [m.user_id]: e.target.value })
                  }
                />
                <button
                  disabled={
                    busy ||
                    !edits[m.user_id]?.trim() ||
                    edits[m.user_id] === m.role
                  }
                  onClick={() =>
                    void act(async () => {
                      await client.request(
                        `${base}/members/${encodeURIComponent(m.user_id)}`,
                        "PUT",
                        { role: edits[m.user_id] },
                      );
                      setEdits({});
                    })
                  }
                >
                  Save role
                </button>
                <button
                  disabled={
                    busy ||
                    (m.role === "owner" &&
                      members.filter((person) => person.role === "owner")
                        .length === 1)
                  }
                  title={
                    m.role === "owner" &&
                    members.filter((person) => person.role === "owner")
                      .length === 1
                      ? "Add another owner before removing this person"
                      : "Remove this person from the workspace"
                  }
                  onClick={() => setRemoving(m)}
                >
                  Remove
                </button>
              </>
            ) : (
              <span className="tag">{m.role}</span>
            )}
          </div>
        ))}
        {removing && (
          <div
            className="team-confirm"
            role="dialog"
            aria-label="Remove team member"
          >
            <h3>Remove {removing.display_name}?</h3>
            <p>
              They will lose access to this workspace. Their existing invitation
              cannot be reused. Completed work stays in the workspace.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await client.request(
                    `${base}/members/${encodeURIComponent(removing.user_id)}`,
                    "DELETE",
                  );
                  setRemoving(null);
                })
              }
            >
              Confirm removal
            </button>
            <button disabled={busy} onClick={() => setRemoving(null)}>
              Cancel
            </button>
          </div>
        )}
      </article>
      {role === "owner" && (
        <>
          <article>
            <h2>Invite a teammate</h2>
            <p>
              Create a single-use code and share it privately. Anyone with the
              code can join with the selected role.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  const result = await client.request(
                    `${base}/invitations`,
                    "POST",
                    { label, role: inviteRole, expiresInDays: days },
                  );
                  setCode(result.token);
                  setCodeId(result.id);
                  setCopied(false);
                  setLabel("");
                });
              }}
            >
              <div className="team-fields">
                <label>
                  Invitation label
                  <input
                    placeholder="e.g. Alex — engineering"
                    value={label}
                    maxLength={120}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </label>
                <label>
                  Role
                  <input
                    required
                    list="team-roles"
                    value={inviteRole}
                    maxLength={80}
                    onChange={(e) => setInviteRole(e.target.value)}
                  />
                </label>
                <label>
                  Expires in
                  <select
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  >
                    <option value={1}>1 day</option>
                    <option value={7}>7 days</option>
                    <option value={30}>30 days</option>
                  </select>
                </label>
              </div>
              <button className="primary" disabled={busy || !inviteRole.trim()}>
                Create invitation
              </button>
            </form>
            {code && (
              <div className="team-code">
                <label>
                  Invitation code
                  <input
                    readOnly
                    value={code}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
                <button
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(code)
                      .then(() => setCopied(true))
                      .catch(() =>
                        setError(
                          "Select and copy the invitation code manually.",
                        ),
                      );
                  }}
                >
                  {copied ? "Copied" : "Copy code"}
                </button>
                <p>
                  Ask your teammate to open Business OS, sign in with Google,
                  choose “Join workspace,” and paste this code. The code is
                  shown only here; create a new one if you lose it.
                </p>
              </div>
            )}
          </article>
          <article>
            <h2>Invitations</h2>
            {!invites.length && <p>No invitations yet.</p>}
            {invites.map((i) => (
              <div className="team-member" key={i.id}>
                <div>
                  <strong>{i.label || "Workspace invitation"}</strong>
                  <small>
                    {i.role} · Expires{" "}
                    {new Date(i.expires_at).toLocaleDateString()}
                  </small>
                </div>
                <span className="tag">{i.status}</span>
                {i.status === "pending" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await client.request(
                          `${base}/invitations/${i.id}`,
                          "DELETE",
                        );
                        if (codeId === i.id) setCode("");
                      })
                    }
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </article>
        </>
      )}
    </div>
  );
}
