> [!NOTE]  
> Yes this is like 100% vibe coded. No guarantees are made that this will actually long term preserve your data, as I don't fully trust the code to be properly using IndexDB and I haven't audited it at all. Everything else in this repo, other than this note, is 100% vibe coded.

# Typstability

A minimal, local-first PDF editor with Typst text boxes. Open a PDF, add images, draw, insert blank pages, and export a new PDF without uploading the document.

## Editing

- Choose the **Text** tool, then drag on a page to create a text box. The bundled Typst WebAssembly compiler keeps a long-lived incremental compilation session, so the preview updates as you type.
- Empty text boxes keep a dashed outline and can be clicked in Select or Text mode to reopen and focus the source editor. Dragging in Text mode can overlap existing boxes. Corner handles resize width and height freely; hold **Shift** to preserve proportions.
- Text boxes can be created with very small drags. They start with a 4 pt top inset to protect tall first-line glyphs; adjust **Top inset** in the inspector, including setting it to 0 pt when needed.
- Boxes have a white background by default. Use `#set page(fill: rgb("#f5f0e6"))` in Shared styles for a common color, or enter a Typst fill expression in a box’s **Fill (Typst)** field. Enter `none` for transparency.
- Drag the editor sidebar’s left edge to make more room for source. Its width is remembered for text boxes and Shared styles. Double-click the divider to reset, or focus it and use the arrow keys. On narrow screens the editor docks below the page. Resizing the sidebar fits the pages to the available width, up to your preferred zoom. Manual zoom overrides the fit until the next workspace resize.
- The source editor includes bracket pairing, search/replace, folding, and **Format** (`Shift+Alt+F`) powered by Typstyle. Formatting runs locally and can be undone. Compiler errors appear as inline red squiggles at their source positions. For intelligent suggestions and hover from the actual Tinymist language server, expand **Typst intelligence** in the editor and follow the [connection guide](docs/typst-intelligence.md).
- **Editor theme** defaults to GitHub Light/Dark following the site appearance. Choose a fixed GitHub theme, Catppuccin Latte/Frappé/Macchiato/Mocha, or Monokai Light/Dark independently of the site. The preference is saved in this browser and shared by text boxes and Shared styles. GitHub and Monokai Dark use [uiw themes](https://github.com/uiwjs/react-codemirror); Catppuccin uses its [official CodeMirror port](https://github.com/catppuccin/codemirror). Monokai Light is a local light adaptation of the classic dark palette.
- Open **Document styles** in the toolbar, or **Edit document styles** inside any text box editor. Set a shared font size with the quick control, then use **Shared styles source** for fonts, functions, variables, and other Typst rules. Changes apply to every text box, including existing boxes; a box can override them in its own source. Set **Top padding for new text boxes** (4 pt by default) to protect first-line fractions and accents, or explicitly apply it to all existing boxes. Each box retains its own adjustable **Top inset**. These settings autosave and travel with project and editable PDF exports.
- Open **Alignment** to toggle a 12 pt grid and snapping independently. When snapping is enabled, creating or moving text boxes and moving images aligns them to the grid or nearby object edges and centers. Pink guides show matching page/object alignments. Hold **Alt** while dragging to move freely. These view preferences are remembered in this browser and are excluded from PDF/project exports.
- With a text box or image selected, use the arrow keys to nudge it by 1 pt, or hold **Shift** for 10 pt steps. Objects stop at the page edges; nudges support Undo. Arrow keys keep their usual behavior while editing source or form fields.
- Choose **Select** to resize a text box or image, or drag either onto another page. Typst reflows incrementally while a box is resized instead of stretching the old preview.
- Paste images from the clipboard, drag image files onto a page, or use **Insert → Image**. PNG, JPEG, WebP, and GIF are supported; WebP and GIF are converted locally to PNG for PDF export.
- Select an image to open **Image crop**. Drag across its original preview or set edge percentages, then choose **Apply crop**. **Cancel** discards pending changes; **Reset crop** restores the full original. Crops support undo/redo and remain editable in saved projects and exported PDFs.
- Choose **Draw** to draw with a configurable color and radius. Choose **Erase** to remove any pen stroke that touches its configurable eraser radius.
- Inserted blank pages participate in editing and export exactly like pages opened from a PDF.
- The left rail renders miniature PDF pages. Drag thumbnails to reorder pages, or collapse the rail with the panel button above them.
- Pinch the trackpad over a page to zoom around the pointer from 10% to 500%. Two-finger scrolling pans the workspace normally; Ctrl + mouse wheel also zooms. Safari gesture events are supported. The status bar reflects gesture zoom and its controls remain available.
- Exported PDFs contain visible, printable annotations for Typst boxes, images, and pen strokes, plus embedded Typstability metadata. Open an exported PDF again to continue editing the blocks and shared prelude. PDF tools that flatten or discard annotations or private metadata can remove this editability.

## Projects and backups

- **Projects** returns to your library. Choose **Start from a PDF**, **Start a blank document**, or **Import a saved project**. The project menu (•••) has rename, copy, and delete actions.
- Click the project name in the editor to rename it. **Insert** adds an image or a blank page to the current document; it does not create another project.
- Edits autosave to IndexedDB. The toolbar shows **Saving…**, **Saved**, or **Save failed**. Switching projects waits for pending saves, and each opened project starts with its own fresh undo history.
- **Export → Editable project** downloads a `.typstability` file containing the original PDF, inserted images, pages, pen strokes, Typst source, and prelude. **Import a saved project** opens that file as a new project without replacing existing projects.
- **Export → PDF document** creates a PDF whose Typstability annotations can be edited after re-importing it. Use **Export → Editable project** for a more robust backup or to transfer work between browsers; other PDF tools may flatten or discard the editability metadata.
- Projects are local to the browser profile and site origin. Localhost and GitHub Pages have separate storage. Clearing site data removes saved projects; keep exported backups. A save error leaves the current document open for export.
- The previous single-session autosave is migrated into the project library automatically. The old record remains as a backup during migration.

Project files use a versioned JSON format with embedded base64 assets. Imports validate the document structure and PDF page references. Typst source, top inset, and fill are preserved; previews are regenerated from source. Undo history and temporary editor state are not included.

## Bring your own agent

Enable **Agent access** in an open project's status bar to register WebMCP tools for reading and editing the session. Agent edits appear in the editor, autosave, and support Undo. Browser support is experimental; unsupported browsers show a capability message. See [browser requirements and local Codex/Claude connection instructions](docs/agents.md), including an optional local stdio MCP bridge.

## Local development

```bash
npm install
npm run dev
```

## Static build

```bash
npm run build
npm run preview
```

The production build is written to `dist/`. Assets use relative URLs, so the same build works at a GitHub Pages repository subpath.

## GitHub Pages

Live app: https://overthrowing.github.io/typstability/

The deployment workflow runs lint, tests, and a production build before publishing `dist/`.

1. Push the project to a GitHub repository whose default branch is `main`.
2. In **Settings → Pages**, choose **GitHub Actions** as the source.
3. Push to `main`, or run the “Deploy to GitHub Pages” workflow manually.

All PDF processing, incremental Typst compilation, session recovery, and export happen in the browser. The compiler, renderer, WebAssembly modules, and New Computer Modern fonts are bundled into the static build, so the deployed site has no backend and no runtime CDN dependencies.
