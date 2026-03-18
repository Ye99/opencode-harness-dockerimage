# OpenCode Harness Server - Product Design Document

**Feature Branch**: `001-opencode-harness-server`
**Created**: 2026-03-17
**Status**: In Progress

## Overview

A containerized OpenCode harness server that runs `opencode web` headlessly inside Docker against a target project workspace mounted from `<host-project-workspace>` into the container. Engineers connect via native TUI or web UI to steer coding or code review tasks with the same packaged image, similar to [OpenAI's Harness Engineering](https://openai.com/index/harness-engineering/).

## Problem Statement

Engineers need a packaged, ready-to-use OpenCode environment where they can:
- Connect to a headless containerized OpenCode instance
- Steer interactive code-writing and code-review workflows
- Use pre-bundled skills (`obra/superpowers`) without manual setup
- Authenticate via OCA OAuth with minimal configuration

## Design Decisions

### Runtime Model

| Decision | Rationale |
|----------|-----------|
| Run `opencode web` as PID 1, bound to `0.0.0.0:4096` | Only mode satisfying both native web UI and remote TUI attachment against the same backend session |
| Mount host project workspace `<host-project-workspace>` at fixed container path `/workspace` | Simple, testable Docker usage with deterministic readiness checks |
| Separate harness image from the target project's own Dockerfile/build setup | Different product boundaries - this is OpenCode runtime, not the mounted project's runtime image |
| Thin entrypoint script with preflight checks | Fail fast on missing mounts, verify bundled dependencies, then `exec` OpenCode for correct signal handling |
| Reuse native OpenCode session/message/history flow | No harness-owned queue layer - keeps built-in Web UI and TUI attached directly to the headless instance |
| Use one image tag `opencode-harness` for both coding and code review | Same runtime contract serves both workflows; no separate `:dev` image split |

### Ports and OAuth

| Port | Purpose |
|------|---------|
| `4096` | Main OpenCode access port (native web UI + TUI attachment) |
| `48801` | OCA OAuth callback port for browser redirect completion |

| Decision | Rationale |
|----------|-----------|
| Explicit two-port design | Deterministic Docker contract and README documentation |
| Use upstream default port `4096` | Aligns with documented `opencode web --port 4096` and `opencode attach http://localhost:4096` |
| Callback bind to `0.0.0.0:48801` | Published host port can forward browser redirects into container |
| Same-host browser OAuth as supported path | Simplest reliable operator contract for initial release |
| Pinned upstream `opencode-oca-auth` source from `https://github.com/Ye99/opencode-oca-auth` with a container bind patch | GitHub is the source of truth; Docker build bakes a pinned upstream revision into the image and applies the minimal container patch without relying on any host-installed copy |

### Authentication and Model

| Decision | Rationale |
|----------|-----------|
| OpenCode's built-in per-user login only | Feature spec rejected second container-specific login layer |
| Successful OpenCode auth = full workspace authorization | Single trusted workspace per service; no separate ACL source |
| Baked-in `opencode-oca-auth` from a pinned upstream revision at `/opt/opencode/plugins/` | Reproducible environment, no host-installed copy, and no plugin fetch at container startup |
| Default model `oca/gpt-5.4` | User requirement; configured in `opencode.json` not CLI flags |

### Bundled Skills

| Decision | Rationale |
|----------|-----------|
| Pinned upstream `obra/superpowers` source from `https://github.com/obra/superpowers` at `/opt/opencode/skills/superpowers` | GitHub is the source of truth; Docker build bakes a pinned upstream revision into the image and stays offline-ready at startup |
| Bundle the upstream Superpowers plugin plus skills/support files during image build | Preserves bootstrap behavior and supporting files without relying on any host-installed copy or startup-time fetch |

## Architecture

### Container Structure

```
.
├── Dockerfile                    # Node 22 slim + opencode-ai@1.2.27
├── README.md                     # Operator guide
├── config/
│   └── opencode.json             # Server config, default model, plugins
├── scripts/
│   ├── opencode-harness-entrypoint
│   ├── install-superpowers.sh
│   └── patch-upstream-sources.mjs
└── vendor/
    ├── sources.lock.json         # Upstream repo URLs and pinned revisions used by Docker build
    ├── opencode-oca-auth/        # Pinned upstream source from Ye99/opencode-oca-auth
    └── superpowers/              # Pinned upstream source from obra/superpowers
```

The Docker build copies the pinned upstream source trees from `vendor/` into the image, applies the required container-specific patches, and installs the resulting plugin/skills layout under `/opt/opencode`. The running container does not fetch `superpowers` or `opencode-oca-auth` from the network.

### Docker Environment

```dockerfile
FROM node:22-slim

ENV OPENCODE_CONFIG=/opt/opencode/opencode.json
ENV OPENCODE_CONFIG_DIR=/opt/opencode
ENV OPENCODE_SERVER_PORT=4096
ENV OPENCODE_SERVER_HOST=0.0.0.0
ENV OCA_OAUTH_BIND_HOST=0.0.0.0
ENV OCA_OAUTH_CALLBACK_PORT=48801
ENV SUPERPOWERS_SKILLS_DIR=/opt/opencode/skills
ENV WORKSPACE_DIR=/workspace
ENV BROWSER=/bin/true

EXPOSE 4096 48801
ENTRYPOINT ["/usr/local/bin/opencode-harness-entrypoint"]
```

### OpenCode Configuration

```json
{
  "model": "oca/gpt-5.4",
  "server": {
    "port": 4096,
    "hostname": "0.0.0.0"
  },
  "plugin": [
    "file:///opt/opencode/plugins/opencode-oca-auth",
    "file:///opt/opencode/plugins/superpowers.js"
  ],
  "provider": {
    "oca": {
      "models": {
        "gpt-5.4": {}
      }
    }
  }
}
```
## User Stories

### US1: Connect to a Ready Harness Workspace (P1)

**As** an engineer, **I want** to start a packaged OpenCode harness service and connect to a ready workspace **so I can** use the headless containerized OpenCode instance through its native web UI or TUI.

### US2: Steer a Coding Run (P2)

**As** an engineer, **I want** to send coding prompts through the running OpenCode session and steer it with follow-up instructions **so I can** iteratively guide code-writing work.

### US3: Request Code Review (P3)

**As** a reviewer, **I want** to request a code review from the running OpenCode session **so I can** receive structured findings, evidence, and file references.

## Contracts

### Runtime Access Contract

**Service Readiness** (all must be true before user session starts):
- OpenCode running in headless web mode
- Host project workspace `<host-project-workspace>` mounted at `/workspace`
- Mounted `<host-project-workspace>` writable for write-mode runs
- OAuth callback port reachable
- `opencode-oca-auth` installed and available
- Bundled `obra/superpowers` skills visible
- Plugin and skills assets already baked into the image at build time

**Failure Contract** - must fail fast with actionable errors for:
- Missing or read-only `<host-project-workspace>` mount
- Unavailable or conflicting access/callback ports
- Missing `opencode-oca-auth` or bundled skills

### OAuth Callback Contract
- Browser login starts from packaged OpenCode environment
- Public redirect target: `http://127.0.0.1:48801/auth/oca`
- Baked-in `opencode-oca-auth` plugin binds to `0.0.0.0:48801` for Docker port forwarding
- Callback failure surfaced as startup/login-blocking error

## Operator Guide

### Build

```bash
docker build -f Dockerfile -t opencode-harness .
```

### Run

```bash
docker run -it \
  --name opencode-harness \
  -p 127.0.0.1:4096:4096 \
  -p 127.0.0.1:48801:48801 \
  -v "<host-project-workspace>:/workspace" \
  opencode-harness
```

Replace `<host-project-workspace>` with the host path of the project you want OpenCode to operate on.
If the engineer stops and later restarts the same container with `docker start -ai opencode-harness`, the container keeps its auth state and does not require another login.

### Optional Auth-State Backup

Create a local backup directory if auth should survive deleting and recreating the container:

```bash
mkdir -p .opencode-state
```

Add this extra mount to `docker run`:

```bash
-v "./.opencode-state:/root/.local/share/opencode"
```

The local `./.opencode-state/` directory stores auth/session state outside the container and must be gitignored.

### OAuth Login
1. Start login from the running container shell, for example: `docker exec -it opencode-harness opencode auth login`
2. Choose `oca` provider
3. On host, the engineer opens the given URL in a browser and completes the OAuth flow.
4. Browser redirects to `http://127.0.0.1:48801/auth/oca`

If the container is deleted, the engineer must run `docker exec -it opencode-harness opencode auth login` again before OCA prompts will work unless the optional auth-state backup mount is reused.

### Connect via TUI
```bash
opencode attach http://127.0.0.1:4096
```

### Connect via Web UI
Open `http://127.0.0.1:4096` in browser on same host.

### Verify Environment
```bash
curl http://127.0.0.1:4096/global/health
docker exec -it opencode-harness opencode debug config
docker exec -it opencode-harness opencode models oca
docker exec -it opencode-harness opencode -m oca/gpt-5.4 run "what skills do you have? what mcp do you have"
```
