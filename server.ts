import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import uploadRouter from './server/routes/upload.ts';
import transcribeRouter from './server/routes/transcribe.ts';
import renderRouter from './server/routes/render.ts';
import { startProjectCleanupTimer } from './server/services/projectStore.ts';

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '2mb' }));

  startProjectCleanupTimer();

  // API Routes
  app.use('/api', uploadRouter);
  app.use('/api', transcribeRouter);
  app.use('/api', renderRouter);

  // Return JSON 404 for unknown API paths
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(503).send('Application build not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ClipScript server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ClipScript server:', err);
  process.exit(1);
});
