const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

app.post('/download', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL' });

  console.log(`Processing: ${url}`);

  // Для Instagram добавляем флаг --no-check-certificates и пробуем разные форматы
  // Для TikTok yt-dlp обычно справляется сам, но добавим таймаут
  let command = '';
  
  if (url.includes('instagram.com')) {
    // Instagram требует обхода некоторых проверок
    command = `yt-dlp -f "best[ext=mp4]/best" --get-url --no-warnings --ignore-errors "${url}"`;
  } else {
    // Стандартный запрос для TikTok и других
    command = `yt-dlp -f "best[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --get-url --no-warnings "${url}"`;
  }

  // Добавляем таймаут 30 секунд, чтобы не вешать сервер
  const options = { timeout: 30000 };

  exec(command, options, (err, stdout, stderr) => {
    if (err || !stdout) {
      console.error('[YT-DLP ERROR]:', err?.message || stderr);
      // Возвращаем конкретную ошибку, а не просто 500
      return res.status(500).json({ 
        error: 'Download failed', 
        details: stderr ? stderr.substring(0, 200) : 'Unknown error' 
      });
    }
    
    const videoUrl = stdout.trim();
    console.log('Success:', videoUrl.substring(0, 80) + '...');
    res.json({ videoUrl });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
