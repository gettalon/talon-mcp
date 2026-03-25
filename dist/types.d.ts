export interface JsonRpcRequest {
    jsonrpc: "2.0";
    id?: number | string;
    method: string;
    params?: Record<string, unknown>;
}
export interface JsonRpcResponse {
    jsonrpc: "2.0";
    id: number | string;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}
export interface BrowserCommand {
    type: "browser_command";
    request_id: string;
    action: string;
    [key: string]: unknown;
}
export interface BrowserCommandResponse {
    type: "browser_command_response";
    request_id: string;
    result: {
        success?: boolean;
        error?: string;
        data?: unknown;
        [key: string]: unknown;
    };
}
export interface McpToolDef {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}
