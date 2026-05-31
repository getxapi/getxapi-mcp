# GetXAPI MCP — Twitter/X API for Claude, Cursor & any MCP client

[![npm](https://img.shields.io/npm/v/@getxapi/mcp.svg)](https://www.npmjs.com/package/@getxapi/mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

The official **[GetXAPI](https://www.getxapi.com)** MCP server. Give your AI assistant
direct access to the Twitter/X API — **search tweets, look up users, read
replies and followers, and post tweets, send DMs, manage articles, and more** —
through one [Model Context Protocol](https://modelcontextprotocol.io) server.

Unlike read-only Twitter MCP servers, GetXAPI MCP can **act**: post tweets,
reply, like, retweet, send DMs, and publish articles — not just read.

→ **[Get a free API key at getxapi.com](https://www.getxapi.com)** · **[API docs](https://docs.getxapi.com)** · **[Pricing](https://www.getxapi.com/pricing)** ($0.001/call, $0.05 per 1,000 tweets)

---

## Install

Add it to your MCP client config (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "getxapi": {
      "command": "npx",
      "args": ["-y", "@getxapi/mcp@latest"],
      "env": {
        "GETXAPI_KEY": "get-x-api-..."
      }
    }
  }
}
```

Get your `GETXAPI_KEY` from your [GetXAPI dashboard](https://www.getxapi.com). That's
all the **read** tools need.

Or via the Claude Code CLI:

```bash
claude mcp add getxapi -- npx -y @getxapi/mcp@latest
```

---

## What you can do

Once installed, just ask your assistant naturally:

> "Find Elon Musk's latest tweets"
> "Search tweets about OpenAI from the last week"
> "Who are @vercel's verified followers?"
> "Get the replies to this tweet: 1799…"
> "Post 'shipping 🚀' to my X account"   *(requires X auth — see below)*

---

## Read vs. write tools

| | Needs | Examples |
|---|---|---|
| **Read** | `GETXAPI_KEY` only | search tweets, user info, followers/following, replies, mentions, user tweets, lists |
| **Write / private** | `GETXAPI_KEY` **+ X account auth** | post / reply / like / retweet / bookmark / delete tweet, send DM, read DMs/timeline/bookmarks, publish articles, update profile |

### Enabling write tools

Write and private tools act on a real X account, so they need that account's
auth. Two ways to provide it:

**Option A — log in through the assistant** (convenient):

> "Log in to my X account"

The assistant calls the `x_login` tool with your credentials and keeps the
session for write tools.
⚠️ Your X password is passed as tool arguments, so it transits the AI model's
context. For sensitive accounts, prefer Option B.

**Option B — set credentials in config** (recommended for sensitive accounts):

```json
{
  "mcpServers": {
    "getxapi": {
      "command": "npx",
      "args": ["-y", "@getxapi/mcp@latest"],
      "env": {
        "GETXAPI_KEY": "get-x-api-...",
        "X_AUTH_TOKEN": "...",
        "X_CT0": "...",
        "X_TWID": "...",
        "X_PROXY": "http://user:pass@host:port"
      }
    }
  }
}
```

`X_CT0`, `X_TWID`, and `X_PROXY` are optional — `X_AUTH_TOKEN` alone is enough
for most write tools; the others improve reliability on some accounts.

Your X password never touches the model. The credential fields are never shown
to the AI — the server injects them only into the calls that need them.

---

## How billing works

Every tool call is a normal GetXAPI API call authenticated with your
`GETXAPI_KEY`, metered exactly like direct API usage. No separate MCP billing.
See [pricing](https://www.getxapi.com/pricing).

---

## Links

- 🌐 **Website:** [getxapi.com](https://www.getxapi.com)
- 📚 **API docs:** [docs.getxapi.com](https://docs.getxapi.com)
- 💳 **Pricing:** [getxapi.com/pricing](https://www.getxapi.com/pricing)
- 🔑 **Get an API key:** [getxapi.com](https://www.getxapi.com)

GetXAPI is an independent third-party API for developers and researchers. Not
affiliated with, endorsed by, or sponsored by X Corp.

## References

- [Wikidata Q139996278](https://www.wikidata.org/wiki/Q139996278) — structured entity record
- [npm: @getxapi/mcp](https://www.npmjs.com/package/@getxapi/mcp)
- [Apify](https://apify.com/getxapi)
- [Substack](https://getxapi.substack.com)

## License

MIT
