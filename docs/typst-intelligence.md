# Typst intelligence

Compiler errors appear as red squiggles in text boxes and Shared styles. Hover a squiggle to read the message, or expand **Errors** for the complete compiler output. These diagnostics use the bundled WebAssembly compiler and work without any setup, including in the static GitHub Pages build.

For semantic completion and symbol hover, connect the editor to the actual [Tinymist language server](https://myriad-dreamin.github.io/tinymist/). Tinymist resolves built-in Typst symbols, local variables, and functions defined in Shared styles. Suggestions come from the language server's analysis of the current document. This integration supports completion replacement edits, additional edits within the active source, hover, and published diagnostics.

## Start Tinymist locally

1. Install Tinymist using its [official installation instructions](https://myriad-dreamin.github.io/tinymist/frontend/main.html) or download the binary for your platform from [Tinymist releases](https://github.com/Myriad-Dreamin/tinymist/releases). Ensure `tinymist --version` works in your terminal.
2. In a local checkout of Typstability, run:

   ```bash
   npm install
   npm run lsp
   ```

   For a binary outside `PATH`, use:

   ```bash
   npm run lsp -- --tinymist /absolute/path/to/tinymist
   ```

3. Start the app with `npm run dev`. In the text box or Shared styles source editor, expand **Typst intelligence**. Paste the complete `ws://127.0.0.1:2087/?token=...` URL printed by the bridge, then click **Connect**.
4. Wait for **Tinymist connected**. Type `#let local_answer = 42`, then `#local_ans` on the next line and press **Ctrl+Space**. Tinymist suggests your variable. Hover a symbol for its documentation or inferred value.

The URL is remembered for the current browser tab's session and reused when switching between text boxes and Shared styles. **Disconnect** stops sending source. Restarting the bridge generates a new token; paste its new URL and reconnect. If a connection fails, the editor displays the reason and **Connect** retries it. A browser that blocks the connection may require permission to access local network services.

## Other origins and HTTPS

The bridge binds only to `127.0.0.1` and accepts the Vite development/preview origins on ports 5173 and 4173 by default. To use another port or a deployed app, explicitly allow its origin:

```bash
npm run lsp -- --origin https://your-account.github.io
```

Use a comma-separated list to allow multiple exact origins. Origins include a scheme, host, and optional port, without a repository path. `--port 2088` changes the listening port. The random URL token and origin check are both required; the bridge is not a public server.

Some browsers reject an HTTP WebSocket from an HTTPS app even on loopback. In that case, use the local development app, or put the bridge behind a WebSocket-capable TLS reverse proxy and connect with `wss://`. Non-loopback connections must use `wss://`; a remote service must implement the bridge's initial `typstability/ready` workspace notification as well as JSON-RPC messages. Do not expose the bridge directly to the internet.

## How source positions stay accurate

The compiler and language server receive the same virtual `.typ` document: bundled text/page defaults, Shared styles, box geometry/fill, and the box's content. Source ranges are recorded when this wrapper is built. Completions, hover, and diagnostics map back to the active section; generated settings and hidden source sections do not acquire misleading squiggles in the active editor. Shared-style functions therefore resolve from a text box, while diagnostics for those definitions appear in the Shared styles editor.

Compiler ranges use Unicode scalar columns; LSP explicitly negotiates UTF-16 positions to match CodeMirror. The full compiler diagnostics preserve the actual end position. Point-only diagnostics from earlier compiler messages also work. Compiler initialization/network failures with no source location remain in **Errors** rather than marking arbitrary text.

The bridge creates one temporary workspace and `tinymist lsp` process per active editor connection. Unsaved source is synchronized through LSP `didOpen`/`didChange`; it is not written to the workspace. Closing or switching editors closes that connection and terminates its process. The temporary workspace is removed. Bundled font paths are passed to Tinymist so analysis uses the New Computer Modern fonts shipped by this app.

## Scope and privacy

The static app still compiles, renders, and exports locally. Connecting sends the active Typst source and Shared styles to the selected server; PDF bytes, images, and the project library are not sent. The default connection is to your own computer. Tinymist may access local files or download Typst packages as part of its usual analysis, so use source and a server that you trust.

Tinymist is a separate native program, not a browser WebAssembly language server. This integration does not add go-to-definition, refactorings, file uploads, or package management. Completion items support plain text and numbered argument placeholders with Tab/Shift+Tab navigation. Complex snippet variables/transforms and edits outside the active source are omitted. Relative imports cannot resolve browser-only project assets in the temporary workspace. Browser compiler and installed Tinymist versions can also differ; the bundled compiler's diagnostics remain authoritative for the preview/export.

## Validation

`npm test` covers wrapper/source mapping, multiline styles, Unicode, protocol initialization, synchronization, stale diagnostic versions, completion edits, disconnects, and actual CodeMirror squiggles. To exercise the shipped client and bridge against a real installed Tinymist:

```bash
npm run test:lsp
# Or:
npm run test:lsp -- /absolute/path/to/tinymist
```

The real-server test checks built-in functions, a user-defined symbol from Shared styles, completion, hover, mapped error ranges, diagnostics clearing, and bridge token/origin authorization. It is separate from ordinary tests because it requires a native Tinymist binary and permission to listen on loopback.

Protocol references: [Tinymist CLI](https://myriad-dreamin.github.io/tinymist/feature/cli.html), [LSP specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/), and [typst.ts compiler diagnostic conversion](https://github.com/Myriad-Dreamin/typst.ts/blob/main/packages/compiler/src/lib.rs).
