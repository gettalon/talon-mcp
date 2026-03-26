import type { HookEventInput, ChannelPermissionRequest } from "./channel-sdk/types.js";
type ChatHandler = (chatId: string, text: string, context?: Record<string, string>) => void;
type PermissionVerdictHandler = (requestId: string, behavior: "allow" | "deny") => void;
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
export type EventCategory = "chat" | "tools" | "permissions" | "session" | "notifications" | "subagents" | "lifecycle" | "filesystem" | "worktree" | "compact" | "elicitation" | "prompts";
export declare class BrowserBridgeServer {
    private client;
    private pending;
    private chatHandler;
    private permissionVerdictHandler;
    private authToken;
    private port;
    private reusing;
    private clientMode;
    private allowedEvents;
    private allowsPermissions;
    private allowsChat;
    constructor(port?: number);
    /** Get current client mode */
    getMode(): ClientModeConfig;
    /** Set client mode — controls what events are forwarded to the browser */
    setMode(config: ClientModeConfig): void;
    /** Check if a hook event should be forwarded to the browser */
    private shouldForwardHook;
    /** Check if an existing talon-mcp is already running on this port */
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
    /** Forward a hook event to the browser extension (respects mode filter) */
    sendHookEvent(input: HookEventInput): void;
    /** Forward a permission relay request to the browser extension */
    sendPermissionRequest(request: ChannelPermissionRequest): void;
    /** Register handler for permission verdicts from browser extension */
    onPermissionVerdict(handler: PermissionVerdictHandler): void;
    private proxyWs;
    private proxyPending;
    private ensureProxyConnection;
    private proxyCommand;
    get isConnected(): boolean;
}
export {};
