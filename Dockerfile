# syntax=docker/dockerfile:1.20
FROM node:lts-trixie-slim AS base
ARG USER_UID=1000
ARG USER_GID=1000
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates gosu curl gh git wget ripgrep python3 \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

# Modify the existing node user/group to have the specified UID/GID to match host user
RUN usermod -u $USER_UID --non-unique node \
  && groupmod -g $USER_GID --non-unique node \
  && usermod -g $USER_GID -d /paperclip node

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY cli/package.json cli/
COPY server/package.json server/
COPY ui/package.json ui/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/adapter-utils/package.json packages/adapter-utils/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/skills-catalog/package.json packages/skills-catalog/
COPY packages/teams-catalog/package.json packages/teams-catalog/
COPY packages/adapters/acpx-local/package.json packages/adapters/acpx-local/
COPY packages/adapters/claude-local/package.json packages/adapters/claude-local/
COPY packages/adapters/codex-local/package.json packages/adapters/codex-local/
COPY packages/adapters/cursor-cloud/package.json packages/adapters/cursor-cloud/
COPY packages/adapters/cursor-local/package.json packages/adapters/cursor-local/
COPY packages/adapters/gemini-local/package.json packages/adapters/gemini-local/
COPY packages/adapters/grok-local/package.json packages/adapters/grok-local/
COPY packages/adapters/hermes/package.json packages/adapters/hermes/
COPY packages/adapters/hermes-gateway/package.json packages/adapters/hermes-gateway/
COPY packages/adapters/openclaw-gateway/package.json packages/adapters/openclaw-gateway/
COPY packages/adapters/opencode-local/package.json packages/adapters/opencode-local/
COPY packages/adapters/pi-local/package.json packages/adapters/pi-local/
COPY packages/plugins/sdk/package.json packages/plugins/sdk/
COPY --parents packages/plugins/sandbox-providers/./*/package.json packages/plugins/sandbox-providers/
COPY packages/plugins/paperclip-plugin-fake-sandbox/package.json packages/plugins/paperclip-plugin-fake-sandbox/
COPY packages/plugins/plugin-llm-wiki/package.json packages/plugins/plugin-llm-wiki/
COPY packages/plugins/plugin-workspace-diff/package.json packages/plugins/plugin-workspace-diff/
COPY patches/ patches/
COPY scripts/link-plugin-dev-sdk.mjs scripts/

RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app /app
COPY . .
RUN pnpm --filter @paperclipai/ui build
RUN pnpm --filter @paperclipai/plugin-sdk build
RUN pnpm --filter @paperclipai/server build
RUN test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)

FROM base AS production
ARG USER_UID=1000
ARG USER_GID=1000
WORKDIR /app
COPY --chown=node:node --from=build /app /app
RUN npm install --global --omit=dev @anthropic-ai/claude-code@latest @openai/codex@latest opencode-ai @google/gemini-cli@latest \
  && real_gemini="$(command -v gemini)" \
  && mv "$real_gemini" /usr/local/bin/gemini-real

RUN <<'EOF'
cat > /usr/local/bin/gemini <<'PY'
#!/usr/bin/env python3
import os
import sys

valid_approval_modes = {"default", "auto_edit", "plan", "yolo"}
approval_mode = "default"
rewritten = []
args = sys.argv[1:]
i = 0

os.environ["GEMINI_SANDBOX"] = "false"
os.environ["GEMINI_CLI_TRUST_WORKSPACE"] = "true"

# Gemini CLI exits when both key names are present. Prefer GEMINI_API_KEY for this adapter.
if os.environ.get("GEMINI_API_KEY"):
    os.environ.pop("GOOGLE_API_KEY", None)
elif os.environ.get("GOOGLE_API_KEY"):
    os.environ["GEMINI_API_KEY"] = os.environ["GOOGLE_API_KEY"]
    os.environ.pop("GOOGLE_API_KEY", None)

while i < len(args):
    arg = args[i]

    if arg == "--approval-mode":
        value = args[i + 1] if i + 1 < len(args) else ""
        if value in valid_approval_modes and value != "yolo":
            approval_mode = value
        else:
            approval_mode = "default"
        i += 2
        continue

    if arg.startswith("--approval-mode="):
        value = arg.split("=", 1)[1]
        if value in valid_approval_modes and value != "yolo":
            approval_mode = value
        else:
            approval_mode = "default"
        i += 1
        continue

    if arg == "--sandbox":
        i += 1
        continue

    if arg.startswith("--sandbox"):
        i += 1
        continue

    if arg == "--skip-trust":
        i += 1
        continue

    rewritten.append(arg)
    i += 1

final_args = ["--approval-mode", approval_mode, "--sandbox=none", "--skip-trust", *rewritten]
os.execv("/usr/local/bin/gemini-real", ["/usr/local/bin/gemini-real", *final_args])
PY
chmod +x /usr/local/bin/gemini
EOF

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client jq curl \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /paperclip \
  && chown node:node /paperclip

COPY scripts/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production \
  HOME=/paperclip \
  HOST=0.0.0.0 \
  PORT=7860 \
  SERVE_UI=true \
  PAPERCLIP_HOME=/paperclip \
  PAPERCLIP_INSTANCE_ID=default \
  USER_UID=${USER_UID} \
  USER_GID=${USER_GID} \
  PAPERCLIP_CONFIG=/paperclip/instances/default/config.json \
  PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  PAPERCLIP_DEPLOYMENT_EXPOSURE=private \
  OPENCODE_ALLOW_ALL_MODELS=true \
  GEMINI_SANDBOX=false \
  GEMINI_CLI_TRUST_WORKSPACE=true

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -fsS http://127.0.0.1:7860/api/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["sh", "-c", "PORT=7860 exec node --import ./server/node_modules/tsx/dist/loader.mjs server/dist/index.js"]
