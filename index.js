const express = require('express');
const cors = require('cors');
const ytdlp = require('yt-dlp-exec');
const igDirect = require('instagram-url-direct');
const fs = require('fs');
const path = require('path');

@@ -12,6 +11,7 @@ app.use(cors());
const TMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// Эндпоинт для отдачи файла Telegram'у
app.get('/file/:filename', (req, res) => {
const filepath = path.join(TMP_DIR, req.params.filename);
if (!fs.existsSync(filepath)) return res.status(404).send('File not found or expired');
@@ -27,41 +27,36 @@ app.post('/download', async (req, res) => {
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

    // Генерируем уникальное имя файла
const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`;
const filepath = path.join(TMP_DIR, filename);

    const fileRes = await fetch(directUrl);
    if (!fileRes.ok) throw new Error(`Failed to fetch video: ${fileRes.status}`);
    
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    fs.writeFileSync(filepath, buffer);
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
