<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Console navigation

- Treat the authenticated operator console as one persistent shell. Move between its regular views with Next.js client-side links so the main content changes while the brand, sidebar, and session controls remain mounted.
- Preserve the sidebar's exact scroll position across view links, business-detail links, and browser Back/Forward navigation. Keep a browser-level QA check for this behavior when changing routing or shell state.
- A separate area such as Settings may use a different sidebar and its own item tabs. Put it in a distinct route/layout shell with an obvious link back to the operator console. Let Next.js transition between shells; do not force a document reload with `window.location` for internal routes.
- Add Settings pages only when their behavior has an approved API and permission contract. Do not present placeholder controls as working settings.
