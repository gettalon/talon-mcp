import type { BrowserBridgeServer } from "./ws-server.js";
type ToolResult = {
    content: Array<{
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
    }>;
    isError?: boolean;
};
/**
 * Maps a new focused tool call to the legacy action + params format
 * that the Chrome extension expects, then executes it.
 */
export declare function executeToolCall(toolName: string, args: Record<string, unknown>, server: BrowserBridgeServer): Promise<ToolResult>;
export {};
