// Local Postgres without Docker, using the embedded-postgres binaries (dev and test only).
// Usage: npm run db:embedded   → keeps running on port 5433, data in .data/pg
import { existsSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

export interface EmbeddedDb {
  url: string;
  stop: () => Promise<void>;
}

export async function startEmbeddedDb(opts: {
  dir: string;
  port: number;
  database: string;
  persistent: boolean;
}): Promise<EmbeddedDb> {
  const pg = new EmbeddedPostgres({
    databaseDir: opts.dir,
    port: opts.port,
    user: "ogserc",
    password: "ogserc",
    persistent: opts.persistent,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
  });
  if (!existsSync(path.join(opts.dir, "PG_VERSION"))) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase(opts.database);
  } catch {
    // Already exists.
  }
  return {
    url: `postgresql://ogserc:ogserc@localhost:${opts.port}/${opts.database}?schema=public`,
    stop: () => pg.stop(),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  startEmbeddedDb({
    dir: path.resolve(".data/pg"),
    port: 5433,
    database: "ogserc",
    persistent: true,
  }).then((db) => {
    console.log(`Embedded Postgres running: ${db.url}`);
    console.log("Press Ctrl+C to stop.");
    const stop = () => db.stop().finally(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}
