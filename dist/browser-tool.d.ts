import type { McpToolDef } from "./types.js";
import type { BrowserBridgeServer } from "./ws-server.js";
export declare const BROWSER_TOOL: McpToolDef;
export declare function compressScreenshot(base64Data: string): Promise<{
    data: string;
    mimeType: string;
}>;
export declare function executeBrowserTool(server: BrowserBridgeServer, args: Record<string, unknown>): Promise<{
    content: Array<{
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
    }>;
    isError?: boolean;
}>;
