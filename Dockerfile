ARG PYTHON_VERSION=latest-stable

FROM node:22-slim AS python-version-resolver

ARG PYTHON_VERSION

WORKDIR /opt/opencode

COPY scripts/resolve-python-version.mjs /opt/opencode/scripts/resolve-python-version.mjs

RUN mkdir -p /opt/opencode/scripts \
  && node /opt/opencode/scripts/resolve-python-version.mjs "$PYTHON_VERSION" > /opt/opencode/python-version.txt

FROM node:22-slim AS python-builder

WORKDIR /tmp/python-build

COPY scripts/install-python-runtime.sh /opt/opencode/scripts/install-python-runtime.sh
COPY --from=python-version-resolver /opt/opencode/python-version.txt /opt/opencode/python-version.txt

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash build-essential ca-certificates curl libbz2-dev libffi-dev libgdbm-dev liblzma-dev libncursesw5-dev libreadline-dev libsqlite3-dev libssl-dev uuid-dev xz-utils zlib1g-dev \
  && chmod +x /opt/opencode/scripts/install-python-runtime.sh \
  && /opt/opencode/scripts/install-python-runtime.sh "$(cat /opt/opencode/python-version.txt)" \
  && rm -rf /var/lib/apt/lists/*

FROM node:22-slim

ENV OPENCODE_CONFIG=/opt/opencode/opencode.json \
    OPENCODE_CONFIG_DIR=/opt/opencode \
    OPENCODE_SERVER_PORT=4096 \
    OPENCODE_SERVER_HOST=0.0.0.0 \
    OCA_OAUTH_BIND_HOST=0.0.0.0 \
    OCA_OAUTH_CALLBACK_PORT=48801 \
    SUPERPOWERS_SKILLS_DIR=/opt/opencode/skills \
    WORKSPACE_DIR=/workspace \
    BROWSER=/bin/true

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git libbz2-1.0 libffi8 libgdbm6 liblzma5 libncursesw6 libreadline8 libsqlite3-0 libssl3 libuuid1 zlib1g \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /opt/opencode \
  && npm install -g opencode-ai@1.2.27 @modelcontextprotocol/server-brave-search@latest \
  && npm ls -g @modelcontextprotocol/server-brave-search --json --depth=0 > /opt/opencode/mcp-versions.json

WORKDIR /opt/opencode

COPY --from=python-builder /opt/python /opt/python
COPY --from=python-version-resolver /opt/opencode/python-version.txt /opt/opencode/python-version.txt
COPY config/opencode.json /opt/opencode/opencode.base.json
COPY scripts/opencode-harness-entrypoint /usr/local/bin/opencode-harness-entrypoint
COPY scripts/install-superpowers.sh /opt/opencode/scripts/install-superpowers.sh
COPY scripts/patch-upstream-sources.mjs /opt/opencode/scripts/patch-upstream-sources.mjs
COPY scripts/check-mcp-discovery.mjs /opt/opencode/scripts/check-mcp-discovery.mjs
COPY scripts/render-opencode-config.mjs /opt/opencode/scripts/render-opencode-config.mjs
COPY scripts/validate-sources-lock.mjs /opt/opencode/scripts/validate-sources-lock.mjs
COPY scripts/verify-runtime.sh /opt/opencode/scripts/verify-runtime.sh
COPY vendor/sources.lock.json /opt/opencode/vendor/sources.lock.json
COPY vendor/opencode-oca-auth /opt/opencode/vendor/opencode-oca-auth
COPY vendor/superpowers /opt/opencode/vendor/superpowers

RUN chmod +x /usr/local/bin/opencode-harness-entrypoint /opt/opencode/scripts/install-superpowers.sh /opt/opencode/scripts/verify-runtime.sh \
  && ln -sf /opt/python/bin/python3 /usr/local/bin/python3 \
  && ln -sf /opt/python/bin/python3 /usr/local/bin/python \
  && ln -sf /opt/python/bin/pip3 /usr/local/bin/pip3 \
  && ln -sf /opt/python/bin/pip3 /usr/local/bin/pip \
  && node /opt/opencode/scripts/validate-sources-lock.mjs /opt/opencode/vendor/sources.lock.json /opt/opencode/vendor/opencode-oca-auth /opt/opencode/vendor/superpowers \
  && node /opt/opencode/scripts/patch-upstream-sources.mjs /opt/opencode/vendor/superpowers /opt/opencode/vendor/opencode-oca-auth \
  && mkdir -p /opt/opencode/plugins \
  && cp -R /opt/opencode/vendor/opencode-oca-auth /opt/opencode/plugins/opencode-oca-auth \
  && /opt/opencode/scripts/install-superpowers.sh /opt/opencode/vendor/superpowers /opt/opencode

WORKDIR /workspace

EXPOSE 4096 48801

ENTRYPOINT ["/usr/local/bin/opencode-harness-entrypoint"]
