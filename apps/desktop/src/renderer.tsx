import { Workbench } from "./workbench.js";
export { Workbench } from "./workbench.js";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  ClerkProvider,
  SignIn,
  useAuth,
  useUser,
  UserButton,
} from "@clerk/electron/react";
import { ApiClient } from "../../../packages/api-client/src/index.js";
import { commandSchema } from "../../../packages/contracts/src/index.js";
import "./style.css";
const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
type Row = Record<string, any>;
function Authenticated() {
  const auth = useAuth();
  const { user } = useUser();
  const client = useMemo(
    () =>
      new ApiClient(apiUrl, async () => {
        const token = await auth.getToken();
        if (!token) throw new Error("Sign in required");
        return token;
      }),
    [auth.getToken],
  );
  useEffect(() => {
    if (user)
      void client
        .request("/profile", "PUT", {
          displayName:
            user.fullName ||
            user.username ||
            user.primaryEmailAddress?.emailAddress ||
            "Team member",
        })
        .catch(() => {});
  }, [user?.id, user?.fullName, client]);
  if (!auth.isLoaded)
    return <div className="center">Loading your workspace…</div>;
  if (!auth.isSignedIn)
    return (
      <div className="center">
        <div>
          <h1>Business OS</h1>
          <p>A shared place to move work forward.</p>
          <SignIn routing="hash" />
        </div>
      </div>
    );
  return (
    <Workspace client={client} userId={auth.userId!} getToken={auth.getToken} />
  );
}
function Workspace({
  client,
  userId,
  getToken,
}: {
  client: ApiClient;
  userId: string;
  getToken: () => Promise<string | null>;
}) {
  const [workspaces, setWorkspaces] = useState<Row[]>([]),
    [workspace, setWorkspace] = useState(""),
    [name, setName] = useState(""),
    [invite, setInvite] = useState(""),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [agentReady, setAgentReady] = useState(false),
    [skipConnection, setSkipConnection] = useState(false),
    [loading, setLoading] = useState(true),
    [showJoin, setShowJoin] = useState(false);
  const refresh = useCallback(async () => {
    const list = await client.request<Row[]>("/workspaces");
    setWorkspaces(list);
    setWorkspace((old) =>
      list.some((w) => w.id === old) ? old : list[0]?.id || "",
    );
  }, [client]);
  useEffect(() => {
    void refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    return () => {
      void window.businessOS?.disconnect();
    };
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => void refresh().catch(() => {}), 15000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!workspace || !window.businessOS) return;
    void window.businessOS
      .claudeStatus()
      .then((s) => setConnected(s.loggedIn))
      .catch((e) => setError(e.message));
  }, [workspace]);
  useEffect(() => {
    setAgentReady(false);
    if (!workspace || !connected || !window.businessOS) return;
    let disposed = false;
    const configure = async () => {
      const token = await getToken();
      if (!token) throw new Error("Sign in again to connect your agent");
      if (!disposed) {
        await window.businessOS.configure({
          token,
          workspaceId: workspace,
          userId,
          apiUrl,
        });
        if (!disposed) setAgentReady(true);
      }
    };
    void configure().catch((e) => setError(e.message));
    const timer = setInterval(
      () => void configure().catch((e) => setError(e.message)),
      30000,
    );
    return () => {
      disposed = true;
      clearInterval(timer);
      void window.businessOS.disconnect();
    };
  }, [workspace, connected, userId, getToken]);
  async function action(fn: () => Promise<unknown>) {
    try {
      setError("");
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (loading) return <div className="center">Loading workspaces…</div>;
  if (!workspace || showJoin)
    return (
      <div className="center">
        <div className="onboard">
          <h1>Your company’s workspace</h1>
          {workspace && (
            <button onClick={() => setShowJoin(false)}>
              Back to workspace
            </button>
          )}
          <p>Create a workspace or join your team.</p>
          {error && <div role="alert">{error}</div>}
          <label>
            Company name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button
            className="primary"
            disabled={!name.trim()}
            onClick={() =>
              void action(async () => {
                const w = await client.request("/workspaces", "POST", { name });
                setWorkspace(w.id);
                setShowJoin(false);
              })
            }
          >
            Create workspace
          </button>
          <hr />
          <label>
            Invitation code
            <input value={invite} onChange={(e) => setInvite(e.target.value)} />
          </label>
          <button
            disabled={!invite.trim()}
            onClick={() =>
              void action(async () => {
                const result = await client.request(
                  "/invitations/accept",
                  "POST",
                  { token: invite.trim() },
                );
                setWorkspace(result.workspaceId);
                setInvite("");
                setShowJoin(false);
              })
            }
          >
            Join workspace
          </button>
          <UserButton />
        </div>
      </div>
    );
  if (!connected && !skipConnection)
    return (
      <div className="center">
        <div className="onboard">
          <span className="eyebrow">YOUR AI SUBSCRIPTION</span>
          <h1>Connect your agent</h1>
          <p>
            Use your Claude subscription on this computer. Your company’s memory
            stays in its workspace.
          </p>
          {error && <div role="alert">{error}</div>}
          <button
            className="provider"
            onClick={() =>
              void action(async () => {
                if (!window.businessOS)
                  throw new Error(
                    "Open Business OS in Electron to connect Claude",
                  );
                await window.businessOS.claudeLogin();
                const status = await window.businessOS.claudeStatus();
                setConnected(status.loggedIn);
              })
            }
          >
            <strong>Claude</strong>
            <span>Connect your subscription ↗</span>
          </button>
          <button className="provider" disabled>
            <strong>Codex</strong>
            <span>Coming next</span>
          </button>
          <button className="quiet" onClick={() => setSkipConnection(true)}>
            Browse workspace first
          </button>
          <UserButton />
        </div>
      </div>
    );
  return (
    <Workbench
      key={workspace}
      client={client}
      agentReady={agentReady}
      agentConnectionError={error}
      workspaceId={workspace}
      userId={userId}
      workspaceName={
        workspaces.find((w) => w.id === workspace)?.name ?? "Workspace"
      }
      role={workspaces.find((w) => w.id === workspace)?.role}
      workspacePicker={
        <>
          <select
            aria-label="Workspace"
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button className="quiet" onClick={() => setShowJoin(true)}>
            Join workspace
          </button>
        </>
      }
      account={<UserButton />}
    />
  );
}
const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    key ? (
      <ClerkProvider publishableKey={key}>
        <Authenticated />
      </ClerkProvider>
    ) : (
      <div className="center">
        <div className="onboard">
          <h1>Business OS</h1>
          <p>
            This installation needs its Clerk publishable key. Configure the
            desktop environment and rebuild the app to enable sign-in.
          </p>
        </div>
      </div>
    ),
  );
