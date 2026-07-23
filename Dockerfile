FROM node:20-slim

RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg curl && \
    rm -rf /var/lib/apt/lists/* && \
    pip3 install --no-cache-dir --upgrade yt-dlp --break-system-packages

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

EXPOSE 3000
CMD ["node", "index.js"]
