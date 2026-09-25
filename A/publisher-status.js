import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function publisherStatus(config) {
  const file = path.join(config.dataDir, 'publisher-status.json');
  let queue = Promise.resolve();
  async function read() {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  function update(change) {
    const task = queue.catch(() => {}).then(async () => {
      const current = await read();
      const next = change(current);
      if (!next) return;
      await mkdir(config.dataDir, {recursive:true, mode:0o700});
      const temporary = file + '.' + randomUUID() + '.tmp';
      await writeFile(temporary, JSON.stringify(next), {mode:0o600});
      await rename(temporary, file);
    });
    queue = task;
    return task;
  }
  return {
    event(body, now = Date.now()) {
      if (!body || !['running', 'stopped'].includes(body.state) ||
          typeof body.session !== 'string' || !/^[a-f0-9-]{36}$/.test(body.session) ||
          !Number.isSafeInteger(body.startedAt) || body.startedAt <= 0 || body.startedAt > now + 5000 ||
          !Number.isSafeInteger(body.eventAt) || body.eventAt < body.startedAt ||
          body.eventAt > now + 5000 || now - body.eventAt > 30000) throw Error('Invalid publisher event');
      return update(current => {
        if (current && (current.startedAt > body.startedAt ||
            (current.startedAt === body.startedAt && current.session !== body.session))) return null;
        const same = current?.session === body.session;
        if (same && (current.eventAt >= body.eventAt || current.stoppedAt)) return null;
        return {session:body.session, startedAt:body.startedAt, eventAt:body.eventAt,
          stoppedAt:body.state === 'stopped' ? body.eventAt : null,
          heartbeatAt:now, lastReceivedAt:current?.lastReceivedAt ?? null};
      });
    },
    received() {
      return update(current => ({...current, lastReceivedAt:Date.now()}));
    },
    async snapshot() {
      await queue.catch(() => {});
      const value = await read();
      if (!value) return null;
      return {startedAt:value.startedAt ?? null, stoppedAt:value.stoppedAt ?? null,
        lastReceivedAt:value.lastReceivedAt ?? null,
        state:value.stoppedAt ? 'stopped' : Date.now() - value.heartbeatAt <= config.staleAfterMs ? 'running' : 'offline'};
    }
  };
}
