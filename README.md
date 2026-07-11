# MAZEN

## Whapi MCP setup

This repo is configured to connect Claude Code to [Whapi Cloud](https://whapi.cloud)'s
WhatsApp API through a project-scoped [MCP](https://modelcontextprotocol.io) server
(`.mcp.json`), following
[Whapi's MCP integration guide](https://support.whapi.cloud/help-desk/ai-tools/mcp-model-context-protocol).

### Prerequisites

- Node.js 18+
- A Whapi API token (from your channel dashboard at https://panel.whapi.cloud)

### Configure your token

The server reads its token from the `WHAPI_API_TOKEN` environment variable, which
`.mcp.json` maps to the `API_TOKEN` variable the `whapi-mcp` server expects. Export it in
your shell before starting Claude Code — do not commit the token itself:

```bash
export WHAPI_API_TOKEN="YOUR_TOKEN"
```

### Start it

Launch `claude` in this directory; Claude Code will prompt you to approve the
project-scoped `whapi-mcp` server on first use (or run `/mcp` to check its status).
It runs via `npx -y whapi-mcp@latest`, so no separate install step is needed.

### Available tools

Tools are generated dynamically from Whapi's OpenAPI spec, e.g. `sendMessageText`:

```
name: sendMessageText
arguments: { "to": "1234567890@s.whatsapp.net", "body": "Hello" }
```
