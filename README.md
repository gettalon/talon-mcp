# @gettalon/mcp

MCP server that connects Claude Code to your Chrome browser. Control tabs, click elements, fill forms, take screenshots, and run JS — all from Claude.

## Install

```bash
npm install -g @gettalon/mcp
```

Or use directly with npx:

```bash
npx @gettalon/mcp
```

## Setup

Add to your Claude Code MCP config (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "talon-browser": {
      "command": "npx",
      "args": ["@gettalon/mcp"]
    }
  }
}
```

### Chrome Extension

Install the Talon browser extension from Chrome, then open Chrome. The MCP server auto-discovers the extension via native messaging.

### Hook Events (Optional)

To forward Claude Code lifecycle events to the browser extension, add hooks to your settings:

```json
{
  "hooks": {
    "PreToolUse": [{ "type": "command", "command": "talon-hook --socket ~/.talon/channel-hooks.sock" }],
    "PostToolUse": [{ "type": "command", "command": "talon-hook --socket ~/.talon/channel-hooks.sock" }],
    "Notification": [{ "type": "command", "command": "talon-hook --socket ~/.talon/channel-hooks.sock" }]
  }
}
```

All 23 Claude Code hook events are supported — add whichever you need.

## Tools

| Tool | Description |
|------|-------------|
| `navigate` | Go to a URL or navigate back/forward |
| `click` | Click elements by CSS selector, snapshot ref, or visible text |
| `type` | Fill inputs, type text, submit forms, press keyboard shortcuts |
| `read_page` | Get page info, accessibility snapshot, extracted data, or full text |
| `screenshot` | Capture the page or a specific element |
| `execute_js` | Run JavaScript in the page context |
| `tabs` | List, open, close, or switch browser tabs |
| `scroll` | Scroll the page, hover elements, or drag-and-drop |
| `network` | Monitor network activity, set headers, go offline |
| `console` | Get browser console logs and JS errors |
| `emulate` | Emulate devices, viewports, media features, geolocation |
| `performance` | Start/stop traces, memory snapshots, Lighthouse audits |
| `form` | Advanced form handling: file uploads, selects, dialogs |
| `inspect` | Highlight elements, get box model, metrics, cookies |
| `wait` | Wait for elements, network idle, or page stability |

## Channel SDK

The server includes a Channel SDK (`@gettalon/mcp/channel-sdk`) for building Claude Code channels with full hook support:

- **Bidirectional chat** via `claude/channel` capability
- **Permission relay** via `claude/channel/permission` — approve/deny tool use from the browser
- **All 23 hook events** forwarded over Unix socket IPC
- **Client modes** — `chat`, `monitor`, `full`, or `custom` event filtering

```typescript
import { ChannelServer } from "@gettalon/mcp/channel-sdk";

const channel = new ChannelServer({
  name: "my-channel",
  version: "1.0.0",
  instructions: "Channel instructions for Claude",
  permissionRelay: true,
  extraTools: [],
});

channel.onHookEvent((input) => {
  console.log(input.hook_event_name, input);
});

channel.onPermissionRequest((request) => {
  // Show permission UI, then respond
});

await channel.start();
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TALON_MCP_PORT` | `21567` | WebSocket server port for Chrome extension |

## Requirements

- Node.js >= 18
- Chrome with Talon browser extension

## License

MIT
