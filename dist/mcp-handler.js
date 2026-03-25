import { BROWSER_TOOL, executeBrowserTool } from "./browser-tool.js";
const SERVER_INFO = {
    name: "talon-mcp",
    version: "1.0.0",
};
export class McpHandler {
    server;
    constructor(server) {
        this.server = server;
    }
    async handle(req) {
        switch (req.method) {
            case "initialize":
                return this.respond(req.id, {
                    protocolVersion: "2024-11-05",
                    capabilities: { tools: {} },
                    serverInfo: SERVER_INFO,
                });
            case "initialized":
                return null;
            case "tools/list":
                return this.respond(req.id, { tools: [BROWSER_TOOL] });
            case "tools/call": {
                const params = req.params;
                if (!params?.name) {
                    return this.error(req.id, -32602, "Missing tool name");
                }
                if (params.name !== "browser_control") {
                    return this.error(req.id, -32602, `Unknown tool: ${params.name}`);
                }
                const result = await executeBrowserTool(this.server, params.arguments ?? {});
                return this.respond(req.id, result);
            }
            case "notifications/cancelled":
                return null;
            case "ping":
                return this.respond(req.id, {});
            default:
                return this.error(req.id, -32601, `Method not found: ${req.method}`);
        }
    }
    respond(id, result) {
        return { jsonrpc: "2.0", id, result };
    }
    error(id, code, message) {
        return { jsonrpc: "2.0", id: id ?? 0, error: { code, message } };
    }
}
//# sourceMappingURL=mcp-handler.js.map