import type { JsonRpcRequest, JsonRpcResponse } from "./types.js";
import type { BrowserBridgeServer } from "./ws-server.js";
export declare class McpHandler {
    private server;
    constructor(server: BrowserBridgeServer);
    handle(req: JsonRpcRequest): Promise<JsonRpcResponse | null>;
    private respond;
    private error;
}
