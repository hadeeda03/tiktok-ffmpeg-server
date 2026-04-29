const express = require('express');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

ffmpeg.setFfmpegPath(ffmpegStatic);

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TMP = '/tmp';
const KIE_API_KEY = 'd837781fb3108b0695fec1f5acc1e908';

async function downloadFile(url, dest) {
  const response = await axios({ url, responseType: 'stream' });
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(dest);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function uploadToKie(filePath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), 'final.mp4');
  form.append('uploadPath', 'video');

  const response = await axios.post(
    'https://kieai.erweima.ai/api/v1/file-stream-upload',
    form,
    {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${KIE_API_KEY}`
      }
    }
  );

  return response.data.data.url;
}

app.post('/stitch', async (req, res) => {
  const { scene1_video_url, scene2_video_url, audio_url } = req.body;

  const scene1Path = path.join(TMP, 'scene1.mp4');
  const scene2Path = path.join(TMP, 'scene2.mp4');
  const audioPath = path.join(TMP, 'audio.mpga');
  const listPath  = path.join(TMP, 'list.txt');
  const combinedPath = path.join(TMP, 'combined.mp4');
  const outputPath   = path.join(TMP, 'final.mp4');

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

    console.log('Uploading to KIE...');
    const videoUrl = await uploadToKie(outputPath);

    console.log('Done:', videoUrl);
    res.json({ url: videoUrl });

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    [scene1Path, scene2Path, audioPath, listPath, combinedPath, outputPath]
      .forEach(f => fs.unlink(f, () => {}));
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
