# Drezivo Operator repository rules

This repository holds the internal operator system only. Business code belongs in the
`Drezivo/drezivo` monorepo; do not copy business invariants here.

- Read the `AGENTS.md` in the folder you are changing: `api/AGENTS.md` or `web/AGENTS.md`.
- Install from the root with the single root `package-lock.json`. Do not add nested lockfiles.
- Keep one React version in the repository. npm hoists shared packages, and two React versions
  give components two copies of React.
- Never commit any `.env*` file, including examples.
- Pull requests merge by squash only.
- Run typecheck, lint, tests, and build for every workspace you touch before opening a pull
  request.
