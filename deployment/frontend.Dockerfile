FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# Keep the existing map configuration; only the deployed API origin changes.
RUN node --input-type=module -e "import fs from 'node:fs'; const p='src/environments/environment.ts'; const s=fs.readFileSync(p,'utf8').replace('production: false','production: true').replace('http://localhost:3000/api/v1','/api/v1'); fs.writeFileSync(p,s);"
RUN npm run build

FROM nginx:stable-alpine
COPY deployment/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
