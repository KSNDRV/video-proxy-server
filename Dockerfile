# Используем официальный образ Node.js
FROM node:20-slim

# Устанавливаем системные зависимости для yt-dlp (Python, FFmpeg)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Обновляем yt-dlp до последней версии (критично для TikTok)
RUN pip3 install --no-cache-dir --upgrade yt-dlp

# Создаем рабочую директорию
WORKDIR /app

# Копируем файлы зависимостей и устанавливаем их
COPY package*.json ./
RUN npm install --production

# Копируем весь остальной код
COPY . .

# Открываем порт
EXPOSE 3000

# Запускаем сервер
CMD ["node", "index.js"]
