# ---- OXIVOLT Bulk Editor — Railway Dockerfile ----
FROM node:20-slim AS builder
WORKDIR /app

# System deps required by Prisma (OpenSSL) and native modules
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Enable Corepack so the Yarn version pinned in package.json is used
RUN corepack enable

# Install dependencies (cached layer)
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable || yarn install

# Copy the rest of the source
COPY . .

# Generate Prisma client and build the app
RUN yarn prisma generate
RUN yarn build

# ---- Runtime image ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# Copy everything from the builder (node_modules, .next, prisma client, etc.)
COPY --from=builder /app ./

EXPOSE 3000
ENV PORT=3000

# Push the schema to the database (safe, additive) then start the server
CMD ["sh", "-c", "yarn prisma db push --skip-generate && yarn start -p ${PORT:-3000}"]
