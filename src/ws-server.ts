import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { BrowserCommand, BrowserCommandResponse } from "./types.js";
import type { HookEventInput, HookEventName, ChannelPermissionRequest } from "./channel-sdk/types.js";

const DEFAULT_PORT = 21567;
const COMMAND_TIMEOUT_MS = 30_000;
const TALON_DIR = join(homedir(), ".talon");

interface PendingRequest {
  resolve: (value: BrowserCommandResponse["result"]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type ChatHandler = (chatId: string, text: string, context?: Record<string, string>) => void;
type PermissionVerdictHandler = (requestId: string, behavior: "allow" | "deny") => void;

// ─── Client Mode System ─────────────────────────────────────────────────────

/**
 * Modes control what the browser extension sees and can do.
 *
 * - "chat"     : chat only — messages in/out, no hook events, no permissions
 * - "monitor"  : read-only view of all events — hooks, tools, notifications
 * - "full"     : everything — chat + all hooks + permission relay
 * - "custom"   : pick exactly which event categories to receive
 */
export type ClientMode = "chat" | "monitor" | "full" | "custom";

export interface ClientModeConfig {
  mode: ClientMode;
  /** Only used when mode === "custom" */
  enabledCategories?: EventCategory[];
}

/** Event categories the browser can subscribe to */
export type EventCategory =
  | "chat"          // chat messages + replies
  | "tools"         // PreToolUse, PostToolUse, PostToolUseFailure
  | "permissions"   // PermissionRequest + permission relay
  | "session"       // SessionStart, SessionEnd
  | "notifications" // Notification events
  | "subagents"     // SubagentStart, SubagentStop
  | "lifecycle"     // Stop, StopFailure, TeammateIdle, TaskCompleted
  | "filesystem"    // FileChanged, CwdChanged, ConfigChange, InstructionsLoaded
  | "worktree"      // WorktreeCreate, WorktreeRemove
  | "compact"       // PreCompact, PostCompact
  | "elicitation"   // Elicitation, ElicitationResult
  | "prompts";      // UserPromptSubmit

/** Map from category to which hook event names it includes */
const CATEGORY_EVENTS: Record<EventCategory, ReadonlySet<HookEventName>> = {
  chat:          new Set(), // chat is handled separately, not via hook events
  tools:         new Set(["PreToolUse", "PostToolUse", "PostToolUseFailure"]),
  permissions:   new Set(["PermissionRequest"]),
  session:       new Set(["SessionStart", "SessionEnd"]),
  notifications: new Set(["Notification"]),
  subagents:     new Set(["SubagentStart", "SubagentStop"]),
  lifecycle:     new Set(["Stop", "StopFailure", "TeammateIdle", "TaskCompleted"]),
  filesystem:    new Set(["FileChanged", "CwdChanged", "ConfigChange", "InstructionsLoaded"]),
  worktree:      new Set(["WorktreeCreate", "WorktreeRemove"]),
  compact:       new Set(["PreCompact", "PostCompact"]),
  elicitation:   new Set(["Elicitation", "ElicitationResult"]),
  prompts:       new Set(["UserPromptSubmit"]),
};

/** Resolve mode → set of allowed hook event names */
function resolveAllowedEvents(config: ClientModeConfig): Set<HookEventName> | "all" {
  switch (config.mode) {
    case "chat":
      return new Set(); // no hook events, only chat
    case "monitor":
    case "full":
      return "all";
    case "custom": {
      const allowed = new Set<HookEventName>();
      for (const cat of config.enabledCategories ?? []) {
        for (const ev of CATEGORY_EVENTS[cat]) {
          allowed.add(ev);
        }
      }
      return allowed;
    }
  }
}

/** Check if mode allows permission relay (bidirectional) */
function modeAllowsPermissions(config: ClientModeConfig): boolean {
  if (config.mode === "full") return true;
  if (config.mode === "custom") {
    return config.enabledCategories?.includes("permissions") ?? false;
  }
  return false; // chat and monitor are passive
}

/** Check if mode allows chat (sending messages to Claude) */
function modeAllowsChat(config: ClientModeConfig): boolean {
  if (config.mode === "monitor") return false; // read-only
  if (config.mode === "custom") {
    return config.enabledCategories?.includes("chat") ?? false;
  }
  return true; // chat and full both allow chat
}

// ─── BrowserBridgeServer ─────────────────────────────────────────────────────

export class BrowserBridgeServer {
  private client: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private chatHandler: ChatHandler | null = null;
  private permissionVerdictHandler: PermissionVerdictHandler | null = null;
  private authToken: string;
  private port: number;
  private reusing = false;

  // Mode state
  private clientMode: ClientModeConfig = { mode: "full" };
  private allowedEvents: Set<HookEventName> | "all" = "all";
  private allowsPermissions = true;
  private allowsChat = true;

  constructor(port?: number) {
    this.port = port ?? DEFAULT_PORT;
    this.authToken = randomUUID();
  }

  // ─── Mode API ──────────────────────────────────────────────────────────

  /** Get current client mode */
  getMode(): ClientModeConfig {
    return this.clientMode;
  }

  /** Set client mode — controls what events are forwarded to the browser */
  setMode(config: ClientModeConfig): void {
    this.clientMode = config;
    this.allowedEvents = resolveAllowedEvents(config);
    this.allowsPermissions = modeAllowsPermissions(config);
    this.allowsChat = modeAllowsChat(config);

    process.stderr.write(`[talon-mcp] Mode set to: ${config.mode}\n`);

    // Notify browser of mode change
    this.sendEvent({
      type: "mode_changed",
      mode: config.mode,
      categories: config.enabledCategories ?? [],
      allows_chat: this.allowsChat,
      allows_permissions: this.allowsPermissions,
    });
  }

  /** Check if a hook event should be forwarded to the browser */
  private shouldForwardHook(eventName: HookEventName): boolean {
    if (this.allowedEvents === "all") return true;
    return this.allowedEvents.has(eventName);
  }

  // ─── Connection ────────────────────────────────────────────────────────

  /** Check if an existing talon-mcp is already running on this port */
  async checkExisting(): Promise<boolean> {
    try {
      const resp = await fetch(`http://localhost:${this.port}/health`, { signal: AbortSignal.timeout(1000) });
      const data = await resp.json() as Record<string, unknown>;
      if (data.service === "talon-mcp") {
        process.stderr.write(`[talon-mcp] Reusing existing server on port ${this.port}\n`);
        const authResp = await fetch(`http://localhost:${this.port}/auth/local`, { method: "POST", signal: AbortSignal.timeout(1000) });
        const authData = await authResp.json() as Record<string, unknown>;
        if (authData.token) {
          this.authToken = authData.token as string;
        }
        return true;
      }
    } catch {}
    return false;
  }

  async start(): Promise<void> {
    const existing = await this.checkExisting();
    if (existing) {
      this.reusing = true;
      return;
    }

    const httpServer = createServer((req, res) => this.handleHttp(req, res));

    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          process.stderr.write(`[talon-mcp] Port ${this.port} in use by another process, using random port\n`);
          httpServer.listen(0, () => {
            this.port = (httpServer.address() as any).port;
            resolve();
          });
        } else {
          reject(err);
        }
      });
      httpServer.listen(this.port, () => {
        this.port = (httpServer.address() as any).port;
        resolve();
      });
    });

    if (!httpServer.listening) {
      throw new Error("Could not bind to any port");
    }

    const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

    this.writeDiscoveryFiles();
    process.stderr.write(`[talon-mcp] Server listening on port ${this.port}\n`);

    wss.on("connection", (ws, req) => {
      const url = new URL(req.url ?? "/", `http://localhost:${this.port}`);
      const token = url.searchParams.get("token");
      if (token !== this.authToken) {
        ws.close(4001, "Invalid token");
        return;
      }

      // Parse initial mode from query string: ?mode=chat|monitor|full|custom&categories=tools,permissions
      const modeParam = url.searchParams.get("mode") as ClientMode | null;
      if (modeParam && ["chat", "monitor", "full", "custom"].includes(modeParam)) {
        const categories = (url.searchParams.get("categories") ?? "")
          .split(",")
          .filter(Boolean) as EventCategory[];
        this.setMode({
          mode: modeParam,
          ...(modeParam === "custom" ? { enabledCategories: categories } : {}),
        });
      }

      this.client = ws;
      process.stderr.write(`[talon-mcp] Chrome extension connected (mode=${this.clientMode.mode})\n`);

      // Send capabilities announcement on connect
      this.sendEvent({
        type: "connected",
        mode: this.clientMode.mode,
        allows_chat: this.allowsChat,
        allows_permissions: this.allowsPermissions,
        available_modes: ["chat", "monitor", "full", "custom"],
        available_categories: Object.keys(CATEGORY_EVENTS),
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // Browser command response
          if (msg.type === "browser_command_response" && msg.request_id) {
            const p = this.pending.get(msg.request_id);
            if (p) {
              clearTimeout(p.timer);
              this.pending.delete(msg.request_id);
              p.resolve(msg.result);
            }
            return;
          }

          // Mode switch from extension
          if (msg.type === "set_mode") {
            this.setMode({
              mode: msg.mode ?? "full",
              enabledCategories: msg.categories,
            });
            return;
          }

          // Permission verdict from extension
          if (msg.type === "permission_verdict" && msg.request_id && this.permissionVerdictHandler) {
            if (!this.allowsPermissions) {
              process.stderr.write(`[talon-mcp] Permission verdict ignored — not allowed in ${this.clientMode.mode} mode\n`);
              return;
            }
            this.permissionVerdictHandler(msg.request_id, msg.behavior === "allow" ? "allow" : "deny");
            return;
          }

          // RC protocol request (send_message) from extension
          if (msg.type === "request" && msg.method === "send_message" && msg.params && this.chatHandler) {
            if (!this.allowsChat) {
              process.stderr.write(`[talon-mcp] Chat message ignored — not allowed in ${this.clientMode.mode} mode\n`);
              return;
            }
            const chatId = msg.params.conversation_id || `chat-${Date.now()}`;
            this.lastChatId = chatId;
            const text = msg.params.message || "";
            this.chatHandler(chatId, text, {});
            if (this.client && msg.id) {
              this.wsSend(JSON.stringify({
                seq: this.seqCounter++,
                payload: { type: "response", id: msg.id, result: { ok: true } },
              }));
            }
            return;
          }

          // Bridge protocol chat message from extension (fallback)
          if (msg.type === "chat_message" && msg.text && this.chatHandler) {
            if (!this.allowsChat) return;
            const chatId = msg.conversation_id || `chat-${Date.now()}`;
            const context: Record<string, string> = {};
            if (msg.context?.url) context.url = msg.context.url;
            if (msg.context?.title) context.title = msg.context.title;
            if (msg.context?.selectedText) context.selectedText = msg.context.selectedText;
            this.chatHandler(chatId, msg.text, context);
            return;
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.on("close", () => {
        if (this.client === ws) {
          this.client = null;
          process.stderr.write(`[talon-mcp] Chrome extension disconnected\n`);
        }
      });

      ws.on("error", (err) => {
        process.stderr.write(`[talon-mcp] WebSocket error: ${err.message}\n`);
      });
    });

  }

  // ─── Discovery & Native Host ───────────────────────────────────────────

  private writeDiscoveryFiles(): void {
    try {
      mkdirSync(TALON_DIR, { recursive: true });
      writeFileSync(join(TALON_DIR, "rc_port"), String(this.port));
      writeFileSync(join(TALON_DIR, "browser_bridge_token"), this.authToken);
      process.stderr.write(`[talon-mcp] Discovery files written to ${TALON_DIR}\n`);
    } catch (err) {
      process.stderr.write(`[talon-mcp] Warning: could not write discovery files: ${err}\n`);
    }
    this.installNativeMessagingHost();
  }

  private installNativeMessagingHost(): void {
    try {
      const home = homedir();
      let hostsDir: string;
      if (platform() === "darwin") {
        hostsDir = join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
      } else if (platform() === "linux") {
        hostsDir = join(home, ".config", "google-chrome", "NativeMessagingHosts");
      } else {
        return;
      }

      mkdirSync(hostsDir, { recursive: true });

      const thisFile = fileURLToPath(import.meta.url);
      const hostScript = join(dirname(thisFile), "..", "native-host", "talon-native-host.js");

      if (!existsSync(hostScript)) {
        process.stderr.write(`[talon-mcp] Native host script not found at ${hostScript}\n`);
        return;
      }

      const extId = this.findExtensionId();

      const manifest = {
        name: "com.gettalon.mcp",
        description: "Talon MCP native messaging host for browser discovery",
        path: hostScript,
        type: "stdio",
        allowed_origins: extId
          ? [`chrome-extension://${extId}/`]
          : ["chrome-extension://*/"],
      };

      const manifestPath = join(hostsDir, "com.gettalon.mcp.json");
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      process.stderr.write(`[talon-mcp] Native messaging host installed at ${manifestPath}\n`);
    } catch (err) {
      process.stderr.write(`[talon-mcp] Warning: could not install native messaging host: ${err}\n`);
    }
  }

  private findExtensionId(): string | null {
    try {
      const home = homedir();
      let extDir: string;
      if (platform() === "darwin") {
        extDir = join(home, "Library", "Application Support", "Google", "Chrome", "Default", "Extensions");
      } else {
        extDir = join(home, ".config", "google-chrome", "Default", "Extensions");
      }

      if (!existsSync(extDir)) return null;

      for (const id of readdirSync(extDir)) {
        try {
          const versions = readdirSync(join(extDir, id));
          for (const ver of versions) {
            const mf = join(extDir, id, ver, "manifest.json");
            if (existsSync(mf)) {
              const raw = readFileSync(mf, "utf-8");
              const content = JSON.parse(raw);
              if (content.name === "Talon Browser Control") {
                return id;
              }
            }
          }
        } catch {
          continue;
        }
      }
    } catch {}
    return null;
  }

  cleanupDiscoveryFiles(): void {
    try {
      unlinkSync(join(TALON_DIR, "rc_port"));
      unlinkSync(join(TALON_DIR, "browser_bridge_token"));
    } catch {
      // ignore
    }
  }

  // ─── HTTP ──────────────────────────────────────────────────────────────

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    // CORS headers for browser access
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        service: "talon-mcp",
        mode: this.clientMode.mode,
        connected: this.isConnected,
      }));
      return;
    }

    if (req.url === "/auth/local" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ token: this.authToken }));
      return;
    }

    // GET /mode — current mode info
    if (req.url === "/mode" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        mode: this.clientMode.mode,
        categories: this.clientMode.enabledCategories ?? [],
        allows_chat: this.allowsChat,
        allows_permissions: this.allowsPermissions,
        available_modes: ["chat", "monitor", "full", "custom"],
        available_categories: Object.keys(CATEGORY_EVENTS),
      }));
      return;
    }

    // POST /mode — switch mode via HTTP
    if (req.url === "/mode" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          this.setMode({
            mode: data.mode ?? "full",
            enabledCategories: data.categories,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, mode: this.clientMode.mode }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  }

  // ─── Commands & Chat ───────────────────────────────────────────────────

  async sendCommand(action: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.reusing) {
      return this.proxyCommand(action, params);
    }

    if (!this.client || this.client.readyState !== WebSocket.OPEN) {
      throw new Error("No browser connected. Load the Chrome extension and open Chrome.");
    }

    const requestId = randomUUID();
    const cmd: BrowserCommand = {
      type: "browser_command",
      request_id: requestId,
      action,
      ...params,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Browser command timed out after 30 seconds"));
      }, COMMAND_TIMEOUT_MS);

      this.pending.set(requestId, { resolve, reject, timer });
      this.wsSend(JSON.stringify({
        seq: this.seqCounter++,
        payload: cmd,
      }));
    });
  }

  onChatMessage(handler: ChatHandler): void {
    this.chatHandler = handler;
  }

  private wsSend(msg: string): void {
    if (!this.client || this.client.readyState !== WebSocket.OPEN) return;
    const logLine = `[${new Date().toISOString()}] WS SEND: ${msg.substring(0, 500)}\n`;
    process.stderr.write(logLine);
    try { appendFileSync(join(TALON_DIR, "mcp-ws.log"), logLine); } catch {}
    this.client.send(msg);
  }

  sendChatReply(chatId: string, text: string): void {
    if (!this.client || this.client.readyState !== WebSocket.OPEN) {
      process.stderr.write("[talon-mcp] Cannot send reply: no browser connected\n");
      return;
    }

    process.stderr.write(`[talon-mcp] sendChatReply chatId=${chatId} text=${text.substring(0, 100)}\n`);

    let seq = Date.now();
    try {
      this.wsSend(JSON.stringify({ seq: seq++, payload: { type: "stream", conversation_id: chatId, event: { type: "turn_started" } } }));
      this.wsSend(JSON.stringify({ seq: seq++, payload: { type: "stream", conversation_id: chatId, event: { type: "text_delta", text } } }));
      this.wsSend(JSON.stringify({ seq: seq++, payload: { type: "stream", conversation_id: chatId, event: { type: "stream_end", fullText: text } } }));
    } catch (err) {
      process.stderr.write(`[talon-mcp] Send error: ${err}\n`);
    }
  }

  // ─── Event Sending ─────────────────────────────────────────────────────

  private seqCounter = Date.now();
  private lastChatId: string | null = null;

  setLastChatId(chatId: string): void {
    this.lastChatId = chatId;
  }

  private sendEvent(event: Record<string, unknown>): void {
    if (!this.client || this.client.readyState !== WebSocket.OPEN) return;
    this.wsSend(JSON.stringify({
      seq: this.seqCounter++,
      payload: {
        type: "event",
        event: event.type as string,
        data: event,
      },
    }));
  }

  sendTurnStarted(): void {
    this.sendEvent({ type: "turn_started" });
  }

  sendToolUse(callId: string, toolName: string, args: Record<string, unknown>): void {
    this.sendEvent({ type: "tool_use", call_id: callId, tool_name: toolName, arguments: args });
  }

  sendToolResult(callId: string, toolName: string, output: string, isError = false): void {
    this.sendEvent({ type: "tool_result", call_id: callId, tool_name: toolName, output, is_error: isError });
  }

  sendStreamEnd(text?: string): void {
    this.sendEvent({ type: "stream_end", fullText: text || "" });
  }

  sendToolProgress(callId: string, toolName: string, elapsed: number): void {
    this.sendEvent({ type: "tool_progress", tool_use_id: callId, tool_name: toolName, elapsed_secs: elapsed });
  }

  sendStatus(message: string): void {
    this.sendEvent({ type: "status", message });
  }

  // ─── Channel SDK integration ──────────────────────────────────────────

  /** Forward a hook event to the browser extension (respects mode filter) */
  sendHookEvent(input: HookEventInput): void {
    if (!this.shouldForwardHook(input.hook_event_name)) return;
    this.sendEvent({
      type: "hook_event",
      hook_event_name: input.hook_event_name,
      data: input,
    });
  }

  /** Forward a permission relay request to the browser extension */
  sendPermissionRequest(request: ChannelPermissionRequest): void {
    if (!this.allowsPermissions) {
      // In non-permission modes, still forward as a read-only notification
      if (this.clientMode.mode !== "chat") {
        this.sendEvent({
          type: "hook_event",
          hook_event_name: "PermissionRequest",
          data: {
            type: "permission_request_readonly",
            tool_name: request.tool_name,
            description: request.description,
            input_preview: request.input_preview,
          },
        });
      }
      return;
    }
    this.sendEvent({
      type: "permission_request",
      request_id: request.request_id,
      tool_name: request.tool_name,
      description: request.description,
      input_preview: request.input_preview,
    });
  }

  /** Register handler for permission verdicts from browser extension */
  onPermissionVerdict(handler: PermissionVerdictHandler): void {
    this.permissionVerdictHandler = handler;
  }

  // ─── Proxy (reuse existing server) ────────────────────────────────────

  private proxyWs: WebSocket | null = null;
  private proxyPending = new Map<string, PendingRequest>();

  private async ensureProxyConnection(): Promise<WebSocket> {
    if (this.proxyWs && this.proxyWs.readyState === WebSocket.OPEN) return this.proxyWs;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${this.port}/ws?token=${this.authToken}`);
      ws.on("open", () => {
        this.proxyWs = ws;
        process.stderr.write(`[talon-mcp] Proxy connected to existing server\n`);
        resolve(ws);
      });
      ws.on("message", (data) => {
        try {
          let msg = JSON.parse(data.toString());
          if (msg.seq !== undefined && msg.payload) msg = msg.payload;
          if (msg.type === "browser_command_response" && msg.request_id) {
            const p = this.proxyPending.get(msg.request_id);
            if (p) {
              clearTimeout(p.timer);
              this.proxyPending.delete(msg.request_id);
              p.resolve(msg.result);
            }
          }
        } catch {}
      });
      ws.on("error", (err) => reject(err));
      ws.on("close", () => { this.proxyWs = null; });
      setTimeout(() => reject(new Error("Proxy connection timeout")), 5000);
    });
  }

  private async proxyCommand(action: string, params: Record<string, unknown>): Promise<unknown> {
    const ws = await this.ensureProxyConnection();
    const requestId = randomUUID();
    const cmd: BrowserCommand = { type: "browser_command", request_id: requestId, action, ...params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.proxyPending.delete(requestId);
        reject(new Error("Browser command timed out after 30 seconds"));
      }, COMMAND_TIMEOUT_MS);

      this.proxyPending.set(requestId, { resolve, reject, timer });
      ws.send(JSON.stringify({ seq: Date.now(), payload: cmd }));
    });
  }

  get isConnected(): boolean {
    if (this.reusing) return this.proxyWs !== null && this.proxyWs.readyState === WebSocket.OPEN;
    return this.client !== null && this.client.readyState === WebSocket.OPEN;
  }
}
