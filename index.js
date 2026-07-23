const express = require('express');
const cors = require('cors');
const ytdlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Для загрузки бинарных данных (картинок) нужен raw middleware
app.use(express.raw({ type: 'application/octet-stream', limit: '20mb' }));

const TMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// Эндпоинт для отдачи файла Telegram'у
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

// Универсальный эндпоинт скачивания (видео, фото, карусели)
app.post('/download', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL' });

  // 🔒 Фильтр профилей
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
    const filenameBase = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    // Скачиваем сразу на диск с плейсхолдером расширения
    await ytdlp(url, {
      output: path.join(TMP_DIR, `${filenameBase}.%(ext)s`),
      format: 'best',
      noWarnings: true,
      ignoreErrors: false,
      restrictFilenames: true,
      socketTimeout: 30,
      fragmentRetries: 3,
      retries: 2
    });

    // Ищем все файлы с этим префиксом
    const files = fs.readdirSync(TMP_DIR)
      .filter(f => f.startsWith(filenameBase))
      .sort();

    if (files.length === 0) {
      throw new Error('yt-dlp returned no files');
    }

    const baseUrl = req.protocol + '://' + req.get('host');
    const media = files.map(file => {
      const ext = path.extname(file).toLowerCase();
      const isVideo = ['.mp4', '.mov', '.webm', '.mkv'].includes(ext);
      return {
        url: `${baseUrl}/file/${file}`,
        type: isVideo ? 'video' : 'photo'
      };
    });

    console.log(`[${media.length} files] Type: ${media[0].type}`);
    res.json({ media });

    // Автоудаление через 5 минут
    setTimeout(() => {
      for (const file of files) {
        const filepath = path.join(TMP_DIR, file);
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      }
      console.log(`Cleaned up ${files.length} files`);
    }, 5 * 60 * 1000);

  } catch (error) {
    console.error('[DOWNLOAD ERROR]:', error.message);
    
    const isTikTokPhoto = /tiktok\.com.*\/photo\//.test(url);
    const errorMsg = isTikTokPhoto 
      ? 'TikTok photo posts are slow to process. Try a direct video link.'
      : 'Download failed. Link may be private or unsupported.';

    res.status(500).json({ error: errorMsg, details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
