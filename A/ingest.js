import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import path from 'node:path';
import { validate } from './data.js';
export function authorized(header, token) {
  if (!token || token.length < 32 || typeof header !== 'string') return false;
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header), digest('Bearer ' + token));
}
export function installIngest(app, config) {
  const pending = new Map();
  app.post('/api/ingest/:id', async (req, res, next) => {
    if (config.mode !== 'remote') return res.status(404).end();
    if (!authorized(req.headers.authorization, config.uploadToken)) return res.status(401).json({error:'Unauthorized'});
    const id = req.params.id;
    if (!Object.hasOwn(config.portfolios, id)) return res.status(400).json({error:'Invalid portfolio'});
    let raw;
    try {
      raw = validate(req.body, id, config.portfolios[id]);
      if ((raw.schemaVersion !== 2 || raw.historyMode !== 'closed-trades')) throw Error('Ažurirati izvoznik na verziju 1.11');
      const age = Date.now() - raw.exportedAt * 1000;
      if (age < -5000 || age > config.staleAfterMs) throw Error('Stale export');
    } catch { return res.status(400).json({error:'Invalid or stale export'}); }
    const previous = pending.get(id) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      await mkdir(config.sourceDir, { recursive:true, mode:0o700 });
      const target = path.join(config.sourceDir, config.portfolios[id].file);
      try {
        const stored = JSON.parse(await readFile(target, 'utf8'));
        if (stored.exportedAt >= raw.exportedAt) return;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const temporary = target + '.' + randomUUID() + '.tmp';
      await writeFile(temporary, JSON.stringify(raw), { encoding:'utf8', mode:0o600 });
      await rename(temporary, target);
    });
    pending.set(id, task);
    try { await task; res.status(204).end(); }
    catch (error) { next(error); }
    finally { if (pending.get(id) === task) pending.delete(id); }
  });
}
