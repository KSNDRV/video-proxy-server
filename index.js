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
  
  // yt-dlp возвращает прямую ссылку
  const cmd = `yt-dlp -f "best[ext=mp4]/best" --get-url --no-warnings "${url}"`;

  exec(cmd, (err, stdout) => {
    if (err || !stdout) {
      console.error(err);
      return res.status(500).json({ error: 'Failed' });
    }
    res.json({ videoUrl: stdout.trim() });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
