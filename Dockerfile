FROM node:24-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.html ./
COPY src ./src
COPY server ./server

ENV NODE_ENV=production
ENV PORT=8080
ENV DATABASE_FILE=/home/data/marknest.db

RUN mkdir -p /home/data
EXPOSE 8080

CMD ["node", "server/index.js"]
