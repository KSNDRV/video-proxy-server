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

const COBALT_API_URL = process.env.COBALT_API_URL || 'http://localhost:9000';

app.get('/file/:filename', (req, res) => {
  const filepath = path.join(TMP_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) return res.status(404).send('File not found or expired');

  const ext = path.extname(filepath).toLowerCase();
  const contentType = ['.jpg', '.jpeg'].includes(ext) ? 'image/jpeg' :
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

function cleanUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split('?')[0];
  }
}

// Скачивает файл по прямой ссылке (cobalt tunnel/redirect url) в TMP_DIR
async function downloadToTmp(fileUrl, extHint) {
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Failed to fetch resolved media: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = extHint || guessExtFromContentType(res.headers.get('content-type'));
  const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`;
  const filepath = path.join(TMP_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  return filename;
}

function guessExtFromContentType(ct) {
  if (!ct) return '.bin';
  if (ct.includes('jpeg')) return '.jpg';
  if (ct.includes('png')) return '.png';
  if (ct.includes('gif')) return '.gif';
  if (ct.includes('mp4')) return '.mp4';
  if (ct.includes('webm')) return '.webm';
  return '.bin';
}

// Пытается скачать через self-hosted cobalt instance.
// Возвращает { media: [{url, type}] } или null, если cobalt не смог обработать ссылку.
async function tryCobalt(url, baseUrl) {
  const res = await fetch(COBALT_API_URL + '/', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url })
  });

  const data = await res.json();

  if (data.status === 'error') {
    console.log('[COBALT ERROR]:', data.error?.code, data.error?.context);
    return null;
  }

  const media = [];

  if (data.status === 'redirect' || data.status === 'tunnel') {
    const filename = await downloadToTmp(data.url);
    const ext = path.extname(filename).toLowerCase();
    const isVideo = ['.mp4', '.mov', '.webm', '.mkv'].includes(ext);
    media.push({ url: `${baseUrl}/file/${filename}`, type: isVideo ? 'video' : 'photo' });
    return { media };
  }

  if (data.status === 'local-processing') {
    // tunnel — массив URL кусков. Для наших целей просто скачиваем каждый —
    // полноценный локальный ремукс/склейку не реализуем.
    for (const tunnelUrl of data.tunnel) {
      const filename = await downloadToTmp(tunnelUrl);
      const ext = path.extname(filename).toLowerCase();
      const isVideo = ['.mp4', '.mov', '.webm', '.mkv'].includes(ext);
      media.push({ url: `${baseUrl}/file/${filename}`, type: isVideo ? 'video' : 'photo' });
    }
    return { media };
  }

  if (data.status === 'picker') {
    // Слайд-шоу TikTok / несколько медиа на выбор — именно это не умел yt-dlp
    for (const item of data.picker) {
      const ext = item.type === 'video' ? '.mp4' : item.type === 'gif' ? '.gif' : '.jpg';
      const filename = await downloadToTmp(item.url, ext);
      media.push({
        url: `${baseUrl}/file/${filename}`,
        type: item.type === 'video' ? 'video' : 'photo'
      });
    }
    return { media };
  }

  console.log('[COBALT] Unexpected status:', data.status);
  return null;
}

async function runYtDlp(url, outputPath, extraArgs = []) {
  return execFileAsync('yt-dlp', [
    url,
    '-o', outputPath,
    '-f', 'best',
    '--no-warnings',
    '--restrict-filenames',
    '--socket-timeout', '30',
    '--fragment-retries', '3',
    '--retries', '2',
    ...extraArgs
  ], { timeout: 60000 });
}

async function tryYtDlp(url, baseUrl) {
  const filenameBase = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const outputPath = path.join(TMP_DIR, `${filenameBase}.%(ext)s`);

  await runYtDlp(url, outputPath);

  const files = fs.readdirSync(TMP_DIR)
    .filter(f => f.startsWith(filenameBase))
    .sort();

  if (files.length === 0) {
    throw new Error('yt-dlp returned no files');
  }

  const media = files.map(file => {
    const ext = path.extname(file).toLowerCase();
    const isVideo = ['.mp4', '.mov', '.webm', '.mkv'].includes(ext);
    return {
      url: `${baseUrl}/file/${file}`,
      type: isVideo ? 'video' : 'photo'
    };
  });

  return { media };
}

function scheduleCleanup(media, baseUrl) {
  const filenames = media.map(m => m.url.replace(`${baseUrl}/file/`, ''));
  setTimeout(() => {
    for (const filename of filenames) {
      const filepath = path.join(TMP_DIR, filename);
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    }
    console.log(`Cleaned up ${filenames.length} files`);
  }, 5 * 60 * 1000);
}

// Бот на стороне Telegram ожидает старый формат { videoUrl }.
// Сохраняем это поле для обратной совместимости, но не убираем media —
// если позже понадобится слать несколько картинок из одного TikTok-поста,
// media[] уже под рукой.
function toCompatResponse(result) {
  return {
    videoUrl: result.media[0]?.url || null,
    media: result.media
  };
}

app.get('/debug/cobalt', async (req, res) => {
  try {
    const started = Date.now();
    const r = await fetch(COBALT_API_URL + '/');
    const data = await r.json();
    res.json({
      reachable: true,
      cobalt_api_url_used: COBALT_API_URL,
      response_time_ms: Date.now() - started,
      cobalt_version: data.cobalt?.version,
      services: data.cobalt?.services
    });
  } catch (err) {
    res.status(500).json({
      reachable: false,
      cobalt_api_url_used: COBALT_API_URL,
      error: err.message
    });
  }
});

app.post('/download', async (req, res) => {
  const { url: rawUrl } = req.body;
  if (!rawUrl) return res.status(400).json({ error: 'No URL' });

  const profilePatterns = [
    /tiktok\.com\/@[\w.-]+\/?$/,
    /instagram\.com\/[\w.-]+\/?$/,
    /youtube\.com\/(c|channel|user)\//
  ];
  if (profilePatterns.some(p => p.test(rawUrl))) {
    return res.status(400).json({ error: 'Profile links are not supported.' });
  }

  const url = cleanUrl(rawUrl);
  const baseUrl = req.protocol + '://' + req.get('host');
  console.log(`Processing: ${url}`);

  // 1. Основной путь: self-hosted cobalt
  try {
    const result = await tryCobalt(url, baseUrl);
    if (result) {
      console.log(`[COBALT OK] ${result.media.length} files, type: ${result.media[0].type}`);
      res.json(toCompatResponse(result));
      scheduleCleanup(result.media, baseUrl);
      return;
    }
    console.log('[COBALT] Could not process, falling back to yt-dlp');
  } catch (err) {
    console.error('[COBALT REQUEST ERROR]:', err.message);
    console.log('[COBALT] Instance unreachable or failed, falling back to yt-dlp');
  }

  // 2. Fallback: yt-dlp
  try {
    const result = await tryYtDlp(url, baseUrl);
    console.log(`[YTDLP OK] ${result.media.length} files, type: ${result.media[0].type}`);
    res.json(toCompatResponse(result));
    scheduleCleanup(result.media, baseUrl);
  } catch (error) {
    console.error('[DOWNLOAD ERROR]:', error.message);
    if (error.stderr) console.error('[YT-DLP STDERR]:', error.stderr);

    const isUnsupported = error.message.includes('Unsupported URL') ||
                          error.stderr?.includes('Unsupported URL');

    res.status(500).json({
      error: isUnsupported
        ? 'Link format not supported by either extractor.'
        : 'Download failed.',
      details: error.message || error.stderr
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
