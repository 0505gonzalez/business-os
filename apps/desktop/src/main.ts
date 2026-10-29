import { app, BrowserWindow, net, protocol, ipcMain, shell } from "electron";
import { createClerkBridge } from "@clerk/electron";
import { storage } from "@clerk/electron/storage";
import { fork, spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
const require = createRequire(import.meta.url),
  scheme = "business-os";
let window: BrowserWindow, worker: ChildProcess | undefined;
const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    child: ChildProcess;
  }
>();
const clerk = createClerkBridge({
  storage: storage(),
  renderer: { scheme, host: "renderer" },
});
function trusted(event: Electron.IpcMainInvokeEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !event.senderFrame.url.startsWith("business-os://renderer/")
  )
    throw new Error("Untrusted caller");
}
function agent() {
  if (worker) return worker;
  worker = fork(path.join(import.meta.dirname, "agent-worker.mjs"), [], {
    execPath: process.execPath,
    execArgv: [],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const child = worker;
  child.stdout?.resume();
  child.stderr?.resume();
  child.on("message", (message: any) => {
    if (message.event && worker === child)
      window?.webContents.send("business:agent-event", message.event);
    const request = pending.get(message.id);
    if (request) {
      clearTimeout(request.timer);
      pending.delete(message.id);
      message.error
        ? request.reject(new Error(message.error))
        : request.resolve(message.result);
    }
  });
  child.on("exit", () => {
    if (worker === child) worker = undefined;
    for (const [id, request] of pending) {
      if (request.child !== child) continue;
      clearTimeout(request.timer);
      request.reject(new Error("Agent process stopped"));
      pending.delete(id);
    }
  });
  return worker;
}
function send(message: Record<string, unknown>) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Agent request timed out"));
    }, 600000);
    const child = agent();
    pending.set(id, { resolve, reject, timer, child });
    child.send({ ...message, id });
  });
}
function claudeAuth(action: "login" | "status") {
  const cli = require.resolve(
    `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/${process.platform === "win32" ? "claude.exe" : "claude"}`,
  );
  return new Promise((resolve, reject) => {
    const processChild = spawn(cli, ["auth", action], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    processChild.stderr.on("data", (chunk) => {
      errorOutput = (errorOutput + chunk.toString()).slice(-4000);
    });
    processChild.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (action === "login") {
        const url = chunk
          .toString()
          .match(/https:\/\/[^\s]+/g)
          ?.find((candidate: string) => {
            try {
              return [
                "claude.ai",
                "platform.claude.com",
                "console.anthropic.com",
              ].includes(new URL(candidate).hostname);
            } catch {
              return false;
            }
          });
        if (url) void shell.openExternal(url);
      }
    });
    processChild.on("error", reject);
    processChild.on("close", (code) => {
      if (action === "status") {
        try {
          resolve(JSON.parse(output));
        } catch {
          reject(new Error("Claude returned an invalid authentication status"));
        }
      } else
        code === 0
          ? resolve({ ok: true })
          : reject(
              new Error(
                `Claude sign-in did not complete (exit ${code ?? "signal"}). ${errorOutput.replace(/https?:\/\/\S+/g, "[authentication URL]").trim()}`,
              ),
            );
    });
  });
}
ipcMain.handle("business:configure", async (event, raw) => {
  trusted(event);
  const config = z
    .object({
      token: z.string().min(1),
      workspaceId: z.uuid(),
      userId: z.string().min(1),
      apiUrl: z.url(),
    })
    .parse(raw);
  return send({
    type: "configure",
    ...config,
    directory: path.join(app.getPath("userData"), "agents"),
  });
});
ipcMain.handle("business:chat", (event, text) => {
  trusted(event);
  return send({
    type: "chat",
    text: z.string().min(1).max(100000).parse(text),
  });
});
ipcMain.handle("business:context", (event, context) => {
  trusted(event);
  agent().send({
    type: "context",
    context: z
      .object({
        page: z.string(),
        id: z.string().optional(),
        selection: z.string().max(20000).optional(),
      })
      .parse(context),
  });
});
ipcMain.handle("business:resume", (event) => {
  trusted(event);
  worker?.send({ type: "resume" });
});
ipcMain.handle("business:stop", (event) => {
  trusted(event);
  worker?.send({ type: "stop" });
});
ipcMain.handle("business:disconnect", (event) => {
  trusted(event);
  worker?.kill();
  worker = undefined;
});
ipcMain.handle("business:claude-status", (event) => {
  trusted(event);
  return claudeAuth("status");
});
ipcMain.handle("business:claude-login", (event) => {
  trusted(event);
  return claudeAuth("login");
});
if (clerk.isPrimaryInstance) {
  void app
    .whenReady()
    .then(async () => {
      const root = path.resolve(import.meta.dirname, "renderer");
      protocol.handle(scheme, (request) => {
        const url = new URL(request.url);
        if (url.host !== "renderer")
          return new Response("Not found", { status: 404 });
        const file = path.resolve(
          root,
          "." +
            decodeURIComponent(
              url.pathname === "/" ? "/index.html" : url.pathname,
            ),
        );
        if (!file.startsWith(root + path.sep))
          return new Response("Forbidden", { status: 403 });
        return net.fetch(pathToFileURL(file).toString());
      });
      window = new BrowserWindow({
        width: 1320,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        title: "Business OS",
        backgroundColor: "#ffffff",
        ...(process.platform === "darwin"
          ? {
              titleBarStyle: "hiddenInset" as const,
              trafficLightPosition: { x: 14, y: 14 },
            }
          : {}),
        webPreferences: {
          preload: path.join(import.meta.dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      window.webContents.setWindowOpenHandler(({ url }) => {
        // Only user-initiated links in the renderer reach this handler.
        if (new URL(url).protocol === "https:") void shell.openExternal(url);
        return { action: "deny" };
      });
      window.webContents.on("will-navigate", (event, url) => {
        if (!url.startsWith("business-os://renderer/")) event.preventDefault();
      });
      await window.loadURL("business-os://renderer/");
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
}
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  worker?.kill();
  clerk.cleanup();
});
