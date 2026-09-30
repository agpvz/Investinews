import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRouter, DEMO } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, buildRouter());
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.listen(PORT, HOST, () => {
  console.log(`INVESTINEWS terminal listening on http://localhost:${PORT}${DEMO ? '  [DEMO MODE: offline sample data]' : ''}`);
});
