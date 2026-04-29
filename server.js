const express = require('express');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

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

app.post('/stitch', async (req, res) => {
  const { scene1_video_url, scene2_video_url, audio_url } = req.body;

  const scene1Path = path.join(TMP, 'scene1.mp4');
  const scene2Path = path.join(TMP, 'scene2.mp4');
  const audioPath = path.join(TMP, 'audio.mpga');
  const listPath = path.join(TMP, 'list.txt');
  const combinedPath = path.join(TMP, 'combined.mp4');
  const outputPath = path.join(TMP, 'final.mp4');

  try {
    console.log('Downloading files...');
    await Promise.all([
      downloadFile(scene1_video_url, scene1Path),
      downloadFile(scene2_video_url, scene2Path),
      downloadFile(audio_url, audioPath)
    ]);

    fs.writeFileSync(listPath, `file '${scene1Path}'\nfile '${scene2Path}'`);

    console.log('Concatenating videos...');
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions(['-c copy'])
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
          '-shortest',
          '-map 0:v:0',
          '-map 1:a:0'
        ])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    console.log('Sending file...');
    res.download(outputPath, 'final.mp4', (err) => {
      if (err) console.error('Send error:', err);
      [scene1Path, scene2Path, audioPath, listPath, combinedPath, outputPath]
        .forEach(f => fs.unlink(f, () => {}));
    });

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
