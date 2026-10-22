FROM node:22-alpine
LABEL org.opencontainers.image.source="https://github.com/CobreDev/Karting-Hub" \
      org.opencontainers.image.description="Karting lap-time dashboard built from Race Monitor exports"
# su-exec drops from root to PUID:PGID after startup hooks (e.g. Unraid's Tailscale integration) have run.
RUN apk add --no-cache su-exec
WORKDIR /app
# PUID/PGID 99:100 = nobody:users, Unraid's default owner for appdata.
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data PUID=99 PGID=100
COPY package.json server.js ./
COPY public ./public
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /data && chown 99:100 /data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
