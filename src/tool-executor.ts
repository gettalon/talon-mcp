import type { BrowserBridgeServer } from "./ws-server.js";
import { compressScreenshot } from "./browser-tool.js";

type ToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
};

/**
 * Maps a new focused tool call to the legacy action + params format
 * that the Chrome extension expects, then executes it.
 */
export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  server: BrowserBridgeServer,
): Promise<ToolResult> {
  const { action, params } = translateToolCall(toolName, args);
  return executeAction(action, params, toolName, server);
}

// ── Action translation ──────────────────────────────────────────────

interface Translation {
  action: string;
  params: Record<string, unknown>;
}

function translateToolCall(toolName: string, args: Record<string, unknown>): Translation {
  switch (toolName) {
    // navigate
    case "navigate": {
      if (args.direction === "back") return { action: "navigate", params: { url: "back" } };
      if (args.direction === "forward") return { action: "navigate", params: { url: "forward" } };
      return { action: "navigate", params: pick(args, ["url"]) };
    }

    // click
    case "click":
      return { action: "click", params: pick(args, ["selector", "ref", "text", "timeout"]) };

    // type — has sub-actions
    case "type": {
      const sub = args.action as string;
      const rest = omit(args, ["action"]);
      return { action: sub, params: rest };
    }

    // read_page — has sub-actions
    case "read_page": {
      const sub = args.action as string;
      const rest = omit(args, ["action"]);
      return { action: sub, params: rest };
    }

    // screenshot
    case "screenshot":
      return { action: "screenshot", params: pick(args, ["selector", "full_page", "format", "quality"]) };

    // execute_js
    case "execute_js":
      return { action: "execute_js", params: pick(args, ["code"]) };

    // tabs — has sub-actions
    case "tabs": {
      const sub = args.action as string;
      const rest = omit(args, ["action"]);
      return { action: sub, params: rest };
    }

    // scroll — has sub-actions
    case "scroll": {
      const sub = args.action as string;
      const rest = omit(args, ["action"]);
      return { action: sub, params: rest };
    }

    // network — translate sub-action names to legacy action names
    case "network": {
      const actionMap: Record<string, string> = {
        enable: "network_enable",
        get_log: "get_network_log",
        set_headers: "set_headers",
        set_offline: "set_offline",
      };
      const sub = args.action as string;
      const rest = omit(args, ["action"]);
      return { action: actionMap[sub] ?? sub, params: rest };
    }

    // console — sub-actions map directly
    case "console": {
      const sub = args.action as string;
      return { action: sub, params: {} };
    }

    // emulate — sub-actions, ensure numeric params
    case "emulate": {
      const sub = args.action as string;
      const rest = omit(args, ["action"]);
      for (const k of ["width", "height", "latitude", "longitude", "accuracy", "deviceScaleFactor"]) {
        if (rest[k] !== undefined) rest[k] = Number(rest[k]);
      }
      return { action: sub, params: rest };
    }

    // performance — translate sub-action names
    case "performance": {
      const actionMap: Record<string, string> = {
        start_trace: "performance_start_trace",
        stop_trace: "performance_stop_trace",
        memory_snapshot: "take_memory_snapshot",
        lighthouse_audit: "lighthouse_audit",
      };
      const sub = args.action as string;
      const rest = omit(args, ["action"]);
      return { action: actionMap[sub] ?? sub, params: rest };
    }

    // form — sub-actions; upload_file needs set_input_files mapping
    case "form": {
      const actionMap: Record<string, string> = {
        fill_form: "fill_form",
        upload_file: "upload_file",
        select: "select",
        handle_dialog: "handle_dialog",
      };
      const sub = args.action as string;
      const rest = omit(args, ["action"]);
      return { action: actionMap[sub] ?? sub, params: rest };
    }

    // inspect — translate sub-action names
    case "inspect": {
      const actionMap: Record<string, string> = {
        highlight: "highlight_element",
        get_box_model: "get_box_model",
        get_metrics: "get_metrics",
        get_cookies: "get_cookies",
      };
      const sub = args.action as string;
      const rest = omit(args, ["action"]);
      return { action: actionMap[sub] ?? sub, params: rest };
    }

    // wait — sub-actions map directly
    case "wait": {
      const sub = args.action as string;
      const rest = omit(args, ["action"]);
      return { action: sub, params: rest };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ── Execution (shared with legacy tool) ─────────────────────────────

async function executeAction(
  action: string,
  params: Record<string, unknown>,
  toolName: string,
  server: BrowserBridgeServer,
): Promise<ToolResult> {
  const callId = `${toolName}-${Date.now()}`;

  server.sendTurnStarted();
  server.sendToolUse(callId, `${toolName}:${action}`, params);
  const startTime = Date.now();

  try {
    // Default screenshot to jpeg
    if (action === "screenshot" && !params.format) {
      params.format = "jpeg";
      if (!params.quality) params.quality = 60;
    }

    const result = await server.sendCommand(action, params);
    const resultObj = result as Record<string, unknown>;
    const elapsed = (Date.now() - startTime) / 1000;

    // Handle screenshot: compress and return as image
    if (action === "screenshot") {
      const b64 = (resultObj?.screenshot_base64 || resultObj?.data) as string | undefined;
      if (b64 && typeof b64 === "string") {
        const clean = b64.startsWith("data:image/")
          ? b64.replace(/^data:image\/\w+;base64,/, "")
          : b64;
        const { data, mimeType } = await compressScreenshot(clean);
        server.sendToolResult(callId, `${toolName}:${action}`, `Screenshot captured (${elapsed.toFixed(1)}s)`);
        server.sendStreamEnd();
        return { content: [{ type: "image", data, mimeType }] };
      }
    }

    // Handle errors from extension
    if (resultObj?.error) {
      const errMsg = `Browser error: ${resultObj.error}`;
      server.sendToolResult(callId, `${toolName}:${action}`, String(resultObj.error), true);
      server.sendStreamEnd();
      return { content: [{ type: "text", text: errMsg }], isError: true };
    }

    // Normal result
    const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    const summary = text.length > 200 ? text.substring(0, 200) + "..." : text;
    server.sendToolResult(callId, `${toolName}:${action}`, summary);
    server.sendStreamEnd();
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    server.sendToolResult(callId, `${toolName}:${action}`, message, true);
    server.sendStreamEnd();
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

function omit(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const skip = new Set(keys);
  for (const [k, v] of Object.entries(obj)) {
    if (!skip.has(k)) out[k] = v;
  }
  return out;
}
