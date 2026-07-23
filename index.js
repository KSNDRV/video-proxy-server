const express = require('express');
const cors = require('cors');
const ytdlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.raw({ type: 'application/octet-stream', limit: '20mb' }));

const TMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// Эндпоинт для отдачи файла Telegram'у
app.get('/file/:filename', (req, res) => {
  const filepath = path.join(TMP_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) return res.status(404).send('File not found or expired');
  
  const ext = path.extname(filepath).toLowerCase();
  const contentType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 
                      ext === '.png' ? 'image/png' : 'video/mp4';
                      
  res.setHeader('Content-Type', contentType);
  fs.createReadStream(filepath).pipe(res);
});

app.post('/upload-image', (req, res) => {
  try {
    const buffer = req.body;
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'Empty body' });
    }

    const filename = `img-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
    const filepath = path.join(TMP_DIR, filename);

    fs.writeFileSync(filepath, buffer);
    
    const baseUrl = req.protocol + '://' + req.get('host');
    const imageUrl = `${baseUrl}/file/${filename}`;
    
    console.log(`[UPLOAD] Image saved: ${filename}`);
    res.json({ imageUrl });

    setTimeout(() => {
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      console.log(`[CLEANUP] Deleted image: ${filename}`);
    }, 5 * 60 * 1000);

  } catch (error) {
    console.error('[UPLOAD ERROR]:', error.message);
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
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
      noWarnings: true,
      noCheckCertificates: true,
      ignoreErrors: true 
    });

    if (!fs.existsSync(filepath)) {
      throw new Error('yt-dlp failed to create file');
    }

    const baseUrl = req.protocol + '://' + req.get('host');
    const videoUrl = `${baseUrl}/file/${filename}`;
    
    console.log(`Returning self-hosted URL: ${videoUrl}`);
    res.json({ videoUrl });

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
