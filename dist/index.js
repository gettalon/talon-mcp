#!/usr/bin/env node
import { BrowserBridgeServer } from "./ws-server.js";
import { ALL_TOOLS } from "./tools.js";
import { executeToolCall } from "./tool-executor.js";
import { ChannelServer } from "./channel-sdk/index.js";
const PORT = parseInt(process.env.TALON_MCP_PORT ?? "21567", 10);
/** Set of all focused tool names for fast lookup */
const FOCUSED_TOOL_NAMES = new Set(ALL_TOOLS.map((t) => t.name));
async function main() {
    // Start the WebSocket/HTTP server for Chrome extension
    const bridge = new BrowserBridgeServer(PORT);
    await bridge.start();
    // Create channel server with full capabilities
    const channel = new ChannelServer({
        name: "talon-browser",
        version: "1.2.0",
        instructions: 'Messages from the Chrome browser extension arrive as <channel source="talon-browser" chat_id="..." user="browser">. ' +
            "The user is chatting from a Chrome side panel. Reply with the reply tool, passing chat_id back. " +
            "You also have browser_control tools to navigate, click, fill forms, take screenshots, and more in their Chrome browser.",
        permissionRelay: true,
        extraTools: ALL_TOOLS,
    });
    // ─── Hook events → forward to browser extension ────────────────────────
    channel.onHookEvent((input) => {
        bridge.sendHookEvent(input);
    });
    // ─── Permission relay → forward to browser extension ───────────────────
    channel.onPermissionRequest((request) => {
        bridge.sendPermissionRequest(request);
    });
    // Listen for permission verdicts from browser extension
    bridge.onPermissionVerdict((requestId, behavior) => {
        channel.sendPermissionVerdict({ request_id: requestId, behavior });
    });
    // ─── Chat: reply tool → browser extension ──────────────────────────────
    channel.onReply((chatId, text) => {
        bridge.sendChatReply(chatId, text);
    });
    // ─── Extra tools: browser control ──────────────────────────────────────
    channel.onToolCall(async (name, args) => {
        if (FOCUSED_TOOL_NAMES.has(name)) {
            return await executeToolCall(name, args, bridge);
        }
        throw new Error(`Unknown tool: ${name}`);
    });
    // ─── Chat: browser extension → Claude channel ─────────────────────────
    bridge.onChatMessage(async (chatId, text, context) => {
        const meta = { chat_id: chatId, user: "browser" };
        if (context?.url)
            meta.url = context.url;
        if (context?.title)
            meta.title = context.title;
        await channel.pushMessage(text, meta);
    });
    // Start channel server (IPC socket + MCP stdio)
    await channel.start();
    process.stderr.write(`[talon-mcp] Ready (port ${PORT})\n`);
    // Graceful shutdown
    const shutdown = () => {
        channel.cleanup();
        bridge.cleanupDiscoveryFiles();
        process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
}
main().catch((err) => {
    process.stderr.write(`[talon-mcp] Fatal: ${err}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map