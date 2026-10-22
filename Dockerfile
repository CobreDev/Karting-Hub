FROM node:22-alpine
LABEL org.opencontainers.image.source="https://github.com/CobreDev/Karting-Hub" \
      org.opencontainers.image.description="Karting lap-time dashboard built from Race Monitor exports"
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY package.json server.js ./
COPY public ./public
RUN mkdir -p /data && chown 99:100 /data
# 99:100 = nobody:users, Unraid's default owner for appdata
USER 99:100
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "server.js"]
