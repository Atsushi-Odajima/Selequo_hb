# Selequo production image (Node 22). Build: docker build -t selequo .
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
# Japanese fonts for server-side PDF export of Decision Briefs (IPA fonts: IPA Font License)
RUN apt-get update && apt-get install -y --no-install-recommends fonts-ipafont-gothic ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# PDF export needs Chromium: `npx playwright-core install chromium` at build time or set PDF_RENDERER=none
USER node
EXPOSE 8787
CMD ["node", "dist/server/server/main.js"]
