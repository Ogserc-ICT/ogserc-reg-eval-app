// DEV ONLY. Generate realistic fake submissions, payments and own-use notifications for load testing.
//
//   npx tsx scripts/seed-fake.ts --count 2000 --own-use 200 [--effective-date 2025-12-01] [--seed 7] --confirm
//
// Every record carries "FAKE DATA" in its remarks/name. Refuses to run with NODE_ENV=production, and
// refuses a database that already has submissions unless --allow-existing is given.
import { PrismaClient, type Prisma } from "@prisma/client";
import { addDays, daysBetween, yearOf } from "../src/domain/dates";
import {
  formatAckNo,
  formatOunNo,
  formatPaymentNo,
  formatRegistrationNo,
} from "../src/domain/numbers";
import { AUTOMATIC_CHECK_IDS } from "../src/domain/evaluation";
import { PAYMENT_EVIDENCE_KEY, formCodeFor, formForCategory } from "../src/domain/forms";
import { priceOwnUse } from "../src/domain/own-use";
import { priceSubmission } from "../src/domain/pricing";
import type { Activity } from "../src/domain/reference";
import { appToday } from "../src/server/clock";
import { hashPassword } from "../src/server/password";
import { fromIsoDate, loadReferenceData, loadSettings } from "../src/server/reference-data";
import { pricingToColumns } from "../src/server/submissions";

export const FAKE_MARK = "FAKE DATA";

// --- Deterministic randomness, so runs are reproducible ----------------------------------------
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLACES = [
  "Ogun",
  "Remo",
  "Egba",
  "Ijebu",
  "Yewa",
  "Awori",
  "Ota",
  "Sagamu",
  "Abeokuta",
  "Ifo",
  "Agbara",
  "Ewekoro",
  "Odeda",
  "Ilaro",
  "Itori",
  "Mowe",
  "Ibafo",
  "Sango",
  "Owode",
  "Ikenne",
];
const NOUNS = [
  "Power",
  "Energy",
  "Solar",
  "Grid",
  "Electric",
  "Utilities",
  "Renewables",
  "Light",
  "Mini-Grid",
  "Gas Power",
  "Networks",
  "Hydro",
  "Metering",
  "Distribution",
];
const SUFFIX = [
  "Ltd",
  "Limited",
  "Nigeria Ltd",
  "Services Ltd",
  "Company Ltd",
  "Cooperative",
  "Partners",
];
const LGA_WEIGHTS: Record<string, number> = {
  "Ado-Odo/Ota": 18,
  Ifo: 12,
  Sagamu: 9,
  "Obafemi Owode": 9,
  "Abeokuta South": 7,
  "Abeokuta North": 5,
  Ewekoro: 5,
  "Ijebu Ode": 5,
};
const ACTIVITY_WEIGHTS: Record<string, number> = {
  MGD: 25,
  GEN: 20,
  CPT: 15,
  EST: 10,
  SUP: 5,
  DIS: 5,
  IDN: 5,
  TRD: 3,
  FRN: 3,
  MET: 3,
  OTH: 3,
  MSL: 2,
  SDC: 0.5,
  INT: 0.5,
};
const CAPACITY: Record<string, [number, number] | null> = {
  GEN: [0.2, 25],
  CPT: [1, 30],
  MGD: [0.05, 3],
  OTH: [0.1, 15],
  EST: [0.5, 8],
  INT: [20, 120],
  SDC: [50, 400],
};
const LICENCE_WEIGHTS: Record<string, number> = {
  "NERC registration/permit (mini-grid/captive)": 30,
  "OGSERC licence/permit": 15,
  "NERC licence (wholly in Ogun)": 10,
  "NERC licence (multi-State)": 4,
  "Licence application pending": 15,
  Unlicensed: 26,
};
const STATUS_WEIGHTS = {
  REGISTERED: 45,
  AWAITING_PAYMENT: 8,
  RECEIVED: 17,
  DEFICIENCY: 10,
  PROVISIONAL: 5,
  LAPSED: 5,
  REFUSED: 3,
  CANCELLED: 2,
} as const;
type FakeStatus = keyof typeof STATUS_WEIGHTS;

export interface FakeOptions {
  count: number;
  ownUse: number;
  seed: number;
  /** Optional new Effective Date for the target DB (the timeline runs from it to today). */
  effectiveDate?: string;
  allowExisting?: boolean;
}

export async function generateFakeData(db: PrismaClient, opts: FakeOptions) {
  if (process.env.NODE_ENV === "production") throw new Error("seed-fake is for development only.");
  const existing = await db.submission.count();
  if (existing && !opts.allowExisting) {
    throw new Error(
      `The database already has ${existing} submissions. Use --allow-existing to add to them.`,
    );
  }
  const rand = rng(opts.seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const weighted = (weights: Record<string, number>, fallback: readonly string[] = []) => {
    const entries = [
      ...Object.entries(weights),
      ...fallback.filter((f) => !(f in weights)).map((f) => [f, 1] as const),
    ];
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let x = rand() * total;
    for (const [k, w] of entries) if ((x -= w) <= 0) return k;
    return entries[entries.length - 1]![0];
  };
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const chance = (p: number) => rand() < p;

  if (opts.effectiveDate) {
    await db.settings.update({
      where: { id: 1 },
      data: { effectiveDate: fromIsoDate(opts.effectiveDate) },
    });
  }
  const today = appToday();
  const [ref, settings, lgas] = await Promise.all([
    loadReferenceData(db),
    loadSettings(db),
    db.lga.findMany({ select: { name: true } }),
  ]);
  if (settings.effectiveDate > today)
    throw new Error("The Effective Date is after today; pass --effective-date.");
  const span = Math.max(1, daysBetween(settings.effectiveDate, today));
  const deadline = addDays(settings.effectiveDate, settings.registrationPeriodDays);
  const byCode = new Map(ref.activities.map((a) => [a.code, a]));

  // Fake staff, so officers and creators are real users.
  const staffSpec = [
    ["Fake Registry", "REGISTRY_OFFICER"],
    ["Fake Finance", "FINANCE_OFFICER"],
    // A second Finance officer confirms what the first records (separation of duties, §4.12).
    ["Fake Finance Confirmer", "FINANCE_OFFICER"],
    ["Fake Evaluator A", "EVALUATING_OFFICER"],
    ["Fake Evaluator B", "EVALUATING_OFFICER"],
    ["Fake Supervisor", "REVIEWING_SUPERVISOR"],
    ["Fake Approver", "APPROVING_OFFICER"],
  ] as const;
  const passwordHash = await hashPassword(`fake-${opts.seed}-not-for-login`);
  const staff: Record<string, string> = {};
  for (const [name, role] of staffSpec) {
    const email = `${name.toLowerCase().replaceAll(" ", ".")}@fake.ogserc.test`;
    const u = await db.user.upsert({
      where: { email },
      update: {},
      create: { name, email, roles: [role], passwordHash, active: false },
    });
    staff[name] = u.id;
  }

  const counters = await db.counter.findMany();
  const counter = Object.fromEntries(counters.map((c) => [c.name, c.value]));
  let ackSeq = counter.ACK ?? 0;
  let paySeq = counter.PAY ?? 0;
  let ounSeq = counter.OUN ?? 0;
  const regSeq: Record<number, number> = {};

  // Submission date: a rush in the weeks before the registration deadline, then a steady trickle.
  const submittedOn = () => {
    const rush = Math.min(span, daysBetween(settings.effectiveDate, deadline) + 10);
    const offset = chance(0.6) ? Math.floor(rand() ** 0.6 * rush) : Math.floor(rand() * span);
    return addDays(settings.effectiveDate, Math.min(offset, span));
  };

  type Row = {
    submission: Prisma.SubmissionCreateManyInput;
    evaluation: Omit<Prisma.EvaluationCreateManyInput, "submissionId">;
    documents: { documentKey: string; value: "Y" | "N" | "NA" }[];
    otherActivityCode: string | null;
    licence: Omit<Prisma.SubmissionLicenceCreateManyInput, "submissionId"> | null;
    payments: Omit<Prisma.PaymentCreateManyInput, "submissionId">[];
    notice: Omit<Prisma.DeficiencyNoticeCreateManyInput, "submissionId"> | null;
  };
  const rows: Row[] = [];
  const usedCac = new Set<string>();

  for (let i = 0; i < opts.count; i++) {
    const code = weighted(ACTIVITY_WEIGHTS);
    const activity = byCode.get(code) as Activity;
    const cap = CAPACITY[code];
    const capacity = cap
      ? Math.round(between(cap[0], cap[1]) * 100) / 100
      : chance(0.5)
        ? Math.round(between(0.1, 5) * 100) / 100
        : null;
    const secondary = chance(0.1) ? pick(ref.activities.filter((a) => a.code !== code)) : null;
    const operating = chance(0.85);
    const dateSubmitted = submittedOn();
    const plannedStart = operating ? null : addDays(dateSubmitted, Math.floor(between(20, 200)));
    const licenceStatus = weighted(LICENCE_WEIGHTS);
    const held = !["Unlicensed", "Licence application pending"].includes(licenceStatus);
    const age = daysBetween(dateSubmitted, today);

    // Older submissions are further along.
    let status = weighted(STATUS_WEIGHTS) as FakeStatus;
    if (
      age < 20 &&
      ["REGISTERED", "LAPSED", "REFUSED", "CANCELLED", "PROVISIONAL"].includes(status)
    )
      status = "RECEIVED";
    if (age < 16 && status === "DEFICIENCY") status = "RECEIVED";

    const pricingInput = {
      filingType: "NEW" as const,
      primaryActivity: activity.name,
      otherActivities: secondary ? [secondary.name] : [],
      installedCapacityMw: capacity,
      categoryOverride: null,
      operatingOnEffectiveDate: operating ? ("Y" as const) : ("N" as const),
      plannedStartDate: plannedStart,
    };
    const pricing = priceSubmission(pricingInput, ref, settings)!;
    const daysLate = pricing.deadline
      ? Math.max(0, daysBetween(pricing.deadline, dateSubmitted))
      : 0;
    const late =
      daysLate > 0
        ? pricing.lateInitial + Math.min(pricing.lateDaily * daysLate, pricing.lateDailyCap)
        : 0;
    const waiver = chance(0.03) ? Math.round(pricing.registrationFee * 0.2) : 0;
    const netFee = Math.max(0, pricing.registrationFee - waiver);
    const due = netFee + late;
    // Finance gate (§4.12): every status but these went through release for evaluation.
    const awaiting = status === "AWAITING_PAYMENT";
    const released = !awaiting && !["REFUSED", "CANCELLED"].includes(status);

    ackSeq++;
    const ackNo = formatAckNo(settings.ackPrefix, dateSubmitted, ackSeq);
    let cac = `RC${Math.floor(between(100_000, 1_999_999))}`;
    if (usedCac.size > 0 && chance(0.005)) cac = pick([...usedCac]); // ~0.5% duplicate CAC numbers, to exercise the flag
    usedCac.add(cac);

    const name = `${pick(PLACES)} ${pick(NOUNS)} ${pick(SUFFIX)}`;
    const lga = weighted(
      LGA_WEIGHTS,
      lgas.map((l) => l.name),
    );
    const complete =
      ["REGISTERED", "PROVISIONAL"].includes(status) || (status === "RECEIVED" && chance(0.4));
    const completeOn = complete
      ? addDays(dateSubmitted, Math.floor(between(1, Math.max(2, Math.min(age, 25)))))
      : null;
    const certificateOn =
      status === "REGISTERED" || status === "CANCELLED"
        ? addDays(completeOn ?? addDays(dateSubmitted, 10), Math.floor(between(3, 28)))
        : null;
    const clampToday = (d: string | null) => (d && d > today ? today : d);
    const noticeOn = ["DEFICIENCY", "LAPSED"].includes(status)
      ? addDays(dateSubmitted, Math.floor(between(3, 12)))
      : null;

    let registrationNo: string | null = null;
    const certDate = clampToday(certificateOn);
    if (certDate && (status === "REGISTERED" || (status === "CANCELLED" && chance(0.5)))) {
      const y = yearOf(certDate);
      regSeq[y] = (regSeq[y] ?? counter[`REG:${y}`] ?? 0) + 1;
      registrationNo = formatRegistrationNo(
        settings.registrationPrefix,
        certDate,
        pricing.category,
        code,
        regSeq[y]!,
      );
    }

    // Payments: what each kind of record typically has received. Released records were confirmed
    // for at least fee − waiver (the gate); some still owe their late charge.
    const paid =
      status === "REGISTERED" || status === "PROVISIONAL"
        ? chance(0.05)
          ? due + Math.round(between(1, 5)) * 1_000_000
          : due
        : released
          ? chance(0.7)
            ? due
            : netFee
          : awaiting
            ? chance(0.5)
              ? due
              : chance(0.4)
                ? Math.round(due * between(0.2, 0.8))
                : 0
            : chance(0.15)
              ? Math.round(due * 0.5)
              : 0;
    const payments: Row["payments"] = [];
    const naira = (kobo: number) => Math.round(kobo / 100) * 100;
    const parts = paid > 0 ? (chance(0.25) ? 2 : 1) : 0;
    for (let p = 0; p < parts; p++) {
      const half = naira(paid / 2);
      const amount = parts === 2 ? (p === 0 ? half : naira(paid) - half) : naira(paid);
      if (amount <= 0) continue;
      const received = clampToday(addDays(dateSubmitted, Math.floor(between(0, 30))))!;
      const reversed = chance(0.03);
      paySeq++;
      payments.push({
        paymentSeq: paySeq,
        paymentNo: formatPaymentNo(settings.paymentPrefix, received, paySeq),
        dateReceived: fromIsoDate(received),
        reference: ackNo,
        purpose: "Registration fee",
        channel: pick(["Remita", "Remita", "Bank transfer", "POS"]),
        amount: BigInt(amount),
        rrr: `RRR${Math.floor(between(1e11, 9e11))}`,
        // Awaiting payment: still with Finance. Otherwise confirmed by the second Finance officer.
        ...(awaiting
          ? { verifiedWithBank: false, verifiedById: null }
          : {
              verifiedWithBank: true,
              verifiedById: staff["Fake Finance Confirmer"]!,
              verifiedAt: fromIsoDate(received),
              financeStatus: "CONFIRMED" as const,
              financeDecidedById: staff["Fake Finance Confirmer"]!,
              financeDecidedAt: fromIsoDate(received),
            }),
        status: reversed ? "REVERSED" : "ACTIVE",
        reversalReason: reversed ? "FAKE DATA: posted twice" : null,
        reversedById: reversed ? staff["Fake Finance"] : null,
        reversedAt: reversed ? new Date() : null,
        recordedById: staff["Fake Finance"]!,
      });
      if (reversed) {
        // The real payment, recorded again.
        paySeq++;
        payments.push({
          ...payments[payments.length - 1]!,
          paymentSeq: paySeq,
          paymentNo: formatPaymentNo(settings.paymentPrefix, received, paySeq),
          status: "ACTIVE",
          reversalReason: null,
          reversedById: null,
          reversedAt: null,
        });
      }
    }

    const docsComplete = complete || chance(0.3);
    // The form for the category charged; evidence of payment ticks itself from confirmed payments.
    const form = formForCategory(pricing.category, ref.forms)!;
    const documents = form.documents
      .filter((d) => d.key !== PAYMENT_EVIDENCE_KEY)
      .map((d) => ({
        documentKey: d.key,
        value: (d.requiredWhen && chance(0.5)
          ? "NA"
          : docsComplete
            ? "Y"
            : chance(0.7)
              ? "Y"
              : chance(0.5)
                ? "N"
                : null) as "Y" | "N" | "NA" | null,
      }))
      .filter((d): d is { documentKey: string; value: "Y" | "N" | "NA" } => d.value !== null);

    const assigned = awaiting ? chance(0.3) : status !== "RECEIVED" || chance(0.6);
    const releasedOn = released
      ? clampToday(addDays(dateSubmitted, Math.floor(between(0, Math.max(1, Math.min(age, 10))))))
      : null;
    const decision =
      status === "REGISTERED" || (status === "CANCELLED" && registrationNo)
        ? "REGISTER"
        : status === "LAPSED"
          ? "LAPSE"
          : status === "REFUSED"
            ? "REFUSE"
            : null;

    rows.push({
      submission: {
        ackSeq,
        ackNo,
        registeredName:
          chance(0.002) && rows.length ? rows[rows.length - 1]!.submission.registeredName : name,
        dateSubmitted: fromIsoDate(dateSubmitted),
        submissionChannel: pick(["By hand", "Email", "Online portal"]),
        registrantType: chance(0.9)
          ? "Company"
          : pick(["Cooperative", "Partnership", "Public Body"]),
        cacNo: cac,
        address: `${Math.floor(between(1, 200))} ${pick(PLACES)} Road, ${lga}`,
        principalLga: lga,
        otherAreasServed: chance(0.2) ? pick(lgas).name : null,
        formFiled: formCodeFor(pricing.category),
        primaryActivityCode: code,
        installedCapacityMw: capacity,
        customers: Math.floor(between(0, 20_000)),
        licenceStatus,
        holdsAnyLicence: held,
        multiStateLicensee: licenceStatus === "NERC licence (multi-State)",
        complianceOfficer: "Fake Compliance Officer",
        phone: `080${Math.floor(between(10_000_000, 99_999_999))}`,
        email: `compliance${i}@fake.example`,
        operatingOnEffectiveDate: operating,
        plannedStartDate: fromIsoDate(plannedStart),
        approvedWaiver: BigInt(waiver),
        status,
        releasedForEvaluationDate: fromIsoDate(releasedOn),
        dateSubmissionComplete: fromIsoDate(clampToday(completeOn)),
        deficiencyNoticeDate: fromIsoDate(noticeOn),
        showCauseDate: status === "REFUSED" ? fromIsoDate(addDays(dateSubmitted, 5)) : null,
        certificateIssueDate: registrationNo ? fromIsoDate(certDate) : null,
        registrationNo,
        remarks: FAKE_MARK,
        createdById: staff["Fake Registry"]!,
        ...pricingToColumns(pricing),
      },
      evaluation: {
        evaluatingOfficerId: assigned
          ? staff[chance(0.5) ? "Fake Evaluator A" : "Fake Evaluator B"]
          : null,
        reviewingSupervisorId: assigned ? staff["Fake Supervisor"] : null,
        approvingOfficerId: assigned ? staff["Fake Approver"] : null,
        // Evaluation starts on release (§4.12).
        dateEvaluationStarted: assigned && releasedOn ? fromIsoDate(releasedOn) : null,
        finalDecision: decision,
        reasons:
          status === "REFUSED"
            ? "False or misleading information"
            : status === "CANCELLED"
              ? `Cancelled: ${FAKE_MARK}`
              : null,
        approvalDate: decision
          ? fromIsoDate(certDate ?? clampToday(addDays(dateSubmitted, 40)))
          : null,
        reviewDate: decision === "REGISTER" ? fromIsoDate(certDate) : null,
      },
      documents,
      otherActivityCode: secondary && secondary.code !== code ? secondary.code : null,
      licence: held
        ? {
            sortOrder: 1,
            type: licenceStatus,
            number: `LIC/${Math.floor(between(1000, 9999))}`,
            expiryDate: chance(0.6)
              ? fromIsoDate(addDays(today, Math.floor(between(-30, 900))))
              : null,
          }
        : null,
      payments,
      notice: noticeOn
        ? {
            seq: 1,
            noticeRef: `OGSERC/DEF/${yearOf(noticeOn)}/${String(ackSeq).padStart(5, "0")}`,
            noticeDate: fromIsoDate(noticeOn),
            responseDue: fromIsoDate(addDays(noticeOn, settings.deficiencyDays)),
            responseReceivedDate: null,
            issuedById: staff["Fake Supervisor"]!,
          }
        : null,
    });
  }

  // Checks an evaluator answers by hand (the automatic ones are computed, never stored).
  const AUTOMATIC = new Set(AUTOMATIC_CHECK_IDS);
  const manualChecks = ref.evaluationChecks
    .map((c) => c.id)
    .filter((id) => !AUTOMATIC.has(id) && !id.startsWith("9."));

  // Insert in chunks; the workflow flag lets status, decisions and workflow dates be set directly.
  const CHUNK = 250;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('ogserc.workflow', 'on', true)`;
        await tx.submission.createMany({ data: chunk.map((r) => r.submission) });
        const ids = await tx.submission.findMany({
          where: { ackNo: { in: chunk.map((r) => r.submission.ackNo) } },
          select: { id: true, ackNo: true },
        });
        const idOf = new Map(ids.map((r) => [r.ackNo, r.id]));
        await tx.evaluation.createMany({
          data: chunk.map((r) => ({
            ...r.evaluation,
            submissionId: idOf.get(r.submission.ackNo)!,
          })),
        });
        // Realistic evaluation answers: decided files fully answered, open ones part-way.
        const evaluations = await tx.evaluation.findMany({
          where: { submissionId: { in: ids.map((i) => i.id) } },
          select: { id: true, submissionId: true },
        });
        const statusOf = new Map(
          chunk.map((r) => [idOf.get(r.submission.ackNo)!, r.submission.status]),
        );
        await tx.evaluationCheckValue.createMany({
          data: evaluations.flatMap((e) => {
            const st = statusOf.get(e.submissionId);
            const n =
              st === "RECEIVED" ? Math.floor(rand() * manualChecks.length) : manualChecks.length;
            return manualChecks.slice(0, n).map((checkId) => ({
              evaluationId: e.id,
              checkId,
              value: st === "DEFICIENCY" && rand() < 0.1 ? ("N" as const) : ("Y" as const),
            }));
          }),
        });
        await tx.documentChecklistItem.createMany({
          data: chunk.flatMap((r) =>
            r.documents.map((d) => ({ ...d, submissionId: idOf.get(r.submission.ackNo)! })),
          ),
        });
        await tx.payment.createMany({
          data: chunk.flatMap((r) =>
            r.payments.map((p) => ({ ...p, submissionId: idOf.get(r.submission.ackNo)! })),
          ),
        });
        await tx.submissionActivity.createMany({
          data: chunk.flatMap((r) =>
            r.otherActivityCode
              ? [
                  {
                    submissionId: idOf.get(r.submission.ackNo)!,
                    activityCode: r.otherActivityCode,
                    sortOrder: 1,
                  },
                ]
              : [],
          ),
        });
        await tx.submissionLicence.createMany({
          data: chunk.flatMap((r) =>
            r.licence ? [{ ...r.licence, submissionId: idOf.get(r.submission.ackNo)! }] : [],
          ),
        });
        await tx.deficiencyNotice.createMany({
          data: chunk.flatMap((r) =>
            r.notice ? [{ ...r.notice, submissionId: idOf.get(r.submission.ackNo)! }] : [],
          ),
        });
      },
      { timeout: 120_000 },
    );
  }

  // Own-use notifications with their Category I fee and payments.
  for (let i = 0; i < opts.ownUse; i++) {
    const kw = Math.round(between(150, 990));
    const dateFiled = addDays(settings.effectiveDate, Math.floor(rand() * span));
    const pricing = priceOwnUse(kw, ref, settings);
    ounSeq++;
    const ounNo = formatOunNo(settings.ounPrefix, dateFiled, ounSeq);
    const oun = await db.ownUseNotification.create({
      data: {
        ounSeq,
        ounNo,
        name: `${pick(PLACES)} ${pick(["Foods", "Plastics", "Steel", "Textiles", "Bottling", "Packaging"])} ${FAKE_MARK}`,
        dateFiled: fromIsoDate(dateFiled),
        lga: weighted(
          LGA_WEIGHTS,
          lgas.map((l) => l.name),
        ),
        siteAddress: `Plot ${Math.floor(between(1, 400))}, ${pick(PLACES)} Industrial Estate`,
        units: {
          create: [
            {
              sortOrder: 1,
              makeModel: "Fake generator",
              capacityKw: kw,
              fuel: pick(["Gas", "Diesel", "Solar PV", "Hybrid"]),
            },
          ],
        },
        pricedFee: BigInt(pricing.fee),
        pricedThresholdKw: pricing.thresholdKw,
        createdById: staff["Fake Registry"]!,
      },
    });
    if (pricing.fee > 0 && chance(0.7)) {
      paySeq++;
      await db.payment.create({
        data: {
          paymentSeq: paySeq,
          paymentNo: formatPaymentNo(settings.paymentPrefix, dateFiled, paySeq),
          dateReceived: fromIsoDate(dateFiled),
          reference: ounNo,
          ownUseNotificationId: oun.id,
          amount: BigInt(chance(0.05) ? pricing.fee * 2 : pricing.fee),
          channel: "Remita",
          recordedById: staff["Fake Finance"]!,
          ...(chance(0.85) && {
            verifiedWithBank: true,
            verifiedById: staff["Fake Finance Confirmer"]!,
            verifiedAt: fromIsoDate(dateFiled),
            financeStatus: "CONFIRMED" as const,
            financeDecidedById: staff["Fake Finance Confirmer"]!,
            financeDecidedAt: fromIsoDate(dateFiled),
          }),
        },
      });
    }
  }

  // Keep the counters ahead of what was generated.
  const set = async (name: string, value: number) =>
    db.counter.upsert({ where: { name }, update: { value }, create: { name, value } });
  await set("ACK", ackSeq);
  await set("PAY", paySeq);
  await set("OUN", ounSeq);
  for (const [y, v] of Object.entries(regSeq)) await set(`REG:${y}`, v);
  await db.auditLog.create({
    data: {
      action: "Fake data generated",
      detail: `${opts.count} submissions, ${opts.ownUse} own-use notifications (seed ${opts.seed}). ${FAKE_MARK}.`,
    },
  });
  return { submissions: opts.count, ownUse: opts.ownUse, payments: paySeq - (counter.PAY ?? 0) };
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string, fallback?: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : fallback;
  };
  if (!args.includes("--confirm")) {
    console.error(
      "This writes fake records to the database in DATABASE_URL. Re-run with --confirm.",
    );
    process.exit(1);
  }
  const db = new PrismaClient();
  const started = Date.now();
  const result = await generateFakeData(db, {
    count: Number(arg("count", "2000")),
    ownUse: Number(arg("own-use", "200")),
    seed: Number(arg("seed", "7")),
    effectiveDate: arg("effective-date"),
    allowExisting: args.includes("--allow-existing"),
  });
  console.log(
    `Generated ${JSON.stringify(result)} in ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
  await db.$disconnect();
}

const isMain = process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/seed-fake.ts");
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
