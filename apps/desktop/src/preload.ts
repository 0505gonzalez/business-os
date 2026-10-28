import { contextBridge, ipcRenderer } from "electron";
import { exposeClerkBridge } from "@clerk/electron/preload";
exposeClerkBridge();
contextBridge.exposeInMainWorld("businessOS", {
  configure: (config: unknown) =>
    ipcRenderer.invoke("business:configure", config),
  chat: (text: string) => ipcRenderer.invoke("business:chat", text),
  context: (context: unknown) =>
    ipcRenderer.invoke("business:context", context),
  resume: () => ipcRenderer.invoke("business:resume"),
  stop: () => ipcRenderer.invoke("business:stop"),
  disconnect: () => ipcRenderer.invoke("business:disconnect"),
  claudeStatus: () => ipcRenderer.invoke("business:claude-status"),
  claudeLogin: () => ipcRenderer.invoke("business:claude-login"),
  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on("business:agent-event", listener);
    return () => ipcRenderer.removeListener("business:agent-event", listener);
  },
});
