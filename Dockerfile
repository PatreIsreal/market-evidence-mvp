FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /home/app --create-home app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
    && mkdir -p /app/.wrangler/state /app/.sites-runtime/wrangler \
    && chown -R app:app /app/.wrangler /app/.sites-runtime /app/dist/server

COPY docker-entrypoint.sh /usr/local/bin/market-evidence-entrypoint
RUN chmod 755 /usr/local/bin/market-evidence-entrypoint

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/market-evidence-entrypoint"]
CMD ["npm", "run", "start:selfhost"]
