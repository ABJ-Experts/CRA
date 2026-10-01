FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY apps/agent/package.json apps/agent/package.json
RUN pnpm install --frozen-lockfile
COPY packages/contracts packages/contracts
COPY packages/typescript-config packages/typescript-config
COPY packages/eslint-config packages/eslint-config
COPY apps/agent apps/agent
RUN pnpm --filter @repo/contracts build && pnpm --filter agent build && pnpm --filter agent deploy --prod --legacy /out

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 65532 cra-agent && useradd -u 65532 -g 65532 -M -s /usr/sbin/nologin cra-agent \
    && mkdir -p /var/lib/cra-agent /etc/cra-agent && chown 65532:65532 /var/lib/cra-agent
WORKDIR /opt/cra-agent
COPY --from=build --chown=65532:65532 /out ./
USER 65532:65532
VOLUME ["/var/lib/cra-agent"]
ENTRYPOINT ["node", "dist/main.js"]
CMD ["serve", "--config", "/etc/cra-agent/config.json"]
