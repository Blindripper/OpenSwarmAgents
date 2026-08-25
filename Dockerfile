FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN mkdir -p /var/lib/openswarmagents/uploads && chown -R node:node /var/lib/openswarmagents

COPY apps ./apps
COPY data/seed.json ./data/seed.json
COPY db ./db
COPY scripts ./scripts
COPY docs ./docs
COPY README.md LICENSE ./

USER node

EXPOSE 8788

CMD ["npm", "start"]
