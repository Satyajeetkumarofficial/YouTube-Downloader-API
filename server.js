const express = require("express");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json());

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || "/tmp/downloads";
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// ─── Base yt-dlp flags (429 fix) ─────────────────────────────────────────────
const BASE_FLAGS = [
  "--no-playlist",
  "--socket-timeout 30",
  "--retries 5",
  "--fragment-retries 5",
  "--add-header 'Accept-Language:en-US,en;q=0.9'",
  "--add-header 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'",
  `--add-header 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'`,
  "--extractor-args 'youtube:player_client=web,mweb'",
].join(" ");

function runYtDlp(args) {
  const cmd = `yt-dlp ${BASE_FLAGS} ${args}`;
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024, env: { ...process.env, PATH: `/root/.deno/bin:${process.env.PATH}` } }, (err, stdout, stderr) => {
      if (err) return reject(stderr || err.message);
      resolve(stdout.trim());
    });
  });
}

function safeFilename(name) {
  return name.replace(/[^a-z0-9_\-\.]/gi, "_").substring(0, 100);
}

// ── GET /info ────────────────────────────────────────────────────────────────
app.get("/info", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url parameter required" });
  try {
    const raw = await runYtDlp(`--dump-json "${url}"`);
    const data = JSON.parse(raw);
    const qualities = [...new Set((data.formats || []).filter(f => f.height).map(f => `${f.height}p`))].sort((a, b) => parseInt(b) - parseInt(a));
    res.json({
      title: data.title,
      duration: data.duration,
      duration_string: data.duration_string,
      thumbnail: data.thumbnail,
      uploader: data.uploader,
      view_count: data.view_count,
      upload_date: data.upload_date,
      description: data.description?.substring(0, 300),
      available_qualities: qualities,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch info", details: err });
  }
});

// ── GET /qualities ───────────────────────────────────────────────────────────
app.get("/qualities", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url parameter required" });
  try {
    const raw = await runYtDlp(`--dump-json "${url}"`);
    const data = JSON.parse(raw);
    const formats = (data.formats || [])
      .filter(f => f.vcodec !== "none" && f.height)
      .map(f => ({
        format_id: f.format_id,
        quality: `${f.height}p`,
        ext: f.ext,
        fps: f.fps,
        filesize: f.filesize ? `${(f.filesize / 1024 / 1024).toFixed(2)} MB` : "unknown",
      }))
      .sort((a, b) => parseInt(b.quality) - parseInt(a.quality));
    res.json({ title: data.title, formats });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch qualities", details: err });
  }
});

// ── GET /download/video ──────────────────────────────────────────────────────
app.get("/download/video", async (req, res) => {
  const { url, quality = "best" } = req.query;
  if (!url) return res.status(400).json({ error: "url parameter required" });
  try {
    const infoRaw = await runYtDlp(`--print title "${url}"`);
    const title = safeFilename(infoRaw);
    const outPath = path.join(DOWNLOAD_DIR, `${title}_${Date.now()}.mp4`);

    let formatArg = "-f bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";
    if (quality !== "best") {
      const h = quality.replace("p", "");
      formatArg = `-f "bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${h}][ext=mp4]/best"`;
    }

    await runYtDlp(`${formatArg} --merge-output-format mp4 -o "${outPath}" "${url}"`);
    res.setHeader("Content-Disposition", `attachment; filename="${title}.mp4"`);
    res.setHeader("Content-Type", "video/mp4");
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on("close", () => fs.unlink(outPath, () => {}));
  } catch (err) {
    res.status(500).json({ error: "Video download failed", details: err });
  }
});

// ── GET /download/audio ──────────────────────────────────────────────────────
app.get("/download/audio", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url parameter required" });
  try {
    const infoRaw = await runYtDlp(`--print title "${url}"`);
    const title = safeFilename(infoRaw);
    const outPath = path.join(DOWNLOAD_DIR, `${title}_${Date.now()}.mp3`);
    await runYtDlp(`-f bestaudio --extract-audio --audio-format mp3 --audio-quality 192K -o "${outPath}" "${url}"`);
    res.setHeader("Content-Disposition", `attachment; filename="${title}.mp3"`);
    res.setHeader("Content-Type", "audio/mpeg");
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on("close", () => fs.unlink(outPath, () => {}));
  } catch (err) {
    res.status(500).json({ error: "Audio download failed", details: err });
  }
});

// ── Health Check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) =>
  res.json({
    status: "✅ YouTube Downloader API running!",
    endpoints: ["GET /info?url=", "GET /qualities?url=", "GET /download/video?url=&quality=720p", "GET /download/audio?url="],
  })
);

const PORT = process.env.PORT || 8000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server on port ${PORT}`));
