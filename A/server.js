import express from 'express';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { snapshot, publicSnapshot } from './data.js';
import { installIngest } from './ingest.js';
import { installMarket } from './market-server.js';

const app = express();
const server = http.createServer(app);
const local = name => fileURLToPath(new URL(name, import.meta.url));
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.json({ limit: '64kb' }));
app.get(['/', '/m1', '/m1.html', '/A/m1.html'], (_req, res) => res.sendFile(local('m1.html')));
app.get(['/portfolio.html', '/A/portfolio.html'], (_req, res) => res.redirect(302, '/m1.html'));
app.get('/healthz', (_req, res) => res.json({status:'ok'}));
for (const name of ['portfolio.js', 'market.js', 'stil.css', 'AL-market.png']) {
  app.get(['/' + name, '/A/' + name], (_req, res) => res.sendFile(local(name)));
}
app.use(['/ico', '/A/ico'], express.static(local('ico/'), { dotfiles: 'deny', index: false }));
installIngest(app, config);
app.get('/api/portfolios', async (_req, res) => res.json(publicSnapshot(await snapshot(config))));
const closeMarket = installMarket(app, server);
app.use((_req, res) => res.status(404).end());
app.use((error, _req, res, _next) => {
  console.error('Portfolio server:', error.message);
  res.status(error.status || 500).json({ error: 'Podaci trenutno nisu dostupni.' });
});
server.on('error', error => { closeMarket(); console.error('Portfolio server:', error.message); process.exitCode = 1; });
server.listen(config.port, config.host, () => console.log(`Portfolio: http://${config.host}:${config.port}/m1.html`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { closeMarket(); server.close(); });
