/// <reference types="vite/client" />
import type { AgentEvent } from "../../../packages/contracts/src/index.js";
declare global {
  interface Window {
    businessOS: {
      configure: (config: {
        token: string;
        workspaceId: string;
        userId: string;
        apiUrl: string;
      }) => Promise<void>;
      chat: (text: string) => Promise<{ text: string }>;
      context: (context: unknown) => Promise<void>;
      resume: () => Promise<void>;
      stop: () => Promise<void>;
      disconnect: () => Promise<void>;
      claudeStatus: () => Promise<{ loggedIn: boolean; authMethod?: string }>;
      claudeLogin: () => Promise<void>;
      onEvent: (callback: (event: AgentEvent) => void) => () => void;
    };
  }
}
