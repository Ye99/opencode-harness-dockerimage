# OpenCode Harness Server

Build a single Docker image that packages OpenCode for both coding and code review workflows.

## What it provides

- `opencode web` running headlessly on `0.0.0.0:4096`
- OCA OAuth callback binding on `0.0.0.0:48801`
- baked `opencode-oca-auth` and `superpowers` assets from pinned upstream revisions
- a mounted target project workspace at `/workspace`
- one shared image tag: `dc-opencode-harness`

## Build

```bash
docker build -f Dockerfile -t dc-opencode-harness .
```

## Run

```bash
docker run --rm -it \
  -p 127.0.0.1:4096:4096 \
  -p 127.0.0.1:48801:48801 \
  -v "<host-project-workspace>:/workspace" \
  dc-opencode-harness
```

Replace `<host-project-workspace>` with the writable host path of the project you want OpenCode to operate on.

## OAuth login

Start login from the running container shell:

`docker exec -it <container-name> opencode auth login`

Then:

1. choose `oca`
2. open the generated URL in a browser on the same host
3. complete the OAuth flow
4. let the browser redirect to `http://127.0.0.1:48801/auth/oca`

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
docker exec -it <container-name> opencode debug config
docker exec -it <container-name> opencode models oca
docker exec -it <container-name> opencode -m oca/gpt-5.4 run "Reply with: ok"
```

## Reproducibility

The image does not fetch `opencode-oca-auth` or `superpowers` at container startup. Pinned upstream source snapshots are kept under `vendor/`, patched during image build, and then baked into the final image.
