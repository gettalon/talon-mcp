type ChatHandler = (chatId: string, text: string, context?: Record<string, string>) => void;
export declare class BrowserBridgeServer {
    private client;
    private pending;
    private chatHandler;
    private authToken;
    private port;
    private reusing;
    constructor(port?: number);
    /** Check if an existing talon-mcp is already running on this port. Returns true if reusable. */
    checkExisting(): Promise<boolean>;
    start(): Promise<void>;
    private writeDiscoveryFiles;
    private installNativeMessagingHost;
    private findExtensionId;
    cleanupDiscoveryFiles(): void;
    private handleHttp;
    sendCommand(action: string, params: Record<string, unknown>): Promise<unknown>;
    onChatMessage(handler: ChatHandler): void;
    private wsSend;
    sendChatReply(chatId: string, text: string): void;
    private seqCounter;
    private lastChatId;
    setLastChatId(chatId: string): void;
    private sendEvent;
    sendTurnStarted(): void;
    sendToolUse(callId: string, toolName: string, args: Record<string, unknown>): void;
    sendToolResult(callId: string, toolName: string, output: string, isError?: boolean): void;
    sendStreamEnd(text?: string): void;
    sendToolProgress(callId: string, toolName: string, elapsed: number): void;
    sendStatus(message: string): void;
    private proxyWs;
    private proxyPending;
    private ensureProxyConnection;
    private proxyCommand;
    get isConnected(): boolean;
}
export {};
