# syntax=docker/dockerfile:1

ARG PYTHON_VERSION=3
FROM python:${PYTHON_VERSION}-slim-bookworm AS python-source
RUN dpkg-query -W -f='${Package}\n' > /tmp/python-packages.txt

FROM node:22-slim

ENV OPENCODE_CONFIG=/opt/opencode/opencode.json \
    OPENCODE_PERMISSION_JSON= \
    OPENCODE_CONFIG_DIR=/opt/opencode \
    OPENCODE_SERVER_PORT=4096 \
    OPENCODE_SERVER_HOST=0.0.0.0 \
    OCA_OAUTH_BIND_HOST=0.0.0.0 \
    OCA_OAUTH_CALLBACK_PORT=48801 \
    WORKSPACE_DIR=/workspace \
    # Suppress browser-open attempts in headless container
    BROWSER=/bin/true

COPY --from=python-source /usr/local/bin/ /usr/local/bin/
COPY --from=python-source /usr/local/lib/ /usr/local/lib/
RUN --mount=type=bind,from=python-source,source=/tmp/python-packages.txt,target=/tmp/python-packages.txt \
    apt-get update \
  && xargs apt-get install -y --no-install-recommends < /tmp/python-packages.txt \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/* \
  && ldconfig \
  && node --version \
  && npm --version \
  && node -e "require('fs'); require('net'); require('child_process'); console.log('node-core-ok')" \
  && python3 --version \
  && python3 -c "import ssl, sqlite3, ctypes, venv; print('python-stdlib-ok')" \
  && pip3 --version

RUN --mount=type=cache,target=/root/.npm \
    mkdir -p /opt/opencode \
  && npm install -g opencode-ai@1.2.27 @modelcontextprotocol/server-brave-search@0.6.2 \
  && npm ls -g @modelcontextprotocol/server-brave-search --json --depth=0 > /opt/opencode/mcp-versions.json \
  && rm -rf /usr/local/lib/node_modules/opencode-ai/node_modules/opencode-linux-*-musl /tmp/*

COPY config/opencode.json /opt/opencode/opencode.base.json
COPY --chmod=755 scripts/opencode-harness-entrypoint /usr/local/bin/opencode-harness-entrypoint
COPY --chmod=755 scripts/install-superpowers.sh scripts/check-mcp-discovery.mjs scripts/port-drain-probe.mjs scripts/preflight-node-checks.mjs scripts/render-opencode-config.mjs scripts/validate-sources-lock.mjs scripts/verify-runtime.sh /opt/opencode/scripts/
RUN --mount=type=bind,source=vendor,target=/tmp/vendor \
    ln -sf /usr/local/bin/python3 /usr/local/bin/python \
  && ln -sf /usr/local/bin/pip3 /usr/local/bin/pip \
  && node /opt/opencode/scripts/validate-sources-lock.mjs /tmp/vendor/sources.lock.json /tmp/vendor/opencode-oca-auth /tmp/vendor/superpowers \
  && mkdir -p /opt/opencode/plugins \
  && cp -R /tmp/vendor/opencode-oca-auth /opt/opencode/plugins/opencode-oca-auth \
  && /opt/opencode/scripts/install-superpowers.sh /tmp/vendor/superpowers /opt/opencode \
  && rm -rf /opt/opencode/plugins/opencode-oca-auth/test \
            /opt/opencode/plugins/opencode-oca-auth/docs \
            /opt/opencode/plugins/opencode-oca-auth/CLAUDE.md \
            /opt/opencode/plugins/opencode-oca-auth/bun.lock \
            /opt/opencode/plugins/opencode-oca-auth/tsconfig.json \
            /opt/opencode/plugins/superpowers/tests \
            /opt/opencode/plugins/superpowers/.github \
            /opt/opencode/plugins/superpowers/docs \
            /opt/opencode/plugins/superpowers/agents \
            /opt/opencode/plugins/superpowers/commands \
            /opt/opencode/plugins/superpowers/hooks \
            /opt/opencode/plugins/superpowers/RELEASE-NOTES.md \
            /opt/opencode/plugins/superpowers/CHANGELOG.md \
            /opt/opencode/plugins/superpowers/GEMINI.md \
            /opt/opencode/plugins/superpowers/gemini-extension.json

WORKDIR /workspace

EXPOSE 4096 48801

ENTRYPOINT ["/usr/local/bin/opencode-harness-entrypoint"]
