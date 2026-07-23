FROM node:20-slim

# Устанавливаем Python, pip и ffmpeg (критично для yt-dlp)
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg curl && \
    rm -rf /var/lib/apt/lists/*

# Обновляем yt-dlp до последней версии
RUN pip3 install --no-cache-dir --upgrade yt-dlp

WORKDIR /app

# Копируем зависимости и устанавливаем их
COPY package*.json ./
RUN npm install --production

# Копируем код
COPY . .

EXPOSE 3000
CMD ["node", "index.js"]
