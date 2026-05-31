#!/usr/bin/env node
/**
 * GetXAPI MCP server — thin, manifest-driven runtime.
 *
 * Holds ZERO hardcoded endpoints. On startup it loads the tool manifest
 * (fetched from the hosted /mcp/manifest, with the bundled manifest.json as
 * offline fallback) and registers every tool dynamically. A single generic
 * handler proxies each call to api.getxapi.com.
 *
 * Auth model:
 *   GETXAPI_KEY  — required. Sent as `Authorization: Bearer` on every call.
 *   X account auth (for write/private tools) comes from EITHER:
 *     - the x_login tool (captured into in-memory session), OR
 *     - env vars: X_AUTH_TOKEN / X_CT0 / X_TWID / X_PROXY
 *   Session (x_login) takes precedence over env for the running process.
 *   Credential fields (auth_token/ct0/twid/proxy) are never seen by the
 *   model; the runtime injects them per the manifest's `placement` map.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ── Config ────────────────────────────────────────────────────────────────
const GETXAPI_KEY = process.env.GETXAPI_KEY;
const MANIFEST_URL =
  process.env.GETXAPI_MANIFEST_URL || "https://api.getxapi.com/mcp/manifest";

if (!GETXAPI_KEY) {
  console.error(
    "[getxapi-mcp] Missing GETXAPI_KEY. Set it in your MCP config:\n" +
      '  "env": { "GETXAPI_KEY": "get-x-api-..." }'
  );
  process.exit(1);
}

// ── Types ───────────────────────────────────────────────────────────────────
type Placement = "query" | "path" | "body";
interface Tool {
  name: string;
  description: string;
  method: string;
  path: string;
  needsAuth: boolean;
  credentials: string[];
  annotations?: Record<string, unknown>;
  placement: Record<string, Placement>;
  inputSchema: Record<string, unknown>;
}
interface Manifest {
  version: string;
  server: string;
  tools: Tool[];
}

// ── In-memory X-account session (set by x_login) ────────────────────────────
const session: {
  auth_token?: string;
  ct0?: string;
  twid?: string;
  proxy?: string;
} = {};

// Resolve X credentials: session (x_login) wins over env vars.
function resolveCreds(): Record<string, string | undefined> {
  return {
    auth_token: session.auth_token || process.env.X_AUTH_TOKEN,
    ct0: session.ct0 || process.env.X_CT0,
    twid: session.twid || process.env.X_TWID,
    proxy: session.proxy || process.env.X_PROXY,
  };
}

// ── Manifest loading: hosted URL, bundled fallback ──────────────────────────
async function loadManifest(): Promise<Manifest> {
  try {
    const res = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(8000) });
    if (res.ok) return (await res.json()) as Manifest;
    console.error(`[getxapi-mcp] manifest fetch ${res.status}; using bundled copy`);
  } catch (err) {
    console.error(
      `[getxapi-mcp] manifest fetch failed (${(err as Error).message}); using bundled copy`
    );
  }
  // Offline fallback: the manifest bundled in the npm tarball. Present in the
  // published package even though it's gitignored (npm "files" allowlist ships
  // it). If both the live fetch and the bundle are unavailable, fail loudly —
  // since tool calls hit the same host, an unreachable manifest means the API
  // itself is unreachable.
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bundled = path.resolve(here, "../manifest.json");
    return JSON.parse(readFileSync(bundled, "utf8")) as Manifest;
  } catch {
    throw new Error(
      `Could not load the tool manifest from ${MANIFEST_URL}, and no bundled ` +
        `fallback was found. Check your network and that api.getxapi.com is reachable.`
    );
  }
}

// ── The generic call handler ────────────────────────────────────────────────
function setupError(tool: Tool) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text:
          `${tool.name} needs your X account auth. Either call x_login first, ` +
          `or set X_AUTH_TOKEN (and optionally X_CT0 / X_TWID / X_PROXY) in your MCP config.`,
      },
    ],
  };
}

async function callEndpoint(
  manifest: Manifest,
  tool: Tool,
  args: Record<string, unknown>
) {
  const creds = resolveCreds();

  // Hard-gate only when auth_token is actually required.
  if (tool.needsAuth && !creds.auth_token) return setupError(tool);

  const query: Record<string, string> = {};
  const body: Record<string, unknown> = {};
  let urlPath = tool.path;

  for (const [field, where] of Object.entries(tool.placement)) {
    let value: unknown;
    if (tool.credentials.includes(field)) {
      // Credentials come from resolved creds (never from the model). Inject
      // them ONLY into tools that require auth. Opportunistic-auth tools
      // (needsAuth:false, e.g. get_article) run unauthenticated/public — we
      // never silently attach the user's X auth to an optional-auth call.
      if (!tool.needsAuth) continue;
      value = creds[field as keyof typeof creds];
    } else {
      value = args[field];
    }
    if (value === undefined || value === null || value === "") continue;

    if (where === "query") query[field] = String(value);
    else if (where === "path") urlPath = urlPath.replace(`{${field}}`, String(value));
    else body[field] = value;
  }

  const qs = Object.keys(query).length ? "?" + new URLSearchParams(query) : "";
  const url = `${manifest.server}${urlPath}${qs}`;

  const res = await fetch(url, {
    method: tool.method,
    headers: {
      Authorization: `Bearer ${GETXAPI_KEY}`,
      "Content-Type": "application/json",
    },
    body: tool.method !== "GET" ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  return { isError: !res.ok, content: [{ type: "text" as const, text }] };
}

// x_login: capture auth into session, but NEVER echo the tokens back to the
// model — return only a safe confirmation.
async function handleXLogin(manifest: Manifest, tool: Tool, args: Record<string, unknown>) {
  const body: Record<string, unknown> = {};
  for (const [field, where] of Object.entries(tool.placement)) {
    const value = tool.credentials.includes(field)
      ? resolveCreds()[field as keyof ReturnType<typeof resolveCreds>]
      : args[field];
    if (value === undefined || value === "") continue;
    if (where === "body") body[field] = value;
  }
  const res = await fetch(`${manifest.server}${tool.path}`, {
    method: tool.method,
    headers: { Authorization: `Bearer ${GETXAPI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data?.auth_token) {
    // Surface the real backend reason. The API returns { error: "Wrong
    // password" } / { error: "Account locked..." }; fall back to msg/status.
    const reason = data?.error || data?.msg || `HTTP ${res.status}`;
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Login failed: ${reason}` }],
    };
  }
  session.auth_token = data.auth_token;
  if (data.ct0) session.ct0 = data.ct0;
  if (data.twid) session.twid = data.twid;
  if (typeof args.proxy === "string") session.proxy = args.proxy;

  const handle = data?.profile?.screen_name || data?.profile?.userName || args.username;
  return {
    content: [
      {
        type: "text" as const,
        text: `Logged in to X as @${handle}. Write and private tools are now enabled for this session.`,
      },
    ],
  };
}

// ── Boot ────────────────────────────────────────────────────────────────────
async function main() {
  const manifest = await loadManifest();
  const byName = new Map(manifest.tools.map((t) => [t.name, t]));

  const server = new Server(
    { name: "getxapi", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: manifest.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      ...(t.annotations ? { annotations: t.annotations } : {}),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = byName.get(req.params.name);
    if (!tool) {
      return { isError: true, content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }] };
    }
    const args = (req.params.arguments || {}) as Record<string, unknown>;
    try {
      if (tool.name === "x_login") return await handleXLogin(manifest, tool, args);
      return await callEndpoint(manifest, tool, args);
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Error: ${(err as Error).message}` }] };
    }
  });

  await server.connect(new StdioServerTransport());
  console.error(
    `[getxapi-mcp] ready — ${manifest.tools.length} tools (manifest ${manifest.version})`
  );
}

main().catch((err) => {
  console.error("[getxapi-mcp] fatal:", err);
  process.exit(1);
});
