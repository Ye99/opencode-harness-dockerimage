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
  && apt-get install -y --no-install-recommends bash ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /opt/opencode \
  && npm install -g opencode-ai@1.2.27 @modelcontextprotocol/server-brave-search@latest \
  && npm ls -g @modelcontextprotocol/server-brave-search --json --depth=0 > /opt/opencode/mcp-versions.json

WORKDIR /opt/opencode

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
  && node /opt/opencode/scripts/validate-sources-lock.mjs /opt/opencode/vendor/sources.lock.json /opt/opencode/vendor/opencode-oca-auth /opt/opencode/vendor/superpowers \
  && node /opt/opencode/scripts/patch-upstream-sources.mjs /opt/opencode/vendor/superpowers /opt/opencode/vendor/opencode-oca-auth \
  && mkdir -p /opt/opencode/plugins \
  && cp -R /opt/opencode/vendor/opencode-oca-auth /opt/opencode/plugins/opencode-oca-auth \
  && /opt/opencode/scripts/install-superpowers.sh /opt/opencode/vendor/superpowers /opt/opencode

WORKDIR /workspace

EXPOSE 4096 48801

ENTRYPOINT ["/usr/local/bin/opencode-harness-entrypoint"]
