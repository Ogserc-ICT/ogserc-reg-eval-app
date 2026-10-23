// DEV ONLY. Time the dashboard and Register with realistic volume, on a throwaway database.
//
//   npx tsx scripts/perf-dashboard.ts [--count 2000] [--http]
//
// --http also times the real pages over HTTP against a production build in .next-perf
// (build it first: NEXT_DIST_DIR=.next-perf npx next build).
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { addDays, todayInLagos } from "../src/domain/dates";
import { getDashboard } from "../src/server/dashboard";
import { listRegister } from "../src/server/register";
import { seedReferenceData } from "../src/server/seed";
import { newSessionToken, hashSessionToken } from "../src/server/session-store";
import { startEmbeddedDb } from "./embedded-db";
import { generateFakeData } from "./seed-fake";

const args = process.argv.slice(2);
const count = Number(args[args.indexOf("--count") + 1] || 2000) || 2000;

async function time<T>(label: string, runs: number, fn: () => Promise<T>) {
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await fn();
    ms.push(performance.now() - t);
  }
  const sorted = [...ms].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  console.log(
    `${label.padEnd(44)} first ${ms[0]!.toFixed(0).padStart(5)} ms · median ${median.toFixed(0).padStart(5)} ms · runs ${ms.map((m) => m.toFixed(0)).join(", ")}`,
  );
}

async function main() {
  const db0 = await startEmbeddedDb({
    dir: mkdtempSync(path.join(tmpdir(), "ogserc-perf-")),
    port: 5437,
    database: "ogserc_perf",
    persistent: false,
  });
  process.env.DATABASE_URL = db0.url;
  execSync("npx prisma migrate deploy", { env: { ...process.env }, stdio: "pipe" });
  const db = new PrismaClient({ datasourceUrl: db0.url });
  try {
    await seedReferenceData(db);
    const admin = await db.user.create({
      data: {
        name: "Perf Admin",
        email: "perf@ogserc.test",
        roles: ["ADMIN", "APPROVING_OFFICER"],
        passwordHash: "x",
      },
    });

    const effectiveDate = addDays(todayInLagos(), -300);
    const t = performance.now();
    const result = await generateFakeData(db, {
      count,
      ownUse: Math.round(count / 10),
      seed: 7,
      effectiveDate,
    });
    console.log(
      `Generated ${JSON.stringify(result)} in ${((performance.now() - t) / 1000).toFixed(1)} s`,
    );
    console.log(`Effective Date ${effectiveDate}; today ${todayInLagos()}\n`);

    const actor = { id: admin.id, name: admin.name, email: admin.email, roles: admin.roles };
    await time("getDashboard (data load + all figures)", 5, () => getDashboard(db, actor));
    await time("listRegister (all rows, calculated)", 5, () => listRegister(db, {}));
    await time("listRegister (search 'Ifo')", 3, () => listRegister(db, { q: "ifo" }));

    const d = (await getDashboard(db, actor)).dashboard;
    console.log(
      `\nSanity: ${d.submissions.total} submissions, ${d.submissions.registered} registered, ` +
        `${d.submissions.ownUse} own-use; total due ₦${(d.money.totalDue / 100).toLocaleString("en-NG")}, ` +
        `collected ₦${(d.money.collected / 100).toLocaleString("en-NG")}, ` +
        `rate ${Math.round((d.money.collectionRate ?? 0) * 100)}%, credits ₦${(d.money.overpaid / 100).toLocaleString("en-NG")} ` +
        `(${d.money.overpaidSubmissions} submissions), unpaid on closed ₦${(d.money.unpaidOnClosed / 100).toLocaleString("en-NG")}`,
    );

    if (args.includes("--http")) {
      const token = newSessionToken();
      await db.session.create({
        data: {
          tokenHash: hashSessionToken(token),
          userId: admin.id,
          expires: new Date(Date.now() + 3_600_000),
        },
      });
      const server = spawn("npx", ["next", "start", "-p", "3300"], {
        env: {
          ...process.env,
          DATABASE_URL: db0.url,
          NEXT_DIST_DIR: ".next-perf",
          NODE_ENV: "production",
          APP_URL: "http://localhost:3300",
          AUTH_SECRET: "perf-only-secret-0123456789abcdef",
        },
        shell: true,
        stdio: "ignore",
      });
      try {
        for (let i = 0; i < 60; i++) {
          try {
            if ((await fetch("http://localhost:3300/login")).ok) break;
          } catch {}
          await new Promise((r) => setTimeout(r, 1000));
        }
        const page = (p: string) => async () => {
          const res = await fetch(`http://localhost:3300${p}`, {
            // Production uses the __Secure- cookie name (useSecureCookies).
            headers: { cookie: `__Secure-authjs.session-token=${token}` },
            redirect: "manual",
          });
          if (res.status !== 200) throw new Error(`${p}: HTTP ${res.status}`);
          await res.text();
        };
        console.log("");
        await time("HTTP GET /  (dashboard page, production build)", 6, page("/"));
        await time("HTTP GET /submissions  (Register, page 1)", 6, page("/submissions"));
        await time("HTTP GET /evaluations", 4, page("/evaluations"));
      } finally {
        server.kill();
        if (process.platform === "win32" && server.pid) {
          try {
            execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
          } catch {}
        }
      }
    }
  } finally {
    await db.$disconnect();
    await db0.stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
