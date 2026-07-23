const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

const execFileAsync = util.promisify(execFile);

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.raw({ type: 'application/octet-stream', limit: '20mb' }));

const TMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// Эндпоинт для отдачи файла (нужен для upload-image)
app.get('/file/:filename', (req, res) => {
  const filepath = path.join(TMP_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) return res.status(404).send('File not found or expired');
  
  const ext = path.extname(filepath).toLowerCase();
  const contentType = ['.jpg', '.jpeg'].includes(ext) ? 'image/jpeg' : 
                      ext === '.png' ? 'image/png' : 'video/mp4';
                      
  res.setHeader('Content-Type', contentType);
  fs.createReadStream(filepath).pipe(res);
});

// Загрузка картинок из бота (прямой upload)
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

// Универсальный эндпоинт: получаем ПРЯМУЮ ссылку на файл
app.post('/download', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL' });

  // Фильтр профилей
  const profilePatterns = [
    /tiktok\.com\/@[\w.-]+\/?$/,
    /instagram\.com\/[\w.-]+\/?$/,
    /youtube\.com\/(c|channel|user)\//
  ];
  if (profilePatterns.some(p => p.test(url))) {
    return res.status(400).json({ error: 'Profile links are not supported.' });
  }

  console.log(`Processing: ${url}`);

  try {
    // ШАГ 1: Получаем прямую ссылку через yt-dlp --get-url
    const { stdout, stderr } = await execFileAsync('yt-dlp', [
      '--get-url',
      '--flat-playlist',
      '--no-warnings',
      '--socket-timeout', '15',
      url
    ], { timeout: 30000 });

    // Разбиваем ответ по переносам строк
    const urls = stdout.trim().split('\n').filter(u => u.startsWith('http'));

    if (urls.length === 0) {
      throw new Error('No direct URLs found');
    }

    // Возвращаем все найденные ссылки как media group
    const media = urls.map(u => {
      const isVideo = /\.(mp4|mov|webm|m3u8)$/i.test(u);
      return {
        url: u,
        type: isVideo ? 'video' : 'photo'
      };
    });

    console.log(`[${media.length} URLs] Returning direct links`);
    res.json({ media });

  } catch (error) {
    console.error('[DOWNLOAD ERROR]:', error.message, '\nSTDERR:', error.stderr);
    
    const errorMsg = error.stderr?.includes('Unsupported URL') 
      ? 'Link format not supported. Try a direct video/photo link.'
      : 'Download failed. Platform may block this link.';
    
    res.status(500).json({ 
      error: errorMsg,
      details: error.stderr || error.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
