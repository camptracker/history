FROM node:20-slim

WORKDIR /app

# Install server deps
COPY server/package*.json server/
RUN cd server && npm ci --production

# Install client deps and build
COPY client/package*.json client/
RUN cd client && npm ci
COPY client/ client/
RUN cd client && npm run build

# Copy server source
COPY server/ server/

EXPOSE 3001

CMD ["node", "server/index.js"]
