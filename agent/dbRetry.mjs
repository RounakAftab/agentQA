// Riding out a dropped database connection while a run is going (e.g. "Server has closed the
// connection" when Neon's pooler or a restarted local Postgres closes it). Prisma reconnects on the
// next query, so a run keeps going and writes what it missed on its next flush.

// How long a run keeps going while the database can't be reached. Shorter than the 2 minutes after
// which the app gives up on a silent run, so a run never outlives what the page shows.
export const DB_OUTAGE_MS = 60_000;

const CONNECTION_ERRORS = new Set(['P1001', 'P1002', 'P1017', 'P2024', 'DB_OUTAGE']);

export const isConnectionError = (err) =>
  CONNECTION_ERRORS.has(err?.code) || /closed the connection|can't reach database|connection (reset|refused|terminated)/i.test(err?.message ?? '');

// Tracks one run's failed writes. `failed(err)` returns quietly during a short outage and throws a
// DB_OUTAGE error once the database has been unreachable for DB_OUTAGE_MS; other errors are rethrown.
export function outageTracker(tag) {
  let failingSince = null;
  return {
    ok() {
      if (failingSince) console.log(`[${tag}] Database connection is back`);
      failingSince = null;
    },
    failed(err) {
      if (!isConnectionError(err)) throw err;
      if (!failingSince) console.warn(`[${tag}] Lost the database connection, retrying: ${err.message.split('\n').at(-1)}`);
      failingSince ??= Date.now();
      if (Date.now() - failingSince > DB_OUTAGE_MS) {
        throw Object.assign(new Error(`The database could not be reached for ${DB_OUTAGE_MS / 1000} seconds, so the run was stopped.`), { code: 'DB_OUTAGE' });
      }
    },
  };
}

// Writes a run's result, retrying through a dropped connection for as long as the app waits for a
// silent run (2 minutes) before marking it failed itself. `flush` resolves null when it could not write.
export async function saveResult(flush, final) {
  const giveUpAt = Date.now() + 2 * 60_000;
  for (;;) {
    try {
      if ((await flush({ ...final, finishedAt: new Date() })) !== null) return;
    } catch (err) {
      if (!isConnectionError(err)) throw err;
    }
    if (Date.now() > giveUpAt) throw new Error('Could not save the result: the database is unreachable.');
    await new Promise((r) => setTimeout(r, 4_000));
  }
}
