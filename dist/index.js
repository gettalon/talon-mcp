#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { BrowserBridgeServer } from "./ws-server.js";
import { ALL_TOOLS } from "./tools.js";
import { executeToolCall } from "./tool-executor.js";
const PORT = parseInt(process.env.TALON_MCP_PORT ?? "21567", 10);
/** Set of all new focused tool names for fast lookup */
const FOCUSED_TOOL_NAMES = new Set(ALL_TOOLS.map((t) => t.name));
async function main() {
    // Start the WebSocket/HTTP server for Chrome extension
    const bridge = new BrowserBridgeServer(PORT);
    await bridge.start();
    // Create MCP server with both tools AND channel capabilities
    const mcp = new Server({ name: "talon-browser", version: "1.1.1" }, {
        capabilities: {
            experimental: { "claude/channel": {} },
            tools: {},
        },
        instructions: 'Messages from the Chrome browser extension arrive as <channel source="talon-browser" chat_id="..." user="browser">. ' +
            "The user is chatting from a Chrome side panel. Reply with the reply tool, passing chat_id back. " +
            "You also have browser_control tools to navigate, click, fill forms, take screenshots, and more in their Chrome browser.",
    });
    // Register all tools: 15 focused tools + reply
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            ...ALL_TOOLS,
            {
                name: "reply",
                description: "Send a message back to the Chrome extension chat panel",
                inputSchema: {
                    type: "object",
                    properties: {
                        chat_id: { type: "string", description: "The chat_id from the channel tag" },
                        text: { type: "string", description: "The message to send" },
                    },
                    required: ["chat_id", "text"],
                },
            },
        ],
    }));
    // Handle tool calls
    mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
        const { name, arguments: args } = req.params;
        // Focused browser tools
        if (FOCUSED_TOOL_NAMES.has(name)) {
            return await executeToolCall(name, (args ?? {}), bridge);
        }
        if (name === "reply") {
            const { chat_id, text } = args;
            bridge.sendChatReply(chat_id, text);
            return { content: [{ type: "text", text: "sent" }] };
        }
        throw new Error(`Unknown tool: ${name}`);
    });
    // Listen for chat messages from Chrome extension and forward as channel notifications
    bridge.onChatMessage(async (chatId, text, context) => {
        const meta = {
            chat_id: chatId,
            user: "browser",
        };
        if (context?.url)
            meta.url = context.url;
        if (context?.title)
            meta.title = context.title;
        await mcp.notification({
            method: "notifications/claude/channel",
            params: { content: text, meta },
        });
    });
    // Connect MCP over stdio
    const transport = new StdioServerTransport();
    await mcp.connect(transport);
    process.stderr.write(`[talon-mcp] MCP server ready (port ${PORT})\n`);
    // Graceful shutdown
    const shutdown = () => {
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