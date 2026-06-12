FROM node:20-slim

# ffmpeg + curl + deno dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp install
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Deno install (JS runtime for yt-dlp)
RUN curl -fsSL https://deno.land/install.sh | sh
ENV DENO_INSTALL="/root/.deno"
ENV PATH="$DENO_INSTALL/bin:$PATH"

# Working directory
WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .
RUN mkdir -p /tmp/downloads

EXPOSE 8000

CMD ["node", "server.js"]
