FROM node:24-alpine AS build

WORKDIR /app

# better-sqlite3 compiles from source when no prebuilt binary matches (alpine/arm64)
RUN apk add --no-cache python3 make g++

# Install dependencies (npm cache is reused across builds)
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Copy app source code
COPY . .

RUN npm run build

# Stage 2: Production — Next standalone output only ships the traced runtime deps
FROM node:24-alpine AS production

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Expose the port Next.js runs on
EXPOSE 3300

# Start the Next.js application (standalone server reads PORT/HOSTNAME)
ENV PORT=3300
CMD ["node", "server.js"]
