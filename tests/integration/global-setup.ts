import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { startEmbeddedDb, type EmbeddedDb } from "../../scripts/embedded-db";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let embedded: EmbeddedDb | null = null;

export async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    embedded = await startEmbeddedDb({
      dir: mkdtempSync(path.join(tmpdir(), "ogserc-test-")),
      port: 5434,
      database: "ogserc_test",
      persistent: false,
    });
    url = embedded.url;
  }
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  project.provide("databaseUrl", url);
}

export async function teardown() {
  await embedded?.stop();
}
