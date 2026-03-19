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
  && npm install -g opencode-ai@1.2.27 @modelcontextprotocol/server-brave-search@latest \
  && npm ls -g @modelcontextprotocol/server-brave-search --json --depth=0 > /opt/opencode/mcp-versions.json \
  && rm -rf /usr/local/lib/node_modules/opencode-ai/node_modules/opencode-linux-*-musl /tmp/*

COPY config/opencode.json /opt/opencode/opencode.base.json
COPY --chmod=755 scripts/opencode-harness-entrypoint /usr/local/bin/opencode-harness-entrypoint
COPY --chmod=755 scripts/install-superpowers.sh scripts/check-mcp-discovery.mjs scripts/render-opencode-config.mjs scripts/validate-sources-lock.mjs scripts/verify-runtime.sh /opt/opencode/scripts/
COPY vendor/ /opt/opencode/vendor/

RUN ln -sf /usr/local/bin/python3 /usr/local/bin/python \
  && ln -sf /usr/local/bin/pip3 /usr/local/bin/pip \
  && node /opt/opencode/scripts/validate-sources-lock.mjs /opt/opencode/vendor/sources.lock.json /opt/opencode/vendor/opencode-oca-auth /opt/opencode/vendor/superpowers \
  && mkdir -p /opt/opencode/plugins \
  && cp -R /opt/opencode/vendor/opencode-oca-auth /opt/opencode/plugins/opencode-oca-auth \
  && /opt/opencode/scripts/install-superpowers.sh /opt/opencode/vendor/superpowers /opt/opencode

WORKDIR /workspace

EXPOSE 4096 48801

ENTRYPOINT ["/usr/local/bin/opencode-harness-entrypoint"]
