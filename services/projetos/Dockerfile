FROM node:18-alpine AS build
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:18-alpine
WORKDIR /usr/src/app
ENV NODE_ENV=production
ENV SERVICE_NAME=cinebridge-projetos
ENV PORT=3002
COPY --from=build --chown=node:node /usr/src/app/package*.json ./
COPY --from=build --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=build --chown=node:node /usr/src/app/dist ./dist
COPY --chown=node:node examples ./examples
COPY --chown=node:node scripts/smoke-atv4.js ./scripts/smoke-atv4.js
USER node
EXPOSE 3002
CMD ["npm", "run", "start:distributed"]
