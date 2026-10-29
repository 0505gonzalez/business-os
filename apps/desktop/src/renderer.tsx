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
import { Icon } from "./icons.js";
import { WorkspaceSwitcher } from "./shell.js";
import "./style.css";
const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
type Row = Record<string, any>;
function Loading({ text }: { text: string }) {
  return (
    <div className="center">
      <div className="loading" role="status">
        <span className="spinner" aria-hidden="true" />
        {text}
      </div>
    </div>
  );
}
function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Icon name="logo" size={18} strokeWidth={2} />
    </span>
  );
}
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
  if (!auth.isLoaded) return <Loading text="Loading your workspace…" />;
  if (!auth.isSignedIn)
    return (
      <div className="center">
        <div className="onboard">
          <BrandMark />
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
  if (loading) return <Loading text="Loading workspaces…" />;
  if (!workspace || showJoin)
    return (
      <div className="center">
        <div className="onboard">
          <BrandMark />
          <h1>Your company’s workspace</h1>
          <p>Create a workspace or join your team.</p>
          {error && <div role="alert">{error}</div>}
          <div className="form">
            <label>
              Company name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button
              className="btn primary"
              disabled={!name.trim()}
              onClick={() =>
                void action(async () => {
                  const w = await client.request("/workspaces", "POST", {
                    name,
                  });
                  setWorkspace(w.id);
                  setShowJoin(false);
                })
              }
            >
              Create workspace
            </button>
          </div>
          <hr />
          <div className="form">
            <label>
              Invitation code
              <input
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
              />
            </label>
            <button
              className="btn"
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
              <Icon name="log-in" size={15} />
              Join workspace
            </button>
          </div>
          <div className="onboard-foot">
            {workspace ? (
              <button
                className="btn ghost sm"
                onClick={() => setShowJoin(false)}
              >
                <Icon name="arrow-left" size={15} />
                Back to workspace
              </button>
            ) : (
              <span />
            )}
            <UserButton />
          </div>
        </div>
      </div>
    );
  if (!connected && !skipConnection)
    return (
      <div className="center">
        <div className="onboard">
          <BrandMark />
          <span className="eyebrow">Your AI subscription</span>
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
            <span>
              Connect your subscription
              <Icon name="arrow-up-right" size={14} />
            </span>
          </button>
          <button className="provider" disabled>
            <strong>Codex</strong>
            <span>Coming next</span>
          </button>
          <div className="onboard-foot">
            <button
              className="btn ghost sm"
              onClick={() => setSkipConnection(true)}
            >
              Browse workspace first
              <Icon name="chevron-right" size={15} />
            </button>
            <UserButton />
          </div>
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
        <WorkspaceSwitcher
          workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
          value={workspace}
          onChange={setWorkspace}
          onJoin={() => setShowJoin(true)}
        />
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
          <BrandMark />
          <h1>Business OS</h1>
          <p>
            This installation needs its Clerk publishable key. Configure the
            desktop environment and rebuild the app to enable sign-in.
          </p>
        </div>
      </div>
    ),
  );
