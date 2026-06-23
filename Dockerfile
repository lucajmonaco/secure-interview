# syntax = docker/dockerfile:1
FROM node:22.21.1-slim AS base
LABEL fly_launch_runtime="Node.js"
WORKDIR /app
ENV NODE_ENV="production"

FROM base AS build
RUN apt-get update -qq && apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3
COPY package.json ./
RUN npm install
COPY server.js ./
# CACHE_BUST=1782248291983
COPY public ./public

FROM base
COPY --from=build /app /app
RUN mkdir -p /app/recordings
EXPOSE 8080
CMD [ "node", "server.js" ]