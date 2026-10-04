import {createInterface} from 'node:readline';

// Model Context Protocol over stdio: newline-delimited JSON-RPC 2.0. Only tools are served,
// which keeps the CLI free of the MCP SDK and its dependency tree.
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/**
 * Serve MCP until stdin closes. stdout carries protocol messages only.
 * listTools() returns tool definitions; callTool(name, args) returns a CallToolResult.
 */
export async function serveStdio({name, version, instructions, listTools, callTool}, input = process.stdin, output = process.stdout) {
  const send = message => output.write(JSON.stringify(message) + '\n');
  const fail = (id, code, message) => send({jsonrpc: '2.0', id, error: {code, message}});

  async function handle(message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return fail(message?.id ?? null, -32600, 'Invalid Request');
    // Notifications (initialized, cancelled, …) carry no id and need no reply.
    if (message.id === undefined || message.id === null) return;
    const {id, method, params = {}} = message;
    try {
      if (method === 'initialize') {
        const protocolVersion = PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0];
        return send({jsonrpc: '2.0', id, result: {protocolVersion, capabilities: {tools: {listChanged: false}}, serverInfo: {name, version}, ...(instructions ? {instructions} : {})}});
      }
      if (method === 'ping') return send({jsonrpc: '2.0', id, result: {}});
      if (method === 'tools/list') return send({jsonrpc: '2.0', id, result: {tools: await listTools()}});
      if (method === 'tools/call') {
        if (typeof params.name !== 'string') return fail(id, -32602, 'Invalid params: tool name is required');
        return send({jsonrpc: '2.0', id, result: await callTool(params.name, params.arguments ?? {})});
      }
      return fail(id, -32601, 'Method not found: ' + method);
    } catch (error) {
      return fail(id, -32603, error.message || 'Internal error');
    }
  }

  const pending = new Set();
  for await (const line of createInterface({input, crlfDelay: Infinity})) {
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch { fail(null, -32700, 'Parse error'); continue; }
    // Requests run concurrently so a slow tool call does not block ping or listing.
    for (const item of Array.isArray(message) ? message : [message]) {
      const task = handle(item).finally(() => pending.delete(task));
      pending.add(task);
    }
  }
  await Promise.all(pending);
}
