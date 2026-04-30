const express = require('express');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegStatic);

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TMP = '/tmp';

async function downloadFile(url, dest) {
  const response = await axios({ url, responseType: 'stream' });
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(dest);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

app.use('/videos', express.static(TMP));

app.post('/stitch', async (req, res) => {
  const { scene1_video_url, scene2_video_url, audio_url } = req.body;

  const timestamp = Date.now();
  const scene1Path   = path.join(TMP, `scene1_${timestamp}.mp4`);
  const scene2Path   = path.join(TMP, `scene2_${timestamp}.mp4`);
  const audioPath    = path.join(TMP, `audio_${timestamp}.mpga`);
  const combinedPath = path.join(TMP, `combined_${timestamp}.mp4`);
  const outputName   = `final_${timestamp}.mp4`;
  const outputPath   = path.join(TMP, outputName);

  try {
    console.log('Downloading files...');
    await Promise.all([
      downloadFile(scene1_video_url, scene1Path),
      downloadFile(scene2_video_url, scene2Path),
      downloadFile(audio_url, audioPath)
    ]);

    console.log('Concatenating videos...');
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(scene1Path)
        .input(scene2Path)
        .complexFilter([
          '[0:v][1:v]concat=n=2:v=1:a=0[outv]'
        ])
        .outputOptions([
          '-map [outv]',
          '-c:v libx264',
          '-preset fast',
          '-crf 23'
        ])
        .output(combinedPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    console.log('Adding audio...');
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(combinedPath)
        .input(audioPath)
        .outputOptions([
          '-c:v copy',
          '-c:a aac',
          '-map 0:v:0',
          '-map 1:a:0'
        ])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    const videoUrl = `https://tiktok-ffmpeg-server.onrender.com/videos/${outputName}`;
    console.log('Done:', videoUrl);
    res.json({ url: videoUrl });

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    [scene1Path, scene2Path, audioPath, combinedPath]
      .forEach(f => fs.unlink(f, () => {}));
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
