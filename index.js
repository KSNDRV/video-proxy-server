const express = require('express');
const cors = require('cors');
const ytdlp = require('yt-dlp-exec'); // Используем библиотеку

const app = express();
app.use(express.json());
app.use(cors());

app.post('/download', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL' });

  console.log(`Processing: ${url}`);

  try {
    // yt-dlp-exec сам находит бинарник и запускает его
    const output = await ytdlp(url, {
      dumpSingleJson: true, // Получаем JSON вместо сырой ссылки (надежнее)
      noWarnings: true,
      noCheckCertificates: true,
      preferFreeFormats: true,
      format: 'best[ext=mp4]/best'
    });

    // Ищем прямую ссылку в JSON-ответе
    const videoUrl = output.url || output.requested_formats?.[0]?.url;

    if (videoUrl) {
      console.log('Success:', videoUrl.substring(0, 80) + '...');
      res.json({ videoUrl });
    } else {
      console.error('No URL found in response');
      res.status(500).json({ error: 'No video URL found' });
    }
  } catch (error) {
    console.error('[YT-DLP ERROR]:', error.message);
    res.status(500).json({ error: 'Download failed', details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
