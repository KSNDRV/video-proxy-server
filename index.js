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

// Эндпоинт для отдачи скачанного файла
app.get('/file/:filename', (req, res) => {
  const filepath = path.join(TMP_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) {
    return res.status(404).send('File not found');
  }
  res.setHeader('Content-Type', 'video/mp4');
  fs.createReadStream(filepath).pipe(res);
});

app.post('/download', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL' });

  console.log(`Processing: ${url}`);

  try {
    const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`;
    const filepath = path.join(TMP_DIR, filename);

    await ytdlp(url, {
      output: filepath,
      format: 'best[ext=mp4]/best',
      noWarnings: true
    });

    if (!fs.existsSync(filepath)) throw new Error('File not created');

    // Возвращаем ссылку НА НАШ ЖЕ СЕРВЕР, откуда Telegram точно скачает
    const baseUrl = req.protocol + '://' + req.get('host');
    const videoUrl = `${baseUrl}/file/${filename}`;

    console.log(`Returning self-hosted URL: ${videoUrl}`);
    res.json({ videoUrl });

    // Удаляем файл через 10 минут
    setTimeout(() => {
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    }, 10 * 60 * 1000);

  } catch (error) {
    console.error('[YT-DLP ERROR]:', error.message);
    res.status(500).json({ error: 'Failed', details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
