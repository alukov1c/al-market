export function scheduledDay(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(part => [part.type, part.value]));
  return Number(parts.hour) >= 8 ? `${parts.year}-${parts.month}-${parts.day}` : null;
}

// Serijska obrada zahteva i nadoknada propuštenog dnevnog termina.
export function createAnalysisRunner({ readReports, generate, saveReport, now = () => new Date() }) {
  let queue = Promise.resolve();
  function run(automatic = false) {
    const task = queue.then(async () => {
      const day = automatic ? scheduledDay(now()) : null;
      if (automatic && !day) return null;
      if (automatic && (await readReports()).some(report => report.scheduledDay === day)) return null;
      const report = await generate();
      if (automatic) report.scheduledDay = day;
      await saveReport(report);
      return report;
    });
    queue = task.catch(() => {});
    return task;
  }
  return { run };
}
