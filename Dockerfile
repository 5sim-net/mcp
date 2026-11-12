FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json README.md LICENSE ./
USER node
EXPOSE 3000
# stdio by default; set MCP_TRANSPORT=http for Streamable HTTP on :3000/mcp
ENTRYPOINT ["node", "dist/stdio.js"]
