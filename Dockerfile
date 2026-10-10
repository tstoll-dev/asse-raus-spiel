FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js game.js ./
COPY public ./public
ENV PORT=3000 DATA_FILE=/data/rooms.json
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server.js"]
