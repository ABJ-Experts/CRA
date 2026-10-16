# Supply a reviewed node:22-bookworm-slim@sha256:... reference. No mutable default.
ARG NODE_IMAGE
ARG STATIC_IMAGE
ARG POSTGRES_TOOLS_IMAGE
FROM ${NODE_IMAGE} AS build
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ pkg-config libxml2-dev ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @repo/contracts build && pnpm --filter api build && pnpm --filter agent build
# Release images are independent of installation URLs. Public API traffic stays
# same-origin; private JWKS/issuer resolution reads server runtime configuration.
ENV NEXT_PUBLIC_ENABLE_MOCKS=false API_ORIGIN=http://api:3333
RUN pnpm --filter web build && pnpm --filter operator build

FROM ${NODE_IMAGE} AS api
RUN apt-get update && apt-get install -y --no-install-recommends libxml2 ca-certificates openssl tar docker.io && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY --from=build /repo /repo
ENV NODE_ENV=production
USER node
CMD ["node", "apps/api/dist/main.js"]

FROM api AS web
ENV NEXT_PUBLIC_ENABLE_MOCKS=false API_ORIGIN=http://api:3333
CMD ["node", "apps/web/node_modules/next/dist/bin/next", "start", "apps/web", "--hostname", "0.0.0.0", "--port", "3000"]

FROM api AS agent
USER root
RUN mkdir -p /var/lib/cra-agent && chown node:node /var/lib/cra-agent
USER node
CMD ["node", "apps/agent/dist/main.js", "serve", "--config", "/etc/cra-agent/config.json"]

FROM api AS edge
CMD ["node", "deployment/edge.mjs"]

# Static operator export has no runtime Node/config secrets.
FROM ${STATIC_IMAGE} AS operator
COPY --from=build /repo/apps/operator/out /usr/share/nginx/html
COPY deployment/operator-nginx.conf /etc/nginx/conf.d/default.conf

# Match the fixed Supabase PostgreSQL 17 runtime with a reviewed immutable tools
# image. Its complete Nix closure preserves ELF loaders and shared libraries.
FROM ${POSTGRES_TOOLS_IMAGE} AS postgres-tools

# Independent privileged control image; never use as the normal API/web image.
# A Linux Supabase CLI binary is provisioned on the builder from verified local
# release tooling. No network download or unpinned CLI substitution is permitted.
FROM api AS control
USER root
RUN apt-get update && apt-get install -y --no-install-recommends util-linux && rm -rf /var/lib/apt/lists/*
COPY --from=postgres-tools /nix /nix
ARG POSTGRES_TOOLS_IMAGE
RUN printf '%s' "$POSTGRES_TOOLS_IMAGE" | grep -Eq '@sha256:[a-f0-9]{64}$' \
    && ln -s /nix/var/nix/profiles/default/bin/psql /usr/bin/psql \
    && ln -s /nix/var/nix/profiles/default/bin/pg_dump /usr/bin/pg_dump \
    && /usr/bin/psql --version | grep -Eq '^psql \(PostgreSQL\) 17\.' \
    && /usr/bin/pg_dump --version | grep -Eq '^pg_dump \(PostgreSQL\) 17\.' 
COPY deployment/control-tools/supabase /usr/local/bin/supabase
ARG SUPABASE_BINARY_SHA256
RUN test "${#SUPABASE_BINARY_SHA256}" = 64 && echo "$SUPABASE_BINARY_SHA256  /usr/local/bin/supabase" | sha256sum --check --strict && chmod 0555 /usr/local/bin/supabase \
    && /usr/bin/flock --version && /usr/bin/docker --version && /usr/local/bin/supabase --version
CMD ["node", "apps/api/dist/upgrade-supervisor.js"]
