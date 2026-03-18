# OpenCode Harness Server

Build a single Docker image that packages OpenCode for both coding and code review workflows.

## What it provides

- `opencode web` running headlessly on `0.0.0.0:4096`
- OCA OAuth callback binding on `0.0.0.0:48801`
- baked `opencode-oca-auth` and `superpowers` assets from pinned upstream revisions
- a mounted target project workspace at `/workspace`
- one shared image tag: `opencode-harness`

## Build

```bash
docker build -f Dockerfile -t opencode-harness .
```

## Run

```bash
export BRAVE_API_KEY=your-brave-search-api-key

docker run -it \
  --name opencode-harness \
  -e BRAVE_API_KEY \
  -p 127.0.0.1:4096:4096 \
  -p 127.0.0.1:48801:48801 \
  -v "<host-project-workspace>:/workspace" \
  opencode-harness
```

Replace `<host-project-workspace>` with the writable host path of the project you want OpenCode to operate on.

Obtain a Brave Search API key first, then export `BRAVE_API_KEY` in the shell that launches `docker run`. If `BRAVE_API_KEY` is unset, the container still starts and the rendered config keeps `brave-search` disabled.

If you `docker stop opencode-harness` and later `docker start -ai opencode-harness`, the same container keeps its auth state, so you do not need to log in again.

## Optional auth-state backup

If you want auth to survive deleting and recreating the container, create a local backup directory first:

```bash
mkdir -p .opencode-state
```

Then add this extra mount to the `docker run` command:

```bash
-v "./.opencode-state:/root/.local/share/opencode"
```

The local `./.opencode-state/` directory is gitignored and dockerignored so auth state cannot be committed into the repo or sent in the image build context.

## OAuth login

Start login from the running container shell:

`docker exec -it opencode-harness opencode auth login`

Then:

1. choose `oca`
2. open the generated URL in a browser on the same host
3. complete the OAuth flow
4. let the browser redirect to `http://127.0.0.1:48801/auth/oca`

If you delete the container, you must run `docker exec -it opencode-harness opencode auth login` again unless you reuse the optional `./.opencode-state` backup mount.

## Connect

TUI:

```bash
opencode attach http://127.0.0.1:4096
```

Web UI:

`http://127.0.0.1:4096`

## Verify

```bash
curl http://127.0.0.1:4096/global/health
docker exec -it opencode-harness opencode debug config
docker exec -it opencode-harness opencode mcp list
docker exec -it opencode-harness opencode models oca
docker exec -it opencode-harness opencode -m oca/gpt-5.4 run "what skills do you have? what mcp do you have"
```

## Reproducibility

The image does not fetch `opencode-oca-auth` or `superpowers` at container startup. Pinned upstream source snapshots are kept under `vendor/`, patched during image build, and then baked into the final image.
