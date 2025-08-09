# Multi-stage build handled in server/Dockerfile (copied to root for simplicity)
FROM node:20-alpine AS clientbuild
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client ./
RUN npm run build

FROM node:20-alpine AS serverbuild
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server ./

FROM node:20-alpine
WORKDIR /app
COPY --from=serverbuild /app/server ./server
COPY --from=clientbuild /app/client/dist ./client/dist
WORKDIR /app/server
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm","start"]
