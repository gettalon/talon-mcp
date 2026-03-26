import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const DEFAULT_PORT = 21567;
const COMMAND_TIMEOUT_MS = 30_000;
const TALON_DIR = join(homedir(), ".talon");
/** Regex matching "yes <id>" or "no <id>" for permission relay from browser */
const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i;
export class BrowserBridgeServer {
    client = null;
    pending = new Map();
    chatHandler = null;
    permissionVerdictHandler = null;
    authToken;
    port;
    reusing = false;
    constructor(port) {
        this.port = port ?? DEFAULT_PORT;
        this.authToken = randomUUID();
    }
    /** Check if an existing talon-mcp is already running on this port. Returns true if reusable. */
    async checkExisting() {
        try {
            const resp = await fetch(`http://localhost:${this.port}/health`, { signal: AbortSignal.timeout(1000) });
            const data = await resp.json();
            if (data.service === "talon-mcp") {
                process.stderr.write(`[talon-mcp] Reusing existing server on port ${this.port}\n`);
                // Get the token from the existing server
                const authResp = await fetch(`http://localhost:${this.port}/auth/local`, { method: "POST", signal: AbortSignal.timeout(1000) });
                const authData = await authResp.json();
                if (authData.token) {
                    this.authToken = authData.token;
                }
                return true;
            }
        }
        catch { }
        return false;
    }
    async start() {
        // Check if an existing talon-mcp is already running — reuse it
        const existing = await this.checkExisting();
        if (existing) {
            this.reusing = true;
            return;
        }
        const httpServer = createServer((req, res) => this.handleHttp(req, res));
        await new Promise((resolve, reject) => {
            httpServer.once("error", (err) => {
                if (err.code === "EADDRINUSE") {
                    // Port taken by non-talon process, use random
                    process.stderr.write(`[talon-mcp] Port ${this.port} in use by another process, using random port\n`);
                    httpServer.listen(0, () => {
                        this.port = httpServer.address().port;
                        resolve();
                    });
                }
                else {
                    reject(err);
                }
            });
            httpServer.listen(this.port, () => {
                this.port = httpServer.address().port;
                resolve();
            });
        });
        if (!httpServer.listening) {
            throw new Error("Could not bind to any port");
        }
        // Create WebSocket server AFTER successful port binding
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
            this.client = ws;
            process.stderr.write(`[talon-mcp] Chrome extension connected (readyState=${ws.readyState})\n`);
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
                    // RC protocol request (send_message) from extension
                    if (msg.type === "request" && msg.method === "send_message" && msg.params && this.chatHandler) {
                        const chatId = msg.params.conversation_id || `chat-${Date.now()}`;
                        this.lastChatId = chatId;
                        const text = msg.params.message || "";
                        this.chatHandler(chatId, text, {});
                        // Send response back to extension so it knows message was received
                        if (this.client && msg.id) {
                            this.wsSend(JSON.stringify({
                                seq: this.seqCounter++,
                                payload: {
                                    type: "response",
                                    id: msg.id,
                                    result: { ok: true },
                                },
                            }));
                        }
                        return;
                    }
                    // Permission verdict from extension
                    if (msg.type === "permission_verdict" && msg.request_id && this.permissionVerdictHandler) {
                        this.permissionVerdictHandler(msg.request_id, msg.behavior === "allow" ? "allow" : "deny");
                        return;
                    }
                    // Bridge protocol chat message from extension (fallback)
                    if (msg.type === "chat_message" && msg.text && this.chatHandler) {
                        const chatId = msg.conversation_id || `chat-${Date.now()}`;
                        const context = {};
                        if (msg.context?.url)
                            context.url = msg.context.url;
                        if (msg.context?.title)
                            context.title = msg.context.title;
                        if (msg.context?.selectedText)
                            context.selectedText = msg.context.selectedText;
                        this.chatHandler(chatId, msg.text, context);
                        return;
                    }
                }
                catch {
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
    writeDiscoveryFiles() {
        try {
            mkdirSync(TALON_DIR, { recursive: true });
            writeFileSync(join(TALON_DIR, "rc_port"), String(this.port));
            writeFileSync(join(TALON_DIR, "browser_bridge_token"), this.authToken);
            process.stderr.write(`[talon-mcp] Discovery files written to ${TALON_DIR}\n`);
        }
        catch (err) {
            process.stderr.write(`[talon-mcp] Warning: could not write discovery files: ${err}\n`);
        }
        this.installNativeMessagingHost();
    }
    installNativeMessagingHost() {
        try {
            // Determine native messaging hosts directory
            const home = homedir();
            let hostsDir;
            if (platform() === "darwin") {
                hostsDir = join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
            }
            else if (platform() === "linux") {
                hostsDir = join(home, ".config", "google-chrome", "NativeMessagingHosts");
            }
            else {
                // Windows: HKCU registry — skip auto-install
                return;
            }
            mkdirSync(hostsDir, { recursive: true });
            // Find the native host script path
            const thisFile = fileURLToPath(import.meta.url);
            const hostScript = join(dirname(thisFile), "..", "native-host", "talon-native-host.js");
            if (!existsSync(hostScript)) {
                process.stderr.write(`[talon-mcp] Native host script not found at ${hostScript}\n`);
                return;
            }
            // Find installed extension ID by scanning Chrome extensions dir
            const extId = this.findExtensionId();
            const manifest = {
                name: "com.gettalon.mcp",
                description: "Talon MCP native messaging host for browser discovery",
                path: hostScript,
                type: "stdio",
                allowed_origins: extId
                    ? [`chrome-extension://${extId}/`]
                    : ["chrome-extension://*/"], // allow any if ID unknown
            };
            const manifestPath = join(hostsDir, "com.gettalon.mcp.json");
            writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
            process.stderr.write(`[talon-mcp] Native messaging host installed at ${manifestPath}\n`);
        }
        catch (err) {
            process.stderr.write(`[talon-mcp] Warning: could not install native messaging host: ${err}\n`);
        }
    }
    findExtensionId() {
        // Try to find the Talon Browser Control extension ID from Chrome's Extensions dir
        try {
            const home = homedir();
            let extDir;
            if (platform() === "darwin") {
                extDir = join(home, "Library", "Application Support", "Google", "Chrome", "Default", "Extensions");
            }
            else {
                extDir = join(home, ".config", "google-chrome", "Default", "Extensions");
            }
            if (!existsSync(extDir))
                return null;
            // Scan extension dirs for one containing our manifest name
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
                }
                catch {
                    continue;
                }
            }
        }
        catch { }
        return null;
    }
    cleanupDiscoveryFiles() {
        try {
            unlinkSync(join(TALON_DIR, "rc_port"));
            unlinkSync(join(TALON_DIR, "browser_bridge_token"));
        }
        catch {
            // ignore
        }
    }
    handleHttp(req, res) {
        if (req.url === "/health" && req.method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok", service: "talon-mcp" }));
            return;
        }
        if (req.url === "/auth/local" && req.method === "POST") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ token: this.authToken }));
            return;
        }
        res.writeHead(404);
        res.end("Not Found");
    }
    async sendCommand(action, params) {
        // In reuse mode, proxy command through the existing server's WS
        if (this.reusing) {
            return this.proxyCommand(action, params);
        }
        if (!this.client || this.client.readyState !== WebSocket.OPEN) {
            throw new Error("No browser connected. Load the Chrome extension and open Chrome.");
        }
        const requestId = randomUUID();
        const cmd = {
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
            // Wrap in seq envelope so extension doesn't disconnect
            this.wsSend(JSON.stringify({
                seq: this.seqCounter++,
                payload: cmd,
            }));
        });
    }
    onChatMessage(handler) {
        this.chatHandler = handler;
    }
    wsSend(msg) {
        if (!this.client || this.client.readyState !== WebSocket.OPEN)
            return;
        const logLine = `[${new Date().toISOString()}] WS SEND: ${msg.substring(0, 500)}\n`;
        process.stderr.write(logLine);
        try {
            appendFileSync(join(TALON_DIR, "mcp-ws.log"), logLine);
        }
        catch { }
        this.client.send(msg);
    }
    sendChatReply(chatId, text) {
        if (!this.client || this.client.readyState !== WebSocket.OPEN) {
            process.stderr.write("[talon-mcp] Cannot send reply: no browser connected\n");
            return;
        }
        process.stderr.write(`[talon-mcp] sendChatReply chatId=${chatId} text=${text.substring(0, 100)}\n`);
        // Use RC stream format with seq envelope (extension expects this when connectedToRc=true)
        let seq = Date.now();
        try {
            // Turn started
            this.wsSend(JSON.stringify({ seq: seq++, payload: { type: "stream", conversation_id: chatId, event: { type: "turn_started" } } }));
            this.wsSend(JSON.stringify({ seq: seq++, payload: { type: "stream", conversation_id: chatId, event: { type: "text_delta", text } } }));
            this.wsSend(JSON.stringify({ seq: seq++, payload: { type: "stream", conversation_id: chatId, event: { type: "stream_end", fullText: text } } }));
        }
        catch (err) {
            process.stderr.write(`[talon-mcp] Send error: ${err}\n`);
        }
    }
    seqCounter = Date.now();
    lastChatId = null;
    setLastChatId(chatId) {
        this.lastChatId = chatId;
    }
    sendEvent(event) {
        if (!this.client || this.client.readyState !== WebSocket.OPEN)
            return;
        this.wsSend(JSON.stringify({
            seq: this.seqCounter++,
            payload: {
                type: "event",
                event: event.type,
                data: event,
            },
        }));
    }
    sendTurnStarted() {
        this.sendEvent({ type: "turn_started" });
    }
    sendToolUse(callId, toolName, args) {
        this.sendEvent({ type: "tool_use", call_id: callId, tool_name: toolName, arguments: args });
    }
    sendToolResult(callId, toolName, output, isError = false) {
        this.sendEvent({ type: "tool_result", call_id: callId, tool_name: toolName, output, is_error: isError });
    }
    sendStreamEnd(text) {
        this.sendEvent({ type: "stream_end", fullText: text || "" });
    }
    sendToolProgress(callId, toolName, elapsed) {
        this.sendEvent({ type: "tool_progress", tool_use_id: callId, tool_name: toolName, elapsed_secs: elapsed });
    }
    sendStatus(message) {
        this.sendEvent({ type: "status", message });
    }
    // ─── Channel SDK integration ────────────────────────────────────────────
    /** Forward a hook event to the browser extension */
    sendHookEvent(input) {
        this.sendEvent({
            type: "hook_event",
            hook_event_name: input.hook_event_name,
            data: input,
        });
    }
    /** Forward a permission relay request to the browser extension */
    sendPermissionRequest(request) {
        this.sendEvent({
            type: "permission_request",
            request_id: request.request_id,
            tool_name: request.tool_name,
            description: request.description,
            input_preview: request.input_preview,
        });
    }
    /** Register handler for permission verdicts from browser extension */
    onPermissionVerdict(handler) {
        this.permissionVerdictHandler = handler;
    }
    proxyWs = null;
    proxyPending = new Map();
    async ensureProxyConnection() {
        if (this.proxyWs && this.proxyWs.readyState === WebSocket.OPEN)
            return this.proxyWs;
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
                    // Unwrap seq envelope
                    if (msg.seq !== undefined && msg.payload)
                        msg = msg.payload;
                    if (msg.type === "browser_command_response" && msg.request_id) {
                        const p = this.proxyPending.get(msg.request_id);
                        if (p) {
                            clearTimeout(p.timer);
                            this.proxyPending.delete(msg.request_id);
                            p.resolve(msg.result);
                        }
                    }
                }
                catch { }
            });
            ws.on("error", (err) => reject(err));
            ws.on("close", () => { this.proxyWs = null; });
            setTimeout(() => reject(new Error("Proxy connection timeout")), 5000);
        });
    }
    async proxyCommand(action, params) {
        const ws = await this.ensureProxyConnection();
        const requestId = randomUUID();
        const cmd = { type: "browser_command", request_id: requestId, action, ...params };
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.proxyPending.delete(requestId);
                reject(new Error("Browser command timed out after 30 seconds"));
            }, COMMAND_TIMEOUT_MS);
            this.proxyPending.set(requestId, { resolve, reject, timer });
            ws.send(JSON.stringify({ seq: Date.now(), payload: cmd }));
        });
    }
    get isConnected() {
        if (this.reusing)
            return this.proxyWs !== null && this.proxyWs.readyState === WebSocket.OPEN;
        return this.client !== null && this.client.readyState === WebSocket.OPEN;
    }
}
//# sourceMappingURL=ws-server.js.map