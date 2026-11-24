# Build context is the repository root.
FROM node:22-slim
WORKDIR /app
RUN npm install -g pnpm@9.12.0
COPY . .
RUN pnpm install --frozen-lockfile && pnpm widget:build
ENV NODE_ENV=production
WORKDIR /app/apps/api
CMD ["node", "--import", "tsx", "src/server.ts"]
