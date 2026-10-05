FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY backend/src/database/*.sql ./dist/database/
COPY deployment/create-admin.mjs ./deployment/create-admin.mjs
RUN mkdir -p /data/delivery-photos && chown node:node /data/delivery-photos
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
