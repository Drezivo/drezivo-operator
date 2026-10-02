# Drezivo Operator

The internal Drezivo operator system in one repository: the operator API (backend) and the
operator web console (frontend). The business system (storefront, landing page, business
workspace, business API, worker, contracts, docs) lives in the separate `Drezivo/drezivo`
monorepo.

| Folder | Package | What it is |
| --- | --- | --- |
| `api/` | `@drezivo/operator-api` | Express and TypeScript control plane for founders, support, billing, and platform operations. Port 5080 locally. |
| `web/` | `@drezivo/operator-web` | Next.js console used by operators. Port 3010 locally. |

Each folder keeps its own `README.md`, `AGENTS.md`, and docs. Start there before changing it.

## Setup

Use Node.js 22 or newer. One lockfile at the root installs both workspaces:

```bash
npm ci
npm run dev:api     # operator API on :5080
npm run dev:web     # operator console on :3010
```

Root checks run in every workspace: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`. Environment files are local only and never committed, including examples.

## History

Both folders were imported with their full Git history from the former
`Drezivo/Drezivo-Operator-API` and `Drezivo/Drezivo-Operator-Web` repositories, so `git log`
and `git blame` still reach the original commits.
