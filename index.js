const express = require('express');
const cors = require('cors');
const ytdlp = require('yt-dlp-exec');
const igDirect = require('instagram-url-direct');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

const TMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

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
    let directUrl = null;

    if (url.includes('instagram.com')) {
      console.log('[SERVER] Using instagram-url-direct...');
      const result = await igDirect(url);
      directUrl = result.video_url || result.display_url || result.thumbnail_src;
    } else {
      console.log('[SERVER] Using yt-dlp...');
      const output = await ytdlp(url, {
        dumpSingleJson: true,
        noWarnings: true,
        format: 'best[ext=mp4]/best'
      });
      directUrl = output.url || output.requested_formats?.[0]?.url;
    }

    if (!directUrl) throw new Error('No direct URL found');

    const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`;
    const filepath = path.join(TMP_DIR, filename);

    const fileRes = await fetch(directUrl);
    if (!fileRes.ok) throw new Error(`Failed to fetch video: ${fileRes.status}`);
    
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    fs.writeFileSync(filepath, buffer);

    const baseUrl = req.protocol + '://' + req.get('host');
    const videoUrl = `${baseUrl}/file/${filename}`;
    
    console.log(`Returning self-hosted URL: ${videoUrl}`);
    res.json({ videoUrl });

    setTimeout(() => {
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    }, 5 * 60 * 1000);

  } catch (error) {
    console.error('[SERVER ERROR]:', error.message);
    res.status(500).json({ error: 'Download failed', details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
