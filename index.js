const express = require('express');
const cors = require('cors');
const ytdlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

const TMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// Эндпоинт для отдачи файла Telegram'у
app.get('/file/:filename', (req, res) => {
  const filepath = path.join(TMP_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) return res.status(404).send('File not found or expired');
  
  res.setHeader('Content-Type', 'video/mp4');
  fs.createReadStream(filepath).pipe(res);
});

app.post('/download', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL' });

  console.log(`Processing: ${url}`);

  try {
    // Генерируем уникальное имя файла
    const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`;
    const filepath = path.join(TMP_DIR, filename);

    // yt-dlp САМ скачивает файл, используя правильные заголовки и обходя 403
    await ytdlp(url, {
      output: filepath,
      format: 'best[ext=mp4]/best',
      noWarnings: true,
      noCheckCertificates: true,
      // Для Instagram иногда помогает игнорирование ошибок загрузки метаданных
      ignoreErrors: true 
    });

    // Проверяем, что файл действительно создался
    if (!fs.existsSync(filepath)) {
      throw new Error('yt-dlp failed to create file');
    }

    // Возвращаем ссылку НА НАШ СЕРВЕР
    const baseUrl = req.protocol + '://' + req.get('host');
    const videoUrl = `${baseUrl}/file/${filename}`;
    
    console.log(`Returning self-hosted URL: ${videoUrl}`);
    res.json({ videoUrl });

    // Удаляем файл через 5 минут
    setTimeout(() => {
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      console.log(`Cleaned up: ${filename}`);
    }, 5 * 60 * 1000);

  } catch (error) {
    console.error('[SERVER ERROR]:', error.message);
    res.status(500).json({ error: 'Download failed', details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
