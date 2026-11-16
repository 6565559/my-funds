FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
ENV HOST=0.0.0.0
ENV PORT=5288
ENV MY_FUNDS_DATA=/data
ENV CONFIG_PATH=/config/config.json
EXPOSE 5288
CMD ["node", "server/index.js"]
