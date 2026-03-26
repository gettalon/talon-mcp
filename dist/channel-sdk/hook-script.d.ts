#!/usr/bin/env node
/**
 * Talon Channel SDK — Hook Script
 *
 * This is the `type: "command"` script that Claude Code spawns for each hook event.
 * It reads JSON from stdin, forwards it to the ChannelServer via Unix socket,
 * optionally waits for a response, and writes the response JSON to stdout.
 *
 * Usage in settings.json:
 *   {
 *     "hooks": {
 *       "PreToolUse": [{
 *         "hooks": [{
 *           "type": "command",
 *           "command": "node dist/channel-sdk/hook-script.js --socket ~/.talon/channel-hooks.sock"
 *         }]
 *       }]
 *     }
 *   }
 */
export {};
