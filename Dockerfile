FROM node:24.22.0-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npx --yes pnpm@12.5.1 install --frozen-lockfile
COPY . .
RUN npx --yes pnpm@12.5.1 build

FROM node:24.22.0-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 NOVAIL_DATA_FILE=/app/data/state.json
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/app ./app
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "app/server.mjs"]
