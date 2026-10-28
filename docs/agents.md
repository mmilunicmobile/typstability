# Bring your own agent with WebMCP

Open a project, expand **Agent access** in the status bar, and enable **Allow agents to read and edit this session**. Access defaults to off and turns off when you return to Projects. The panel reports registration failures or an unsupported browser instead of claiming a connection exists.

Typstability registers two actual browser tools:

- `typstability_read_session`: document name, shared Typst prelude, ordered pages, element IDs, text-box source and layout, selection, and a revision. PDF/image bytes and generated previews are omitted.
- `typstability_edit_session`: one atomic batch of up to 100 operations. It can rename a document, change the prelude, add/edit/delete text boxes, resize/move images, delete elements, and add/delete/reorder pages. Coordinates are in points. Its input schema lists the operations and fields.

Read first, then pass the returned `revision` when editing. A stale revision or invalid operation rejects the whole batch. Changes use the editor's normal document state: they appear immediately, compile normally, autosave to the current project, and the whole batch can be undone with **Undo**. Preview compilation does not invalidate revisions. Text returned from the document is user content and should not be treated as agent instructions.

This is browser-mediated access to the open project. It does not open a remote server, execute shell commands, supply an LLM, or connect a local agent automatically. A local Codex/Claude agent needs a WebMCP-capable browser connection or the optional stdio bridge below. The application does not send the document to a model; a connected agent controls its own model/data handling.

## Browser support

WebMCP is experimental and requires a secure context (HTTPS or localhost) plus a browser build with the feature enabled. The current [WebMCP specification](https://webmachinelearning.github.io/webmcp/) and [Chrome imperative API guide](https://developer.chrome.com/docs/ai/webmcp/imperative-api) use `document.modelContext.registerTool(tool, { signal })`. Typstability cleans up registration with AbortSignal. Older Chromium builds exposing `navigator.modelContext` with `unregisterTool` are also supported. Unsupported browsers can use every other editor feature normally.

A browser agent can discover these tools through its WebMCP integration. An in-page agent on the same origin can use `document.modelContext.getTools()` and `executeTool()`; see the linked specification for its current call signature. The page does not expose tools to arbitrary cross-origin frames.

## Optional local MCP bridge

The small [bridge](../tools/agent-bridge/bridge.mjs) adapts the open browser tab's WebMCP tools to stdio MCP for local agents. It requires Node.js and [Playwright WebMCP support](https://playwright.dev/docs/next/api/class-webmcp) (added in 1.64; the package uses `next` while this API is experimental). Its dependencies are separate from the static app.

1. Run `npm ci` inside `tools/agent-bridge`. If using Playwright's bundled Chromium, run `npx playwright install chromium` there.
2. Start a dedicated Chromium browser with WebMCP and a loopback debugging port. For example, on macOS with Chrome installed:

   ```sh
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --user-data-dir=/tmp/typstability-agent-profile \
     --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
     --enable-features=WebMCP http://localhost:5173/
   ```

   Use a browser build that includes WebMCP. The debugging connection controls that dedicated browser, so keep the port local. This profile has its own project storage; import an exported editable project when needed.
3. Open exactly one Typstability tab matching the target URL, open the desired project, and enable **Agent access**.
4. Add a local stdio MCP server to your agent using command `node` and argument `/absolute/path/to/typstability/tools/agent-bridge/bridge.mjs`. Set `TYPSTABILITY_URL` to the exact site URL if it differs from `http://localhost:5173/`. Optionally set `TYPSTABILITY_CDP_URL` to another localhost debugging endpoint. The bridge refuses non-local debugging endpoints, matches the configured origin/path, and forwards only the two named session tools.
5. Refresh the agent's MCP tool list after enabling access. Ask it to read the session, make the desired edits, and report what changed. Keep the browser open during the session. Disable **Agent access** to revoke the tools.

For example, after reading the session, an edit call could contain:

```json
{
  "revision": 3,
  "operations": [
    { "action": "update_element", "pageId": "PAGE_ID_FROM_READ", "elementId": "BOX_ID_FROM_READ", "source": "Updated text", "width": 240 },
    { "action": "set_document", "prelude": "#set text(size: 12pt)" }
  ]
}
```

Replace the IDs and revision with the values from the current read. A browser without WebMCP cannot be made compatible by this bridge; use a supported browser build or edit through the UI.

### Codex CLI

After completing the browser steps above, register the bridge using [Codex's stdio MCP setup](https://developers.openai.com/codex/mcp):

```sh
codex mcp add typstability --env TYPSTABILITY_URL=http://localhost:5173/ -- node /absolute/path/to/typstability/tools/agent-bridge/bridge.mjs
codex mcp list
```

Start a local Codex session and use `/mcp` to check the connection. If you register the server before enabling Agent access, restart/reconnect the server after enabling it so Codex discovers the tools. The CLI configuration is also available to supported local Codex integrations.

### Claude Code

Use [Claude Code's local stdio setup](https://code.claude.com/docs/en/mcp#option-3-add-a-local-stdio-server):

```sh
claude mcp add --env TYPSTABILITY_URL=http://localhost:5173/ --transport stdio typstability -- node /absolute/path/to/typstability/tools/agent-bridge/bridge.mjs
claude mcp list
```

Start Claude Code in the same project and use `/mcp` to check/reconnect the server. Replace the placeholder absolute path and URL in either command with your actual checkout and site. These commands configure local agent processes; hosted web chats cannot reach this loopback stdio bridge directly.
