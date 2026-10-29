# sideline live: one always-on Node server (live polling + push to browsers)
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
# The database and downloaded stats live on a persistent volume mounted at /data
ENV DB_FILE=/data/sideline.db CACHE_DIR=/data/cache PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
