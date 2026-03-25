#!/usr/bin/env node

// Talon Native Messaging Host
// Chrome launches this process to let the extension read local discovery files.
// Protocol: Chrome native messaging uses length-prefixed JSON over stdio.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const TALON_DIR = join(homedir(), ".talon");

function readDiscovery() {
  try {
    const port = readFileSync(join(TALON_DIR, "rc_port"), "utf-8").trim();
    const token = readFileSync(join(TALON_DIR, "browser_bridge_token"), "utf-8").trim();
    return { port: Number(port), token, status: "ok" };
  } catch {
    return { port: null, token: null, status: "not_found" };
  }
}

// Read a native messaging message (4-byte length prefix + JSON)
function readMessage() {
  return new Promise((resolve) => {
    let headerBuf = Buffer.alloc(0);

    const onData = (chunk) => {
      headerBuf = Buffer.concat([headerBuf, chunk]);
      if (headerBuf.length >= 4) {
        const msgLen = headerBuf.readUInt32LE(0);
        const body = headerBuf.slice(4, 4 + msgLen);
        if (body.length >= msgLen) {
          process.stdin.removeListener("data", onData);
          resolve(JSON.parse(body.toString()));
        }
      }
    };

    process.stdin.on("data", onData);
  });
}

// Write a native messaging message (4-byte length prefix + JSON)
function writeMessage(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(json.length, 0);
  process.stdout.write(buf);
  process.stdout.write(json);
}

// Main loop — handle messages from extension
async function main() {
  while (true) {
    try {
      const msg = await readMessage();

      if (msg.type === "discover") {
        writeMessage(readDiscovery());
      } else if (msg.type === "ping") {
        writeMessage({ type: "pong" });
      } else {
        writeMessage({ error: `Unknown message type: ${msg.type}` });
      }
    } catch {
      // stdin closed — extension disconnected
      break;
    }
  }
}

main();
