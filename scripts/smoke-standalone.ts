// Smoke-test the production server bundle (the `server.js` the Docker image runs) without Docker.
//
//   npm run smoke:standalone
//
// Builds into .next-perf/ with no database reachable (as the Docker build does), lays the bundle out as
// the image does (static files, public/, assets/), then on a throwaway database checks: start-up
// refusal without APP_URL, health, sign-in page, a signed-in page, static files, the cron route, and a
// PDF rendered by the server (fonts and images found at run time).
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { generateAcknowledgement } from "../src/server/documents";
import { createSubmission } from "../src/server/intake";
import { ensureAdmin, seedReferenceData } from "../src/server/seed";
import { hashSessionToken, newSessionToken } from "../src/server/session-store";
import { startEmbeddedDb } from "./embedded-db";

const DIST = ".next-perf";
const STANDALONE = path.join(DIST, "standalone");
const PORT = 3400;
const BASE = `http://localhost:${PORT}`;
const CRON_SECRET = "smoke-only-cron-secret-0123456789abcdef";
const skipBuild = process.argv.includes("--no-build");

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function startServer(env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, ["server.js"], {
    cwd: STANDALONE,
    env: { ...env, PORT: String(PORT), HOSTNAME: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function stop(server: ChildProcess) {
  server.kill();
  if (process.platform === "win32" && server.pid) {
    try {
      execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
    } catch {}
  }
}

async function main() {
  if (!skipBuild) {
    console.log("Building the standalone bundle (no database reachable)…");
    execSync("npx next build", {
      stdio: "inherit",
      env: {
        ...process.env,
        NEXT_DIST_DIR: DIST,
        DATABASE_URL: "postgresql://build:build@127.0.0.1:1/build",
        AUTH_SECRET: "build-time-placeholder-not-used-at-runtime",
      },
    });
  }
  // Lay out the bundle as the Dockerfile's runner stage does.
  rmSync(path.join(STANDALONE, DIST, "static"), { recursive: true, force: true });
  cpSync(path.join(DIST, "static"), path.join(STANDALONE, DIST, "static"), { recursive: true });
  cpSync("public", path.join(STANDALONE, "public"), { recursive: true });
  cpSync("assets", path.join(STANDALONE, "assets"), { recursive: true });

  const pg = await startEmbeddedDb({
    dir: mkdtempSync(path.join(tmpdir(), "ogserc-smoke-")),
    port: 5439,
    database: "ogserc_smoke",
    persistent: false,
  });
  const db = new PrismaClient({ datasourceUrl: pg.url });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: pg.url,
    AUTH_SECRET: "smoke-only-auth-secret-0123456789abcdef0123",
    CRON_SECRET,
    APP_URL: BASE,
    APP_TODAY: "",
  };
  let server: ChildProcess | null = null;
  try {
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: pg.url },
      stdio: "pipe",
    });
    await seedReferenceData(db);
    const { user } = await ensureAdmin(
      db,
      "smoke@ogserc.test",
      "Quiet harbour lantern 7319 drift!",
      {
        production: true,
      },
    );
    await db.user.update({
      where: { id: user.id },
      data: { roles: ["ADMIN", "REGISTRY_OFFICER", "REVIEWING_SUPERVISOR"] },
    });
    const actor = {
      id: user.id,
      name: user.name,
      email: user.email,
      roles: ["ADMIN", "REGISTRY_OFFICER", "REVIEWING_SUPERVISOR"] as const,
    };
    const sub = await createSubmission(
      db,
      { ...actor, roles: [...actor.roles] },
      {
        registeredName: "Smoke Test Mini-Grid Ltd",
        dateSubmitted: "2026-10-22",
        submissionChannel: "",
        registrantType: "",
        cacNo: "",
        tin: "",
        address: "",
        principalLga: "Ifo",
        otherAreasServed: "",
        primaryActivityCode: "MGD",
        secondaryActivityCode: "",
        installedCapacityMw: "2",
        customers: "",
        licenceStatus: "NERC registration/permit (mini-grid/captive)",
        licenceNo: "",
        licenceExpiry: "",
        complianceOfficer: "",
        phone: "",
        email: "",
        operatingOnEffectiveDate: "Y",
        plannedStartDate: "",
        categoryOverride: "",
        overrideReason: "",
        remarks: "",
        evaluatingOfficerId: "",
      },
    );
    const token = newSessionToken();
    await db.session.create({
      data: {
        tokenHash: hashSessionToken(token),
        userId: user.id,
        expires: new Date(Date.now() + 3_600_000),
      },
    });
    const cookie = `__Secure-authjs.session-token=${token}`;

    // 1. Refuses to start in production without APP_URL.
    const bad = startServer({ ...env, APP_URL: "" });
    const exitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 20_000);
      bad.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    if (exitCode === null) stop(bad);
    check(
      "refuses to start in production without APP_URL",
      exitCode !== null && exitCode !== 0,
      `exit ${exitCode}`,
    );

    // 2. Starts with the full environment.
    server = startServer(env);
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      try {
        up = (await fetch(`${BASE}/api/health`)).ok;
      } catch {}
      if (!up) await new Promise((r) => setTimeout(r, 1000));
    }
    check("starts and reports healthy (/api/health)", up);

    const get = (p: string, withCookie = true) =>
      fetch(`${BASE}${p}`, { headers: withCookie ? { cookie } : {}, redirect: "manual" });

    const login = await get("/login", false);
    const html = await login.text();
    check("sign-in page renders", login.status === 200 && html.includes("Sign in"));
    const chunk = /\/_next\/static\/[^"]+\.js/.exec(html)?.[0];
    check("static files are served", !!chunk && (await get(chunk!, false)).status === 200, chunk);
    check("logo is served from public/", (await get("/ogserc-logo.png", false)).status === 200);
    const anon = await get("/", false);
    check("signed-out visitors are sent to sign in", anon.status === 307 || anon.status === 302);
    const dash = await get("/");
    check(
      "dashboard renders for a signed-in user",
      dash.status === 200 && (await dash.text()).includes("Daily review"),
    );

    // The acknowledgement letter (available before payment; the Finance gate holds evaluation PDFs).
    const letter = await generateAcknowledgement(db, { ...actor, roles: [...actor.roles] }, sub.id);
    const pdf = await get(`/documents/${letter.id}`);
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    check(
      "server renders a PDF with its fonts and logo",
      pdf.status === 200 &&
        Buffer.from(bytes.slice(0, 5)).toString() === "%PDF-" &&
        bytes.length > 20_000,
      `${pdf.status}, ${bytes.length} bytes`,
    );

    const cron = (secret: string) =>
      fetch(`${BASE}/api/cron/daily-review`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      });
    check("cron route refuses a wrong secret", (await cron("wrong")).status === 401);
    const run = await cron(CRON_SECRET);
    check("cron route runs the daily review", run.status === 200, JSON.stringify(await run.json()));
  } finally {
    if (server) stop(server);
    await db.$disconnect();
    await pg.stop();
  }
  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
