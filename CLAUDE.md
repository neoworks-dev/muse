# Muse — Codebase Guide

## What it is

Electron desktop app: infinite spatial canvas where users place notes, documents, images, PDFs, bookmarks, and drawings. An AI assistant (AIChat) lives in a floating window and can read the canvas, modify it, and help with documents.

## Stack

| Layer | Tech |
|---|---|
| Framework | SvelteKit + Svelte 5 runes (`$state`, `$derived`, `$effect`) |
| Canvas | PixiJS 8.x — GPU-accelerated 2D, no manual render loop |
| Canvas filters | pixi-filters v6 (`DropShadowFilter`) |
| Document editor | CodeMirror 6 + `@codemirror/lang-markdown` + `@replit/codemirror-vim` |
| Styling | Tailwind CSS v4 + DaisyUI v5 |
| Icons | phosphor-svelte |
| Markdown | marked v18 |
| AI | Direct fetch to Anthropic / OpenAI / Google APIs |
| Storage | localStorage (settings, window positions) + IndexedDB via `idbGet`/`idbPut` (AI threads, canvas state) |
| Runtime | Electron 42 — `webSecurity: false` so renderer can call AI APIs directly without CORS |

## Project layout

```
src/
  routes/
    +page.svelte          # Single page — all canvas orchestration (~870 lines)
    layout.css            # Global CSS, base font 16px, DaisyUI theme "muse"
  lib/
    state.svelte.ts       # Global reactive state: canvas, ui, history
    settings.ts           # AppSettings type + loadSettings/saveSettings (localStorage)
    ai.ts                 # streamCompletion() — SSE streaming to all providers
    storage.svelte.ts     # idbGet / idbPut wrappers + saveStatus / markDirty
    api/
      models.ts           # fetchModels() — live model list from each provider API
      image-gen.ts        # DALL-E image generation
      web-search.ts       # Jina / Brave / Tavily / SearXNG
      sketch-generate.ts  # Sketch → AI analysis
    canvas/
      core/
        CanvasRenderer.ts # Root pixi app, mounts to <canvas>, owns all renderers
        Camera.ts         # Pan/zoom, worldToScreen / screenToWorld
        BaseObjectRenderer.ts  # Base class for all object renderers
        types.ts          # ToolId, ContextMenuItem, etc.
      objects/            # One renderer per object type
        NoteRenderer.ts
        DocumentRenderer.ts   # Also builds canvas-2d preview texture
        MediaRenderer.ts
        FolderRenderer.ts
        LinkRenderer.ts
        BookmarkRenderer.ts
        StrokeRenderer.ts
        rendererFactory.ts
      tools/              # Tool implementations (select, draw, erase, link, document)
      utils/              # geometry, easing, ids, view helpers
  components/
    FloatingWindow.svelte      # Draggable/resizable window primitive
    Dropdown.svelte            # Relative-positioned dropdown menu
    ModelPicker.svelte         # Searchable model selector (lives inside FloatingWindow/Dropdown)
    AIChat/
      AIChat.svelte            # Main AI chat — threads, memory, canvas actions
      AIChatButton.svelte      # Trigger button
    document-editor/
      DocumentEditor.svelte    # CodeMirror editor inside a FloatingWindow
      cm-setup.ts              # CodeMirror extensions, theme, markdownStyle
      useAnnotations.svelte.ts
      useAnnotTooltip.svelte.ts
      useAiTransforms.svelte.ts
      useDiff.svelte.ts
    BookmarkWindow.svelte      # Webview window (bookmarks + PDFs)
    SettingsOverlay.svelte     # Settings floating window
    SketchOverlay.svelte       # Full-screen drawing overlay
    Toolbar.svelte
    ProfileBar.svelte
    ContextMenu.svelte
    CommandPalette/
electron/
  main.js                # Electron main: frameless window, app:// protocol, webSecurity: false
```

## Global state (`src/lib/state.svelte.ts`)

Two reactive singletons — import and use directly anywhere:

```ts
canvas = { objects, selection, camera, folderStack }
ui     = { activeTool, aiChatOpen, settingsOpen, openDocumentIds, openPdfIds, openBookmarkIds, ... }
```

History is a 100-deep snapshot stack; `pushHistory()` / `undo()` / `redo()` operate on `canvas`.

### Object types

```ts
NoteData     — { type:'note',     body, x, y }
DocumentData — { type:'document', content, title, x, y }
FolderData   — { type:'folder',   title, x, y }
MediaData    — { type:'media',    src, mediaType:'image'|'video'|'gif'|'pdf', w, h, x, y }
BookmarkData — { type:'bookmark', url, title, domain, favicon, x, y }
LinkData     — { type:'link',     fromId, toId, label, direction }
StrokeData   — { type:'stroke',   points, color, width }
```

`visibleObjects()` filters by current `folderStack` scope.

## FloatingWindow

The single reusable window primitive. All floating UI uses it.

**Props:** `open` (bindable), `width`, `height`, `minwidth`, `minheight`, `center`, `x`, `y`, `zIndex`, `origin` (swoosh-in animation), `storageKey`.

**storageKey** persists `{ x, y, w, h, fs }` to localStorage. Saves on drag-end, resize-end, and fullscreen toggle. Restores position on re-open; clamps to current viewport on mount.

**Placement:** On first open — center: centers in viewport; non-center: clamps `x` to `Math.max(20, Math.min(x, vw-w-20))`, `y` to bottom-ish. Pass `x=999999` to right-align.

**overflow:** Inner div has no `overflow-hidden` so absolute-positioned children (ModelPicker panel) bleed outside the window boundary.

**storageKey naming conventions:**
- Document editor: `doc:{id}:win`
- PDF viewer: `pdf:{id}:win`
- Bookmark: `bookmark:{url}:win`
- Settings: `settings:win`
- AIChat: `aichat:fs` (legacy name, stores full state)

## AI integration

### `streamCompletion(messages, system?, signal?, modelOverride?)`

Reads `loadSettings()` for provider/key/model. Streams SSE. Supports Anthropic, OpenAI, Google, and custom OpenAI-compatible endpoints.

### AI provider model fetching (`src/lib/api/models.ts`)

`fetchModels(provider, apiKey, customBaseUrl?)` hits each provider's model list API. Returns `{ id, name, description? }[]`. CORS works because Electron runs with `webSecurity: false`.

### AIChat system prompt tags

The AI can embed special tags in its responses:
- `<remember>…</remember>` — stored in per-session memory, injected into future system prompts
- `<canvas-actions>[…]</canvas-actions>` — JSON array of canvas mutations, shown as "Apply" prompt to user
- `<web-search>query</web-search>` — triggers a real web search, results fed back for a second completion pass
- `<sources>[…]</sources>` — cited URLs shown as cards under the assistant message

### Canvas action types

`move_element`, `add_note`, `create_link`, `group_elements`, `generate_image`, `open_document`, `create_document`, `place_image`

## Document editor

CodeMirror 6 inside a FloatingWindow. Markdown only. Features:
- Annotations (highlight ranges with notes, shown as sidebar)
- AI transforms (rewrite selection via streaming)
- Diff view with accept/reject per chunk
- Vim mode (toggle in settings)
- Preview texture rendered to canvas via `DocumentRenderer.buildPreviewTexture()` — custom canvas-2d markdown renderer, NOT html2canvas

## DocumentRenderer preview

Canvas-2d based (not DOM). Renders headings, paragraphs, code blocks, blockquotes, lists, hr. Code blocks use `ctx.save()/clip()/restore()` to prevent line overflow. Preview is 360×510px (A4 ratio), stored as a Pixi Texture on the canvas object.

## Dropdown

Relative-positioned dropdown (no `overflow-hidden`) with `align: top-left | top-right | bottom-left | bottom-right`. Used for attachment picker and AI options in AIChat.

## ModelPicker

Searchable model list inside a `position: absolute` panel (requires parent to have `overflow: visible`). Auto-fetches model list on first open. Resets cache when provider/apiKey/baseUrl changes. Has refresh button, search filter, "use typed string as model ID" escape hatch, and "reset to provider default" option.

## Settings

`AppSettings` in localStorage under `muse:settings`. Providers: anthropic, openai, google, custom. Search providers: jina, brave, tavily, searxng, none. Also stores: vim mode, image model (DALL-E), search API key, SearXNG URL.

## Electron main

- Frameless window (`frame: false`), 1400×900 default
- `webSecurity: false` — disables CORS, allows renderer to call any API directly
- `app://` custom protocol serves the production build
- `webviewTag: true` for BookmarkWindow webviews (bypasses X-Frame-Options)

## Key patterns & conventions

**Svelte 5 runes only.** No Svelte stores, no `$:` reactive blocks. Use `$state`, `$derived`, `$derived.by`, `$effect`.

**No comments unless non-obvious.** Code is self-documenting via naming.

**Canvas object pivot system.** All interactive objects set `pivot = (halfW, halfH)` so scale animations radiate from center. Position represents visual center. `x/y` in data is top-left (position minus pivot).

**Single-click opens.** Every canvas object opens on single click (note editor, doc editor, folder nav). Only suppressed if pointer moved >5px.

**Pixi rendering.** Objects are Pixi `Container` subclasses managed by renderer classes in `src/lib/canvas/objects/`. `CanvasRenderer` owns the Pixi app and all renderers. No manual render calls — Pixi auto-renders.

**IDB persistence.** Canvas state, AI threads, and AI memories go to IndexedDB via `idbGet`/`idbPut`. Settings and window positions go to localStorage.

**Text sizes.** Base font is 16px. Tailwind rem classes scale from that. Absolute px classes (`text-[13px]` etc.) are used for dense UI areas. Document editor text is managed by CodeMirror's own theme — don't apply global font size changes there.
