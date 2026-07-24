const express = require('express');
const cors = require('cors');
const ytdlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises'); // Для потоковой передачи без буфера

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' })); // Ограничим размер запроса

const TMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// Эндпоинт для отдачи файла (оптимизирован под стриминг)
app.get('/file/:filename', (req, res) => {
  const filepath = path.join(TMP_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) return res.status(404).send('File not found or expired');
  
  // Отдаем файл потоком, а не загружаем весь в память
  const stream = fs.createReadStream(filepath);
  res.setHeader('Content-Type', 'video/mp4');
  stream.pipe(res);
  
  stream.on('error', () => res.status(500).end());
});

app.post('/download', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  console.log(`Processing: ${url}`);

  try {
    const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`;
    const filepath = path.join(TMP_DIR, filename);

    // Оптимизация yt-dlp:
    // --no-playlist: не искать плейлисты (ускоряет)
    // --socket-timeout: быстрый фейл если сеть тупит
    // -f "best[ext=mp4]/best": приоритет mp4 для совместимости с TG
    await ytdlp(url, {
      output: filepath,
      format: 'best[ext=mp4]/best',
      noWarnings: true,
      noCheckCertificates: true,
      ignoreErrors: false,
      socketTimeout: 10, 
      playlistEnd: 1, // Если вдруг это плейлист, берем только 1 видео
      restrictFilenames: true // Убираем спецсимволы из имен
    });

    if (!fs.existsSync(filepath)) {
      throw new Error('yt-dlp failed to create file');
    }

    const baseUrl = req.protocol + '://' + req.get('host');
    const videoUrl = `${baseUrl}/file/${filename}`;

    // ВАЖНО: Telegram ждет ответ максимум ~60 сек. 
    // Если скачивание заняло 50 сек, у нас есть всего 10 сек на отправку ссылки.
    // Поэтому отвечаем сразу после создания файла.
    res.json({ videoUrl });

    // Автоочистка через 5 минут
    setTimeout(() => {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        console.log(`Cleaned up: ${filename}`);
      }
    }, 5 * 60 * 1000);

  } catch (error) {
    console.error('[SERVER] Download error:', error.message);
    // Если ошибка произошла ДО отправки ответа, сообщаем клиенту
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Download failed' });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Video proxy server running on port ${PORT}`);
});
