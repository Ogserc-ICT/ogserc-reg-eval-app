import { appToday } from "./clock";
import type { DomainContext } from "@/domain/submission";
import { loadReferenceData, loadSettings } from "./reference-data";
import type { Db, Tx } from "./types";

/** Reference data, Settings and today's Lagos date, for domain calculations. */
export async function loadContext(db: Db | Tx, today = appToday()): Promise<DomainContext> {
  const [ref, settings] = await Promise.all([loadReferenceData(db), loadSettings(db)]);
  return { ref, settings, today };
}
