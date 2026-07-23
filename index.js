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

// Эндпоинт для отдачи файла
app.get('/file/:filename', (req, res) => {
  const filepath = path.join(TMP_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) return res.status(404).send('File not found or expired');
  
  const ext = path.extname(filepath).toLowerCase();
  const contentType = ['.jpg', '.jpeg'].includes(ext) ? 'image/jpeg' : 
                      ext === '.png' ? 'image/png' : 'video/mp4';
                      
  res.setHeader('Content-Type', contentType);
  fs.createReadStream(filepath).pipe(res);
});

app.post('/download', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL' });

  // 🔒 ФИЛЬТР ПРОФИЛЕЙ: блокируем ссылки без конкретного контента
  const profilePatterns = [
    /tiktok\.com\/@[\w.-]+\/?$/,
    /instagram\.com\/[\w.-]+\/?$/,
    /youtube\.com\/(c|channel|user)\//
  ];
  if (profilePatterns.some(p => p.test(url))) {
    return res.status(400).json({ error: 'Profile links are not supported. Send a direct link to video/image/story.' });
  }

  console.log(`Processing: ${url}`);

  try {
    // 1. Получаем метаданные БЕЗ скачивания
    const info = await ytdlp(url, {
      dumpSingleJson: true,
      noWarnings: true,
      ignoreErrors: true
    });

    if (!info) throw new Error('Failed to extract media info');

    // 2. Определяем тип и собираем список файлов для скачивания
    const filesToDownload = [];
    
    // Обработка каруселей (TikTok/Insta)
    if (info.entries && Array.isArray(info.entries)) {
      for (const entry of info.entries) {
        const isVideo = entry.ext === 'mp4' || entry.format_id?.includes('video');
        const ext = isVideo ? 'mp4' : (entry.ext || 'jpg');
        const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}-${filesToDownload.length}.${ext}`;
        filesToDownload.push({ url: entry.url || url, filepath: path.join(TMP_DIR, filename), isVideo, filename });
      }
    } 
    // Одиночный контент
    else {
      const isVideo = info.ext === 'mp4' || info.format_id?.includes('video');
      const ext = isVideo ? 'mp4' : (info.ext || 'jpg');
      const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
      filesToDownload.push({ url, filepath: path.join(TMP_DIR, filename), isVideo, filename });
    }

    if (filesToDownload.length === 0) throw new Error('No media found');

    // 3. Скачиваем все файлы
    for (const file of filesToDownload) {
      await ytdlp(file.url, {
        output: file.filepath,
        format: file.isVideo ? 'best[ext=mp4]' : 'bestimage',
        noWarnings: true,
        ignoreErrors: true
      });
      
      if (!fs.existsSync(file.filepath)) {
        console.warn(`Failed to download: ${file.filename}`);
        // Удаляем неудачный файл из списка
        const idx = filesToDownload.indexOf(file);
        if (idx > -1) filesToDownload.splice(idx, 1);
      }
    }

    if (filesToDownload.length === 0) throw new Error('All downloads failed');

    // 4. Формируем ответ
    const baseUrl = req.protocol + '://' + req.get('host');
    const result = {
      author: info.uploader || info.channel || undefined,
      media: filesToDownload.map(f => ({
        url: `${baseUrl}/file/${f.filename}`,
        type: f.isVideo ? 'video' : 'photo'
      }))
    };

    console.log(`[${filesToDownload.length} files] Returning media group`);
    res.json(result);

    // 5. Автоудаление через 5 минут
    setTimeout(() => {
      for (const f of filesToDownload) {
        if (fs.existsSync(f.filepath)) fs.unlinkSync(f.filepath);
      }
      console.log(`Cleaned up ${filesToDownload.length} files`);
    }, 5 * 60 * 1000);

  } catch (error) {
    console.error('[DOWNLOAD ERROR]:', error.message);
    res.status(500).json({ error: 'Download failed', details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
