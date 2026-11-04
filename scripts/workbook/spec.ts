// Workbook spec for exports/OGSERC_Registration_and_Evaluation_System_v2.xlsm.
//
// Every calculated column is an Excel formula that mirrors a function in src/domain/ (named in the
// comment beside it). The PowerShell builder (build-workbook.ps1) lays this spec out through Excel
// COM; verify-workbook.ps1 then checks the formulas against the domain functions (fixtures.ts).
// Change a rule in src/domain/ → change it here → `npm run export:workbook`.

import formsFile from "../../registration-forms.json";
import seed from "../../seed-data.json";
import { CONDITION_KEYS, CONDITION_LABELS, PAYMENT_EVIDENCE_KEY } from "../../src/domain/forms";
import { DEFAULT_POLICY, settingsFromSeed, type Settings } from "../../src/domain/reference";
import { FILING_LABELS, FINAL_DECISION, STATUS, STATUSES } from "../../src/domain/types";
import { REFUSAL_GROUNDS } from "../../src/domain/workflow";

// ---------------------------------------------------------------------------------------------
// Spec types (read by build-workbook.ps1)

export type Kind = "input" | "macro" | "calc" | "data";

export interface ColumnSpec {
  name: string;
  kind: Kind;
  /** Excel formula (en-US, structured references) for calc columns. */
  f?: string;
  width?: number;
  fmt?: string;
  /** Data-validation list source, e.g. "=lstLGA". */
  list?: string;
  /** Input message shown when the cell is selected. */
  help?: string;
  wrap?: boolean;
  hidden?: boolean;
}

export interface TableSpec {
  name: string;
  /** Header cell of the first column, e.g. "A6". */
  anchor: string;
  columns: ColumnSpec[];
  rows?: (string | number | null)[][];
  /** Group titles over the header row (row above the anchor). */
  groups?: { title: string; from: string; to: string }[];
  /** Extra rows above the header (e.g. check texts): offset 1 = directly above, after groups. */
  aboveHeader?: { offset: number; values: Record<string, string>; height?: number }[];
  style?: string;
  /** Rows formatted, validated and unlocked for input below the header. */
  capacity?: number;
}

export interface CellSpec {
  addr: string;
  value?: string | number | null;
  /** Formula (Formula2, so dynamic arrays spill). */
  f?: string;
  bold?: boolean;
  size?: number;
  color?: string;
  fill?: string;
  fmt?: string;
  wrap?: boolean;
  merge?: string;
  italic?: boolean;
  name?: string;
  list?: string;
  input?: boolean;
  align?: "left" | "center" | "right";
}

export interface CfSpec {
  /** A1 range, or "tblName[Column]" for a whole table column (rows up to capacity). */
  range: string;
  formula: string;
  fill?: string;
  font?: string;
  bold?: boolean;
}

export interface ButtonSpec {
  cell: string;
  caption: string;
  macro: string;
  width?: number;
}

export interface SheetSpec {
  name: string;
  tab: string;
  cells?: CellSpec[];
  widths?: Record<string, number>;
  tables?: TableSpec[];
  cf?: CfSpec[];
  buttons?: ButtonSpec[];
  freeze?: string;
  protect?: boolean;
  zoom?: number;
  gridlines?: boolean;
}

export interface WorkbookSpec {
  title: string;
  password: string;
  colours: Record<string, string>;
  sheets: SheetSpec[];
  /** Workbook-level names defined by formula. */
  names: { name: string; refersTo: string }[];
  /** Settings cells by name, with their default values (verify-workbook resets them). */
  settingsDefaults: Record<string, string | number | null>;
}

// ---------------------------------------------------------------------------------------------
// Formula helpers

const R = (c: string) => `[@[${c}]]`;
const T = (t: string, c: string) => `${t}[[${c}]]`;
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
/** "22 October 2026" (src/domain/dates.ts formatDate); month names from a list, not the locale. */
const FD = (d: string) => `(DAY(${d})&" "&INDEX(lstMonths,MONTH(${d}))&" "&YEAR(${d}))`;
/** "₦2,800,000" or "₦1,234.50" (src/domain/money.ts formatNaira); amounts are naira. */
const NAIRA = (x: string) =>
  // No LET here: Excel refuses some formulas with LET nested inside LET in a new, unsaved workbook.
  `(IF(${x}<0,"-","")&"₦"&TEXT(INT(ROUND(ABS(${x})*100,0)/100),"#,##0")&IF(MOD(ROUND(ABS(${x})*100,0),100)>0,"."&TEXT(MOD(ROUND(ABS(${x})*100,0),100),"00"),""))`;
const yes = (cond: string) => `IF(${cond},"Yes","No")`;
const isYes = (c: string) => `(${R(c)}="Yes")`;
/** JavaScript-style trim (ends only), unlike Excel TRIM which also squeezes inner spaces. */
const JSTRIM = (x: string) =>
  `LET(_s,${x}&"",_n,LEN(_s),IF(_n=0,"",LET(_c,MID(_s,SEQUENCE(_n),1),_k,_c<>" ",IF(OR(_k),MID(_s,XMATCH(TRUE,_k),XMATCH(TRUE,_k,0,-1)-XMATCH(TRUE,_k)+1),""))))`;

const S = STATUS;
const CLOSED = [S.REGISTERED, S.REFUSED, S.LAPSED, S.CANCELLED, S.APPLIED];
const PAST_ACK = [S.RECEIVED, S.DEFICIENCY, S.PROVISIONAL, S.REGISTERED, S.LAPSED, S.APPLIED];
const statusIn = (st: string, list: readonly string[]) =>
  `OR(${list.map((s) => `${st}=${q(s)}`).join(",")})`;
const WRONG_FORM = { ACCEPT: "Accept and re-categorise", REQUIRE: "Require the correct form" };

const FMT = {
  date: "dd-mmm-yyyy",
  datetime: "dd-mmm-yyyy hh:mm",
  money: '"₦"#,##0.00;-"₦"#,##0.00;"₦"0',
  int: "0",
  num: "0.###",
  pct: "0.0%",
  text: "@",
};

// ---------------------------------------------------------------------------------------------
// Reference data

const settings: Settings = settingsFromSeed(seed);
const decisionChecks = seed.evaluation_checks.filter((c) => !c.id.startsWith("9."));
const postChecks = seed.evaluation_checks.filter((c) => c.id.startsWith("9."));
{
  const ids = seed.evaluation_checks.map((c) => c.id);
  const firstPost = ids.findIndex((id) => id.startsWith("9."));
  if (ids.slice(firstPost).some((id) => !id.startsWith("9.")))
    throw new Error("Post-approval checks (9.x) must come after the decision checks");
}
const DEC_FIRST = decisionChecks[0]!.id;
const DEC_LAST = decisionChecks.at(-1)!.id;
const POST_FIRST = postChecks[0]!.id;
const POST_LAST = postChecks.at(-1)!.id;

/** Register columns holding the nine document conditions, in CONDITION_KEYS order. */
const CONDITION_COLUMNS: Record<(typeof CONDITION_KEYS)[number], string> = {
  holds_any_licence: "Holds Any Licence",
  multi_state_licensee: "Multi-State Licensee",
  generation_for_sale: "Generation for Sale",
  grid_connected: "Grid Connected",
  interconnected_minigrid: "Interconnected Mini-grid",
  f_distribution: "Form F Part 1 (Distribution)",
  f_trading: "Form F Part 2 (Trading)",
  g_disco_bulk_supply: "DisCo Bulk Supply",
  sub_franchise: "Sub-franchisee",
};
export { CONDITION_COLUMNS };
const FIRST_COND = CONDITION_COLUMNS.holds_any_licence;
const LAST_COND = CONDITION_COLUMNS.sub_franchise;

// ---------------------------------------------------------------------------------------------
// Settings sheet

interface SettingRow {
  name: string;
  label: string;
  value: string | number | null;
  note: string;
  fmt?: string;
  list?: string;
  /** Calculated, not entered. */
  f?: string;
  section?: string;
}

const yn = (b: boolean) => (b ? "Y" : "N");
const SETTINGS_ROWS: SettingRow[] = [
  { section: "Order parameters (SPEC §1.7)", name: "", label: "", value: null, note: "" },
  {
    name: "cfgEffectiveDate",
    label: "Effective Date of the Order",
    value: settings.effectiveDate,
    fmt: FMT.date,
    note: "PLACEHOLDER (22 Oct 2026): replace with the gazetted Effective Date (para 2). Every deadline depends on it.",
  },
  { name: "cfgRegPeriodDays", label: "Registration period (days)", value: settings.registrationPeriodDays, note: "Para 11(1)." },
  { name: "cfgExtensionDays", label: "Extension of registration period (days)", value: settings.extensionDays, note: "Para 25: any extension granted by public notice." },
  {
    name: "cfgExistingDeadline",
    label: "Registration deadline (existing operators)",
    value: null,
    f: "=cfgEffectiveDate+cfgRegPeriodDays+cfgExtensionDays",
    fmt: FMT.date,
    note: "Calculated: Effective Date + period + extension.",
  },
  { name: "cfgNewOpLeadDays", label: "New operators: register at least (days) before start", value: settings.newOperatorLeadDays, note: "Para 11(2)." },
  { name: "cfgDeterminationDays", label: "Determination period (days)", value: settings.determinationDays, note: "Para 13(1); provisional registration after this (para 13(4))." },
  { name: "cfgDeficiencyDays", label: "Deficiency response period (days)", value: settings.deficiencyDays, note: "Para 13(1)(b)." },
  { name: "cfgLicenceAppDays", label: "Unlicensed: licence application within (days)", value: settings.licenceApplicationDays, note: "Para 18(1)." },
  { name: "cfgExpiryWindowDays", label: "Licence expiry window for the renewal flag (days)", value: settings.licenceExpiryWindowDays, note: "Para 8(5): six months." },
  { name: "cfgAmberDays", label: "Amber warning: days before determination due", value: settings.amberWarningDays, note: "Traffic light." },
  { name: "cfgOwnUseThresholdKw", label: "Own-use notification threshold (kW)", value: settings.ownUseThresholdKw, note: "Para 3(4): 200 kW to below 1 MW." },
  { name: "cfgShowCauseDays", label: "Show-cause period before refusal (days)", value: settings.showCauseDays, note: "Para 20." },
  { name: "cfgAnnualDueMonth", label: "Annual confirmation due: month (1–12)", value: 1, note: "Para 16(2): 31 January." },
  { name: "cfgAnnualDueDay", label: "Annual confirmation due: day", value: 31, note: "" },
  { name: "cfgFeesRevisedOn", label: "Fees revised on", value: null, fmt: FMT.date, note: "Set once (SPEC §8.9)." },
  { section: "Numbers and signatories", name: "", label: "", value: null, note: "" },
  { name: "cfgRegPrefix", label: "Registration number prefix", value: settings.registrationPrefix, note: "PREFIX/YEAR/CATEGORY-ACTIVITY/SERIAL." },
  { name: "cfgAckPrefix", label: "Acknowledgement number prefix", value: settings.ackPrefix, note: "Para 10(3)." },
  { name: "cfgOunPrefix", label: "Own-use notification number prefix", value: settings.ounPrefix, note: "Para 3(4)." },
  { name: "cfgPayPrefix", label: "Payment record prefix", value: settings.paymentPrefix, note: "" },
  { name: "cfgDefPrefix", label: "Deficiency notice prefix", value: "OGSERC/DEF", note: "OGSERC/DEF/{year}/{ack serial}." },
  { name: "cfgChairName", label: "Signatory: Chairman / Chief Executive Officer", value: settings.chairmanName, note: "Approval of a new registration is blocked while this is [Name] or empty." },
  { name: "cfgCommName", label: "Signatory: Commissioner", value: settings.commissionerName, note: "As above." },
  { section: "Policy settings (undecided by the Commission; SPEC §1.7, §9)", name: "", label: "", value: null, note: "" },
  { name: "cfgLateBlocksComplete", label: "Unpaid late charge blocks “submission complete”", value: yn(DEFAULT_POLICY.lateChargeBlocksCompleteness), list: "=lstYN", note: "§9.2. The Excel said no." },
  { name: "cfgWaiverOnLate", label: "Waiver also reduces the late charge", value: yn(DEFAULT_POLICY.waiverAppliesToLateCharge), list: "=lstYN", note: "§9.3. The Excel said no." },
  { name: "cfgFlagsBlockApproval", label: "Unresolved data flags block approval outright", value: yn(DEFAULT_POLICY.flagsBlockApproval), list: "=lstYN", note: "§9.5. N = an approver may override with a written reason. (The live app has this on.)" },
  { name: "cfgLateRequiredForRelease", label: "Late charge required to release for evaluation", value: yn(DEFAULT_POLICY.lateChargeRequiredForRelease), list: "=lstYN", note: "§4.12 Finance gate." },
  { name: "cfgUnpaidReminderDays", label: "Unpaid acknowledgement reminder after (days)", value: DEFAULT_POLICY.unpaidReminderDays, note: "Blank = no reminder. Nothing is sent." },
  { name: "cfgSupplyRetailCat", label: "Supply / retail category at 1 MW or more", value: DEFAULT_POLICY.supplyRetailCategory1MwPlus, list: "=lstCategoriesNoI", note: "Default K." },
  { name: "cfgWrongForm", label: "Wrong form handling", value: WRONG_FORM.ACCEPT, list: "=lstWrongForm", note: "§4.13." },
  { name: "cfgOtherActivityDocs", label: "Other activities require their form's documents", value: yn(DEFAULT_POLICY.otherActivitiesRequireDocuments), list: "=lstYN", note: "§2.6." },
  { name: "cfgOwnUseCertificate", label: "Own-use gets a certificate", value: yn(DEFAULT_POLICY.ownUseCertificate), list: "=lstYN", note: "§4.15." },
  { name: "cfgFilingFeeOnUpdates", label: "Registration fee on updates and annual confirmations", value: yn(DEFAULT_POLICY.filingFeeOnUpdates), list: "=lstYN", note: "§2.5." },
  { section: "Workbook", name: "", label: "", value: null, note: "" },
  { name: "cfgTodayOverride", label: "Today override (testing only)", value: null, fmt: FMT.date, note: "Leave blank. When set, every “today” in the workbook uses this date (like the app's APP_TODAY)." },
  { name: "cfgNextAck", label: "Next acknowledgement serial", value: 1, note: "Set by the Save buttons. One global sequence. Never edit or reuse." },
  { name: "cfgNextPay", label: "Next payment serial", value: 1, note: "As above." },
  { name: "cfgNextOun", label: "Next own-use serial", value: 1, note: "As above." },
  { name: "cfgLastReview", label: "Daily review last run", value: null, fmt: FMT.datetime, note: "Set by the Daily review button." },
  { name: "cfgRulesVersion", label: "Rules version (git commit of src/domain)", value: null, note: "Set when the workbook is built." },
  { name: "cfgBuiltOn", label: "Built on", value: null, fmt: FMT.datetime, note: "Set when the workbook is built." },
];

function settingsSheet(): SheetSpec {
  const cells: CellSpec[] = [
    { addr: "A1", value: "Settings", bold: true, size: 16, color: "brand" },
    {
      addr: "A2",
      value:
        "Blue cells are inputs. Every change is written to the Audit Log. The fee table and activity map are on the Lists sheet.",
      italic: true,
    },
    { addr: "A4", value: "Parameter", bold: true, fill: "header" },
    { addr: "B4", value: "Value", bold: true, fill: "header" },
    { addr: "C4", value: "Note", bold: true, fill: "header" },
  ];
  let row = 5;
  for (const s of SETTINGS_ROWS) {
    if (s.section) {
      row++;
      cells.push({ addr: `A${row}`, value: s.section, bold: true, color: "brand", size: 12 });
      row++;
      continue;
    }
    cells.push({ addr: `A${row}`, value: s.label });
    cells.push({
      addr: `B${row}`,
      ...(s.f ? { f: s.f } : { value: s.value, input: true }),
      name: s.name,
      fmt: s.fmt,
      list: s.list,
      align: "left",
    });
    cells.push({ addr: `C${row}`, value: s.note, wrap: true, italic: true });
    row++;
  }
  return {
    name: "Settings",
    tab: "brand",
    cells,
    widths: { A: 52, B: 26, C: 90 },
    freeze: "A5",
    protect: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Lists sheet

const SIMPLE_LISTS: { name: string; title: string; values: string[] }[] = [
  { name: "lstFilingType", title: "Filing Type", values: Object.values(FILING_LABELS) },
  { name: "lstStatus", title: "Status", values: [...STATUSES] },
  { name: "lstForms", title: "Form (A–K)", values: formsFile.forms.filter((f) => f.category !== "I").map((f) => f.form) },
  { name: "lstCategories", title: "Category", values: seed.schedule3_fees.map((f) => f.category) },
  { name: "lstCategoriesNoI", title: "Category (not I)", values: seed.schedule3_fees.filter((f) => f.category !== "I").map((f) => f.category) },
  { name: "lstLGA", title: "LGA", values: seed.lgas },
  { name: "lstRegistrantType", title: "Registrant Type", values: seed.registrant_types },
  { name: "lstLicenceStatus", title: "Licence Status", values: seed.licence_statuses },
  { name: "lstSubmissionChannel", title: "Submission Channel", values: seed.submission_channels },
  { name: "lstPaymentChannel", title: "Payment Channel", values: seed.payment_channels },
  { name: "lstPaymentPurpose", title: "Payment Purpose", values: seed.payment_purposes },
  { name: "lstFuel", title: "Fuel / Technology", values: seed.fuel_technologies },
  { name: "lstFinalDecision", title: "Final Decision", values: seed.final_decisions },
  { name: "lstRefusalGrounds", title: "Refusal Ground", values: [...REFUSAL_GROUNDS] },
  { name: "lstYN", title: "Y/N", values: ["Y", "N"] },
  { name: "lstYNNA", title: "Y/N/N/A", values: ["Y", "N", "N/A"] },
  { name: "lstFinanceStatus", title: "Finance Status", values: ["Pending", "Confirmed", "Rejected"] },
  { name: "lstWrongForm", title: "Wrong Form Handling", values: [WRONG_FORM.ACCEPT, WRONG_FORM.REQUIRE] },
  { name: "lstConditionKeys", title: "Condition Key", values: [...CONDITION_KEYS] },
  { name: "lstMonths", title: "Month", values: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] },
  { name: "lstEvaluators", title: "Evaluating Officers", values: ["Evaluating Officer 1"] },
  { name: "lstSupervisors", title: "Reviewing Supervisors", values: ["Reviewing Supervisor 1"] },
  { name: "lstApprovers", title: "Approving Officers", values: ["Approving Officer 1"] },
  { name: "lstActivity", title: "Activity (drop-down)", values: [] },
];

function listsSheet(): SheetSpec {
  const fees: TableSpec = {
    name: "tblFees",
    anchor: "A5",
    columns: [
      { name: "Category", kind: "data", width: 9 },
      { name: "Registration Fee", kind: "data", fmt: FMT.money, width: 15 },
      { name: "Late Initial", kind: "data", fmt: FMT.money, width: 14 },
      { name: "Late Daily", kind: "data", fmt: FMT.money, width: 12 },
      { name: "Late Daily Cap", kind: "data", fmt: FMT.money, width: 15 },
      { name: "Late Tier", kind: "data", width: 8 },
      { name: "Description", kind: "data", width: 60, wrap: true },
    ],
    rows: seed.schedule3_fees.map((f) => [
      f.category,
      f.registration_fee,
      f.late_initial,
      f.late_daily,
      f.late_daily_cap,
      f.late_tier,
      f.description,
    ]),
  };
  const activities: TableSpec = {
    name: "tblActivities",
    anchor: "A19",
    columns: [
      { name: "Activity", kind: "data", width: 50 },
      { name: "Code", kind: "data", width: 7 },
      { name: "Category 10 MW+", kind: "data", width: 10 },
      { name: "Category 1 to 10 MW", kind: "data", width: 10 },
      { name: "Category below 1 MW", kind: "data", width: 10 },
      { name: "Capacity-Based", kind: "data", width: 9 },
    ],
    rows: seed.activities.map((a) => [
      a.name,
      a.code,
      a.cat_10mw_plus,
      a.cat_1_to_10mw,
      a.cat_below_1mw,
      a.capacity_based ? "Y" : "N",
    ]),
  };
  const forms: TableSpec = {
    name: "tblForms",
    anchor: "A37",
    columns: [
      { name: "Form", kind: "data", width: 10 },
      { name: "Category", kind: "data", width: 9 },
      { name: "Title", kind: "data", width: 50 },
      { name: "Para", kind: "data", width: 12 },
      {
        name: "Documents",
        kind: "calc",
        f: `=COUNTIFS(${T("tblFormDocs", "Form")},${R("Form")})`,
        width: 10,
      },
    ],
    rows: formsFile.forms.map((f) => [f.form, f.category, f.title, f.para, null]),
  };
  const conditions: TableSpec = {
    name: "tblConditions",
    anchor: "A52",
    columns: [
      { name: "Condition", kind: "data", width: 24 },
      { name: "Register Column", kind: "data", width: 28 },
      { name: "Question", kind: "data", width: 50 },
    ],
    rows: CONDITION_KEYS.map((k) => [k, CONDITION_COLUMNS[k], CONDITION_LABELS[k]]),
  };
  const docRows: (string | number | null)[][] = [];
  for (const f of formsFile.forms) {
    f.documents.forEach((d, i) => {
      docRows.push([f.form, i + 1, d.key, d.text, (d as { required_when?: string }).required_when ?? null, null]);
    });
  }
  const formDocs: TableSpec = {
    name: "tblFormDocs",
    anchor: "I5",
    columns: [
      { name: "Form", kind: "data", width: 10 },
      { name: "No.", kind: "data", width: 5 },
      { name: "Key", kind: "data", width: 24 },
      { name: "Document", kind: "data", width: 60, wrap: true },
      { name: "Required When", kind: "data", width: 22 },
      { name: "Form Key", kind: "calc", f: `=${R("Form")}&"|"&${R("Key")}`, width: 30 },
    ],
    rows: docRows,
  };
  const checks: TableSpec = {
    name: "tblChecks",
    anchor: "Q5",
    columns: [
      { name: "ID", kind: "data", width: 6 },
      { name: "Stage", kind: "data", width: 30 },
      { name: "Check", kind: "data", width: 70, wrap: true },
      { name: "Rule", kind: "data", width: 40, wrap: true },
    ],
    rows: seed.evaluation_checks.map((c) => [`'${c.id}`, c.stage, c.text, CHECK_RULE_TEXT[c.id] ?? "Manual"]),
  };

  const colOf = (n: number) => { let x = ''; while (n > 0) { const m = (n - 1) % 26; x = String.fromCharCode(65 + m) + x; n = Math.floor((n - 1) / 26); } return x; };
  const cols = Array.from({ length: 30 }, (_, i) => colOf(23 + 2 * i));
  const simpleTables: TableSpec[] = SIMPLE_LISTS
    .filter((s) => s.name !== "lstActivity")
    .map((s, i) => ({
      name: s.name.replace(/^lst/, "tblL"),
      anchor: `${cols[i]}5`,
      columns: [{ name: s.title, kind: "data", width: Math.min(40, Math.max(12, s.title.length + 4)) }],
      rows: s.values.map((v) => [v]),
    }));

  return {
    name: "Lists",
    tab: "grey",
    cells: [
      { addr: "A1", value: "Lists and reference data", bold: true, size: 16, color: "brand" },
      {
        addr: "A2",
        value:
          "From seed-data.json and registration-forms.json. The fee table and activity map are Admin data: change them only on a Commission decision; saved submissions keep the pricing they were saved with (snapshot) until recalculated. Staff names (Evaluating Officers, Reviewing Supervisors, Approving Officers, at the right) feed the officer drop-downs.",
        italic: true,
        wrap: true,
        merge: "A2:G3",
      },
      { addr: "A4", value: "Schedule 3 fee table (₦)", bold: true, color: "brand" },
      { addr: "A18", value: "Activity → category map", bold: true, color: "brand" },
      { addr: "A36", value: "Forms REG-01A to REG-01K", bold: true, color: "brand" },
      { addr: "A51", value: "Document conditions (Schedule 2)", bold: true, color: "brand" },
      { addr: "I4", value: "Schedule 2 documents by form", bold: true, color: "brand" },
      { addr: "Q4", value: "Evaluation checks (Form OGSERC/EVAL-01)", bold: true, color: "brand" },
      { addr: "W4", value: "Drop-down lists", bold: true, color: "brand" },
    ],
    tables: [fees, activities, forms, conditions, formDocs, checks, ...simpleTables],
    freeze: "A5",
    protect: true,
  };
}

const CHECK_RULE_TEXT: Record<string, string> = {
  "1.1": "Automatic: Y once an acknowledgement number exists",
  "1.3": "Automatic: N if the activity is not in the activities list",
  "1.4": "Automatic: N if captive (CPT) below 1 MW",
  "1.5": "Automatic: N if the CAC number is on another registration",
  "1.7": "N/A unless MSL or multi-State NERC licence",
  "1.8": "Automatic: Y if not late",
  "1.9": "Automatic: N/A if not late; Y if a late charge applies",
  "1.10": "Automatic: pending until the category is confirmed (§4.13)",
  "2.4": "N/A when Unlicensed",
  "3.0": "Automatic: Y if the form's documents are complete",
  "3.1": "N/A when 3.0 is Y",
  "3.2": "N/A for a company (or no registrant type)",
  "4.2": "N/A when Unlicensed",
  "4.3": "Automatic: N if the nearest licence expiry is within the window after the Effective Date",
  "4.9": "N/A unless Unlicensed",
  "5.3": "N/A unless a waiver is approved",
  "5.4": "Automatic: same as 1.9",
  "5.5": "Automatic: Y if the balance is nil",
  "7.1": "N/A unless Unlicensed",
  "7.3": "N/A unless MSL or multi-State NERC licence",
  "7.5": "Automatic: N/A on REG-01 submissions",
  "7.6": "Automatic: Y if no data flags (or an override reason explains them)",
  "9.1": "Automatic: Y when Registered with a certificate date; N/A for updates",
  "9.2": "Automatic: Y when the registration number is locked; N/A for updates",
  "9.3": "N/A for updates and annual confirmations",
  "9.4": "N/A for updates and annual confirmations",
  "9.5": "N/A for updates and annual confirmations",
};

// ---------------------------------------------------------------------------------------------
// Register

const REG = "tblRegister";
const st = R("Status");

/**
 * The submission's Schedule 2 list (src/domain/documents.ts documentList + effectiveDocuments):
 * the documents form's items, then (policy) other activities' items not already listed, evidence of
 * payment last; each item's value from the automatic rules or the Documents sheet.
 */
function docList(result: string, empty: string): string {
  return `=LET(ack,${R("Ack No.")},df,${R("Documents Form")},fm,${T("tblFormDocs", "Form")},
m,(fm=df)+(cfgOtherActivityDocs="Y")*((fm=${R("Other Form 1")})+(fm=${R("Other Form 2")})+(fm=${R("Other Form 3")})),
ok,AND(df<>"",SUM(--(m>0))>0),
ixa,FILTER(SEQUENCE(ROWS(fm)),m>0,1),
ixb,SORTBY(ixa,--(INDEX(${T("tblFormDocs", "Key")},ixa)=${q(PAYMENT_EVIDENCE_KEY)}),1,--(INDEX(fm,ixa)<>df),1,ixa,1),
kkb,INDEX(${T("tblFormDocs", "Key")},ixb),
idx,FILTER(ixb,XMATCH(kkb,kkb)=SEQUENCE(ROWS(kkb))),
keys,INDEX(${T("tblFormDocs", "Key")},idx),
txt,INDEX(${T("tblFormDocs", "Document")},idx),
rw,INDEX(${T("tblFormDocs", "Required When")},idx),
cv,IFERROR(INDEX([@[${FIRST_COND}]:[${LAST_COND}]],1,XMATCH(rw,lstConditionKeys)),""),
d,IF(ack="","",FILTER(tblDocuments[[Key]:[Received (Y/N/N/A)]],${T("tblDocuments", "Reference")}=ack,"")),
ent,IFERROR(XLOOKUP(keys,INDEX(d,0,1),INDEX(d,0,2),""),""),
entv,IF(ISNUMBER(XMATCH(ent&"",{"Y","N","N/A"})),UPPER(ent&""),""),
eff,IF(keys=${q(PAYMENT_EVIDENCE_KEY)},${R("Evidence of Payment")},IF(cv="N","N/A",entv)),
IF(ok,${result},${empty}))`.replace(/\n/g, "");
}

const countIn = (col: string, token: string) =>
  `=LET(x,${R(col)}&"|",IF(${R(col)}="",0,(LEN(x)-LEN(SUBSTITUTE(x,${q(token)},"")))/${token.length}))`;

/** One flag column per src/domain/flags.ts code, in dataFlags order. Each holds its message or "". */
function flagColumns(): ColumnSpec[] {
  const ds = R("Date Submitted");
  const cap = R("Installed Capacity (MW)");
  const lic = R("Licence Status");
  const numbered = `OR(TRIM(${R("Licence 1 No.")})<>"",TRIM(${R("Licence 2 No.")})<>"",TRIM(${R("Licence 3 No.")})<>"")`;
  const notHeld = `OR(${lic}="Unlicensed",${lic}="Licence application pending")`;
  const dueLabel = `(cfgAnnualDueDay&" "&INDEX(lstMonths,cfgAnnualDueMonth))`;
  const dueDate = (y: string) => `DATE(${y},cfgAnnualDueMonth,cfgAnnualDueDay)`;
  const others = [1, 2, 3].map((i) => R(`Other Activity ${i}`));
  const flag = (code: string, f: string): ColumnSpec => ({
    name: code,
    kind: "calc",
    f: `=${f}`,
    width: 14,
    hidden: true,
  });
  const dupOf = (normCol: string, nonEmpty: string) =>
    `IF(AND(${nonEmpty},SUM((${T(REG, normCol)}=${R(normCol)})*(${T(REG, "Family")}<>${R("Family")}))>0),`;
  const target = `IF(${R("Confirmed Category")}<>"",${R("Confirmed Category")},${R("Category Applied")})`;
  const priceDiff = (label: string, a: string, b: string, fmt: (x: string) => string) =>
    `IF(${a}<>${b},${q(label + " ")}&${fmt(a)}&" → "&${fmt(b)},"")`;
  const dOrNone = (x: string) => `IF(${x}="","none",${FD(x)})`;
  return [
    flag("DUPLICATE_CAC", `${dupOf("CAC Norm", `TRIM(${R("CAC No.")})<>""`)}"Duplicate CAC number on another submission (one registration per person, para 11(4))","")`),
    flag("DUPLICATE_NAME", `${dupOf("Name Norm", `TRIM(${R("Registered Name")})<>""`)}"Duplicate registered name","")`),
    flag(
      "MISSING_REQUIRED",
      `LET(m,TEXTJOIN(", ",TRUE,IF(TRIM(${R("Registered Name")})="","registered name",""),IF(${ds}="","date submitted",""),IF(TRIM(${R("Form Filed")})="","form filed",""),IF(TRIM(${R("Principal LGA")})="","principal LGA",""),IF(TRIM(${R("Primary Activity")})="","primary activity",""),IF(TRIM(${lic})="","licence status",""),IF(TRIM(${R("Operating on Effective Date (Y/N)")})="","operating on Effective Date",""),IF(TRIM(${st})="","status","")),IF(m="","","Missing required field: "&m))`,
    ),
    flag("UNKNOWN_ACTIVITY", `IF(AND(${R("Primary Activity")}<>"",${R("Primary Code")}=""),"Primary activity not in the activities list","")`),
    flag(
      "UNKNOWN_OTHER_ACTIVITY",
      `LET(u,TEXTJOIN(", ",TRUE,${others.map((o) => `IF(${o}="","",IF(ISNA(XMATCH(${o},${T("tblActivities", "Activity")})),${o},""))`).join(",")}),IF(u="","","Other activity not in the activities list: "&u))`,
    ),
    flag(
      "NO_CAPACITY",
      `IF(AND(${R("Primary Code")}<>"",XLOOKUP(${R("Primary Code")},${T("tblActivities", "Code")},${T("tblActivities", "Capacity-Based")},"N")="Y",${cap}=""),"Capacity-based activity ("&${R("Primary Code")}&") with no installed capacity","")`,
    ),
    flag(
      "OVERRIDE_NO_REASON",
      `IF(AND(${R("Category Override")}<>"",${R("Category Override")}<>${R("Category Auto")},TRIM(${R("Override Reason")})=""),"Category overridden with no reason","")`,
    ),
    flag("CERT_NOT_COMPLETE", `IF(AND(${R("Certificate Issue Date")}<>"",${R("Submission Complete")}="No"),"Certificate dated but submission not complete","")`),
    flag(
      "CERT_STATUS",
      `IF(AND(${R("Certificate Issue Date")}<>"",${st}<>"Registered",${st}<>"Cancelled"),"Certificate dated but status not Registered/Cancelled","")`,
    ),
    flag("REGISTERED_NO_CERT_DATE", `IF(AND(${st}="Registered",${R("Certificate Issue Date")}=""),"Registered without certificate date","")`),
    flag(
      "DUPLICATE_REG_NO",
      `IF(${R("Registration No. in Use")}="","",IF(SUM((${T(REG, "Registration No.")}=${R("Registration No. in Use")})*(${T(REG, "Family")}<>${R("Family")}))>0,"Duplicate registration number",""))`,
    ),
    flag(
      "LICENCE_RENEWAL",
      `IF(${R("Nearest Licence Expiry")}="","",IF(${R("Nearest Licence Expiry")}-${R("Effective Date Used")}<=cfgExpiryWindowDays,"Licence expires within 6 months of the Effective Date – renewal (para 8(5))",""))`,
    ),
    flag("CPT_BELOW_1MW", `IF(AND(${R("Primary Code")}="CPT",N(${cap})<1),"Own-use below 1 MW is excluded – use Form REG-01I (own-use notification)","")`),
    flag("MSL_LICENCE", `IF(AND(${R("Primary Code")}="MSL",${lic}<>"NERC licence (multi-State)"),"Check licence status for multi-State licensee","")`),
    flag(
      "NO_START_DATE",
      `IF(AND(${R("Operating on Effective Date (Y/N)")}="N",${R("Planned Start Date")}=""),"Not operating on Effective Date and no planned start date","")`,
    ),
    flag("FUTURE_SUBMISSION", `IF(${ds}="","",IF(${ds}>AsOfDate,"Date submitted is in the future",""))`),
    flag(
      "LICENCE_APPLICATION_OVERDUE",
      `IF(${R("Licence Application Due")}="","",IF(AsOfDate>${R("Licence Application Due")},"Unlicensed and licence application overdue (para 18(2))",""))`,
    ),
    flag(
      "LICENCE_NO_WITHOUT_LICENCE",
      `IF(AND(${notHeld},${numbered}),"Licence number entered but licence status is """&${lic}&"""","")`,
    ),
    flag("LICENCE_NO_MISSING", `IF(AND(${lic}<>"",NOT(${notHeld}),NOT(${numbered})),"Licence held but no licence number entered","")`),
    flag(
      "GENERATION_CATEGORY",
      `IF(AND(OR(${R("Primary Code")}="GEN",${R("Primary Code")}="CPT"),N(${cap})>=10,ISNA(XMATCH(${R("Category Applied")}&"",{"A","B","C"}))),"Generation of 10 MW or more but the applied category is not C (or A/B)","")`,
    ),
    flag(
      "CAC_FORMAT",
      `LET(t,UPPER(${JSTRIM(R("CAC No."))}),p,LEFT(t,2),r0,MID(t,3,999),r,IF(LEFT(r0,1)=" ",MID(r0,2,999),r0),ok,AND(OR(p="RC",p="BN",p="IT"),LEN(r)>0,IFERROR(SUM(--ISERROR(FIND(MID(r,SEQUENCE(MAX(1,LEN(r))),1),"0123456789")))=0,FALSE)),IF(OR(t="",ok),"","CAC number format is invalid (expected RC, BN or IT followed by digits)"))`,
    ),
    flag(
      "FORM_CATEGORY_MISMATCH",
      `LET(tg,${target},ff,${R("Form Filed")},fc,${R("Form Category")},IF(OR(ff="",fc="",tg="",fc=tg),"",IF(${R("Confirmed Category")}="","Form filed ("&ff&") does not match the calculated category ("&tg&") – confirm the category",IF(cfgWrongForm=${q(WRONG_FORM.REQUIRE)},"Filed on "&ff&" but the category is confirmed as "&tg&" – the applicant must file on REG-01"&tg,IF(TRIM(${R("Category Confirmed Reason")})="","Filed on "&ff&" but confirmed as Category "&tg&" with no reason recorded","")))))`,
    ),
    flag(
      "CONFIRMED_CATEGORY_NOT_CHARGED",
      `IF(AND(${R("Confirmed Category")}<>"",${R("Category Applied")}<>"",${R("Confirmed Category")}<>${R("Category Applied")}),"Category confirmed as "&${R("Confirmed Category")}&" but Category "&${R("Category Applied")}&" is charged – correct the activities or capacity, or override the category, then an admin recalculates","")`,
    ),
    flag(
      "TECHNICAL_INCOMPLETE",
      `IF(OR(TRIM(${R("Form Sections Not Complete")})="",${R("Documents Form")}=""),"",${R("Documents Form")}&" sections not complete: "&TRIM(${R("Form Sections Not Complete")}))`,
    ),
    flag(
      "TECHNICAL_CAPACITY_MISMATCH",
      `IF(OR(${cap}="",${R("Capacity Stated in Sections (MW)")}=""),"",LET(a,N(${R("Capacity Stated in Sections (MW)")}),b,N(${cap}),IF(ABS(a-b)<=MAX(0.001,0.01*MAX(ABS(a),ABS(b))),"","Installed capacity is "&b&" MW, but "&${R("Documents Form")}&" sections give "&ROUND(a,3)&" MW")))`,
    ),
    flag(
      "LINKED_REGISTRATION",
      `IF(${R("Filing Code")}="NEW","",IF(${R("Linked Row")}="","Not linked to a registered submission (quote its registration number)",IF(AND(${R("Linked Status")}<>"Registered",${R("Closed")}="No"),"The linked registration "&IF(${R("Linked Registration No.")}="","(no number)",TRIM(${R("Linked Registration No.")}))&" is "&${R("Linked Status")}&", not Registered","")))`,
    ),
    flag(
      "ANNUAL_LATE",
      `IF(OR(${R("Filing Code")}<>"ANNUAL",${ds}="",${R("Linked Certificate Date")}=""),"",IF(AND(YEAR(${R("Linked Certificate Date")})<YEAR(${ds}),${ds}>${dueDate(`YEAR(${ds})`)}),"Annual confirmation filed after "&${dueLabel}&" (para 16(2))",""))`,
    ),
    flag(
      "ANNUAL_CONFIRMATION_OVERDUE",
      `LET(y,YEAR(AsOfDate),IF(OR(${R("Filing Code")}<>"NEW",${st}<>"Registered",${R("Certificate Issue Date")}=""),"",IF(OR(YEAR(${R("Certificate Issue Date")})>=y,NOT(AsOfDate>${dueDate("y")})),"",IF(SUM((${T(REG, "Family")}=${R("Family")})*(${T(REG, "Filing Code")}="ANNUAL")*(${T(REG, "Linked Row")}<>"")*(IFERROR(YEAR(${T(REG, "Date Submitted")}),0)=y)*(${T(REG, "Status")}<>"Refused")*(${T(REG, "Status")}<>"Lapsed")*(${T(REG, "Status")}<>"Cancelled"))>0,"","Annual confirmation for "&y&" not filed by "&${dueLabel}&" (para 16(2))"))))`,
    ),
    flag(
      "EVALUATION_BEFORE_PAYMENT",
      `IF(${R("Evaluation Started")}="","",IF(OR(${R("Released for Evaluation")}="",${R("Evaluation Started")}<N(${R("Released for Evaluation")})),"Evaluation started before Finance confirmed payment",""))`,
    ),
    flag(
      "STATUS_WITHOUT_CONFIRMATION",
      `IF(AND(${statusIn(st, PAST_ACK)},${R("Released for Evaluation")}=""),"Status moved past acknowledgement without Finance confirmation","")`,
    ),
    flag(
      "PRICING_OUT_OF_DATE",
      `IF(${R("Priced Category")}="","",LET(d,IF(${R("Current Category")}="","category can no longer be determined",TEXTJOIN("; ",TRUE,${[
        priceDiff("category", R("Priced Category"), R("Current Category"), (x) => x),
        priceDiff("fee", `N(${R("Priced Fee")})`, R("Current Fee"), NAIRA),
        priceDiff("late initial", `N(${R("Priced Late Initial")})`, R("Current Late Initial"), NAIRA),
        priceDiff("late daily", `N(${R("Priced Late Daily")})`, R("Current Late Daily"), NAIRA),
        priceDiff("late cap", `N(${R("Priced Late Cap")})`, R("Current Late Cap"), NAIRA),
        `IF(${R("Priced Deadline")}&""<>${R("Current Deadline")}&"","deadline "&${dOrNone(R("Priced Deadline"))}&" → "&${dOrNone(R("Current Deadline"))},"")`,
        `IF(${R("Priced Effective Date")}<>cfgEffectiveDate,"Effective Date "&${dOrNone(R("Priced Effective Date"))}&" → "&${FD("cfgEffectiveDate")},"")`,
      ].join(",")})),IF(d="","","Saved pricing differs from current rules ("&d&") – an admin may recalculate")))`,
    ),
  ];
}

const FLAG_CODES = () => flagColumns().map((c) => c.name);

function registerTable(): TableSpec {
  const cap = R("Installed Capacity (MW)");
  const catFor = (name: string) =>
    `=LET(a,${name},c,N(${cap}),i,IF(a="",0,IFERROR(XMATCH(a,${T("tblActivities", "Activity")}),0)),IF(i=0,"",IF(AND(INDEX(${T("tblActivities", "Code")},i)="SUP",c>=1),cfgSupplyRetailCat,IF(c>=10,INDEX(${T("tblActivities", "Category 10 MW+")},i),IF(c>=1,INDEX(${T("tblActivities", "Category 1 to 10 MW")},i),INDEX(${T("tblActivities", "Category below 1 MW")},i))))))`;
  const feeCol = (c: string) => `XLOOKUP(${R("Current Category")},${T("tblFees", "Category")},${T("tblFees", c)},0)`;
  const reg = (c: string) => `INDEX(${T(REG, c)},${R("Linked Row")})`;
  const priced = `(${R("Priced Category")}<>"")`;
  const today = "AsOfDate";
  const flags = FLAG_CODES();

  const nextAction = `=LET(dd,${R("Deficiency Response Due")},det,${R("Determination Due")},
SWITCH(${st},
"Registered",IF(${R("Registration No.")}<>"","Complete","Lock the registration number"),
"Cancelled","Closed – Cancelled","Refused","Closed – Refused","Changes Applied","Closed – Changes Applied",
"Lapsed","Closed – Lapsed; fresh application needed",
"Deficiency Notice Issued",IF(dd="","Await response",IF(${today}>dd,"Response overdue – lapse the submission (para 13(2))","Await response by "&${FD("dd")})),
"Provisionally Registered","Determine and issue the certificate",
"Acknowledged - Awaiting Payment",IF(${isYes("Gate Cleared")},"Payment confirmed – release for evaluation (runs automatically)",IF(${R("Payments With Finance")}>0,"Payment with Finance – awaiting confirmation","Await payment of "&${NAIRA(`MAX(0,${R("Release Requires")}-${R("Amount Paid")})`)}&", then Finance confirmation")),
IF(${R("Submission Complete")}="No",LET(n,${R("Documents Outstanding")}+${R("Documents Pending")},t,TEXTJOIN(" and ",TRUE,IF(n>0,"obtain "&n&" outstanding document(s)",""),IF(${R("Balance")}>0,"collect "&${NAIRA(R("Balance"))},"")),UPPER(LEFT(t,1))&MID(t,2,9999)&" – or issue a deficiency notice"),
IF(OR(${R("Date Submission Complete")}="",det=""),"Enter the Date Submission Complete",
IF(${today}>det,IF(${R("Filing Code")}<>"NEW","Overdue – determine and apply the changes","Overdue – provisional registration applies (para 13(4))"),"Determine by "&${FD("det")})))))`.replace(/\n/g, "");

  const columns: ColumnSpec[] = [
    // SUBMISSION
    { name: "Ack No.", kind: "macro", width: 22, help: "Set by Save submission. Never typed." },
    { name: "Filing Type", kind: "input", list: "=lstFilingType", width: 22, help: "New registration, update (para 16(1)) or annual confirmation (para 16(2)). Fixed once saved." },
    { name: "Form Filed", kind: "input", list: "=lstForms", width: 10, help: "REG-01A to REG-01K. Own-use (REG-01I) goes on the Own-Use sheet." },
    { name: "Linked Registration No.", kind: "input", width: 26, help: "Updates and annual confirmations: the OGSERC registration number they refer to." },
    { name: "Registered Name", kind: "input", width: 30 },
    { name: "Trading Name", kind: "input", width: 18 },
    { name: "Date Submitted", kind: "input", fmt: FMT.date, width: 13 },
    { name: "Submission Channel", kind: "input", list: "=lstSubmissionChannel", width: 13 },
    // IDENTITY
    { name: "Registrant Type", kind: "input", list: "=lstRegistrantType", width: 14 },
    { name: "CAC No.", kind: "input", width: 13, help: "RC, BN or IT followed by digits." },
    { name: "TIN", kind: "input", width: 13 },
    { name: "Registered Address", kind: "input", width: 28 },
    { name: "Principal LGA", kind: "input", list: "=lstLGA", width: 16 },
    { name: "Other LGAs Served", kind: "input", width: 22 },
    { name: "Towns / Estates Served", kind: "input", width: 22 },
    // ACTIVITIES
    { name: "Primary Activity", kind: "input", list: "=lstActivity", width: 32 },
    { name: "Other Activity 1", kind: "input", list: "=lstActivity", width: 24 },
    { name: "Other Activity 2", kind: "input", list: "=lstActivity", width: 24 },
    { name: "Other Activity 3", kind: "input", list: "=lstActivity", width: 24 },
    { name: "Installed Capacity (MW)", kind: "input", fmt: FMT.num, width: 11 },
    { name: "Customers", kind: "input", fmt: FMT.int, width: 10 },
    // LICENCES
    { name: "Licence Status", kind: "input", list: "=lstLicenceStatus", width: 26 },
    { name: "Licence 1 No.", kind: "input", width: 14 },
    { name: "Licence 1 Expiry", kind: "input", fmt: FMT.date, width: 12 },
    { name: "Licence 2 No.", kind: "input", width: 14 },
    { name: "Licence 2 Expiry", kind: "input", fmt: FMT.date, width: 12 },
    { name: "Licence 3 No.", kind: "input", width: 14 },
    { name: "Licence 3 Expiry", kind: "input", fmt: FMT.date, width: 12 },
    // CONTACT
    { name: "Compliance Officer", kind: "input", width: 18 },
    { name: "Phone", kind: "input", width: 14, help: "11 digits starting with 0, or +234." },
    { name: "Email", kind: "input", width: 22 },
    // TIMELINE AND FEES
    { name: "Operating on Effective Date (Y/N)", kind: "input", list: "=lstYN", width: 11 },
    { name: "Planned Start Date", kind: "input", fmt: FMT.date, width: 12 },
    { name: "Approved Waiver", kind: "input", fmt: FMT.money, width: 13, help: "Finance or Admin only, with the written approval. Never more than the fee." },
    { name: "Category Override", kind: "input", list: "=lstCategoriesNoI", width: 10 },
    { name: "Override Reason", kind: "input", width: 22 },
    // DOCUMENT CONDITIONS
    {
      name: FIRST_COND,
      kind: "calc",
      f: `=IF(TRIM(${R("Licence Status")})="","",IF(${R("Licence Status")}="Unlicensed","N","Y"))`,
      width: 9,
    },
    ...CONDITION_KEYS.slice(1).map(
      (k): ColumnSpec => ({
        name: CONDITION_COLUMNS[k],
        kind: "input",
        list: "=lstYN",
        width: 11,
        help: `${CONDITION_LABELS[k]} Blank = applies; N makes the dependent document N/A.`,
      }),
    ),
    // CATEGORY-SPECIFIC SECTIONS (summary)
    { name: "Form Sections Not Complete", kind: "input", width: 26, help: "The form's own sections still empty or incomplete (from the form), e.g. “Generating plant; Grid connection”. Blank = complete or does not apply." },
    { name: "Capacity Stated in Sections (MW)", kind: "input", fmt: FMT.num, width: 12, help: "Total installed capacity the form's sections give (convert kW to MW)." },
    // EVALUATION (category confirmed)
    { name: "Confirmed Category", kind: "macro", width: 10, help: "Set by Confirm category (Evaluation sheet)." },
    { name: "Category Confirmed Reason", kind: "macro", width: 22 },
    // DETERMINATION
    { name: "Status", kind: "macro", width: 24 },
    { name: "Released for Evaluation", kind: "macro", fmt: FMT.date, width: 12 },
    { name: "Date Submission Complete", kind: "macro", fmt: FMT.date, width: 12 },
    { name: "Deficiency Notice Date", kind: "macro", fmt: FMT.date, width: 12 },
    { name: "Show-Cause Date", kind: "input", fmt: FMT.date, width: 12, help: "Date a show-cause notice was served (para 20). Refusal needs 14 days to pass." },
    { name: "Certificate Issue Date", kind: "macro", fmt: FMT.date, width: 12 },
    { name: "Registration No.", kind: "macro", width: 28 },
    { name: "Certificate Needs Reissue", kind: "macro", width: 10 },
    { name: "Remarks", kind: "input", width: 24 },
    { name: "Created By", kind: "macro", width: 16 },
    // PRICING SNAPSHOT (src/domain/pricing.ts)
    { name: "Priced Category", kind: "macro", width: 8 },
    { name: "Priced Fee", kind: "macro", fmt: FMT.money, width: 12 },
    { name: "Priced Late Initial", kind: "macro", fmt: FMT.money, width: 12 },
    { name: "Priced Late Daily", kind: "macro", fmt: FMT.money, width: 12 },
    { name: "Priced Late Cap", kind: "macro", fmt: FMT.money, width: 13 },
    { name: "Priced Deadline", kind: "macro", fmt: FMT.date, width: 12 },
    { name: "Priced Effective Date", kind: "macro", fmt: FMT.date, width: 12 },

    // ---- CALCULATED ----
    // Links and family (flags.ts familyOf)
    {
      name: "Filing Code",
      kind: "calc",
      f: `=IF(${R("Filing Type")}=${q(FILING_LABELS.UPDATE)},"UPDATE",IF(${R("Filing Type")}=${q(FILING_LABELS.ANNUAL)},"ANNUAL","NEW"))`,
      hidden: true,
    },
    {
      name: "Linked Row",
      kind: "calc",
      f: `=IF(OR(${R("Filing Code")}="NEW",TRIM(${R("Linked Registration No.")})=""),"",IFERROR(XMATCH(TRIM(${R("Linked Registration No.")}),${T(REG, "Registration No.")}),""))`,
      hidden: true,
    },
    { name: "Linked Status", kind: "calc", f: `=IF(${R("Linked Row")}="","",${reg("Status")}&"")`, hidden: true },
    {
      name: "Linked Certificate Date",
      kind: "calc",
      f: `=IF(${R("Linked Row")}="","",LET(v,${reg("Certificate Issue Date")}&"",IF(v="","",--v)))`,
      fmt: FMT.date,
      hidden: true,
    },
    {
      name: "Family",
      kind: "calc",
      f: `=IF(${R("Linked Row")}<>"",${reg("Ack No.")}&"",IF(${R("Ack No.")}<>"",${R("Ack No.")},"ROW"&ROW()))`,
      hidden: true,
    },
    { name: "CAC Norm", kind: "calc", f: `=LOWER(TRIM(${R("CAC No.")}))`, hidden: true },
    { name: "Name Norm", kind: "calc", f: `=LOWER(TRIM(${R("Registered Name")}))`, hidden: true },
    { name: "Closed", kind: "calc", f: `=${yes(statusIn(st, CLOSED))}`, hidden: true },
    // Category (category.ts)
    {
      name: "Primary Code",
      kind: "calc",
      f: `=IF(${R("Primary Activity")}="","",XLOOKUP(${R("Primary Activity")},${T("tblActivities", "Activity")},${T("tblActivities", "Code")},""))`,
      width: 8,
    },
    { name: "Cat Primary", kind: "calc", f: catFor(R("Primary Activity")), hidden: true },
    { name: "Cat Other 1", kind: "calc", f: catFor(R("Other Activity 1")), hidden: true },
    { name: "Cat Other 2", kind: "calc", f: catFor(R("Other Activity 2")), hidden: true },
    { name: "Cat Other 3", kind: "calc", f: catFor(R("Other Activity 3")), hidden: true },
    {
      name: "Category Auto",
      kind: "calc",
      f: `=LET(p,${R("Cat Primary")},c,CHOOSE({1,2,3,4},p,${R("Cat Other 1")},${R("Cat Other 2")},${R("Cat Other 3")}),IF(p="","",IF(OR(c="A"),"A",IF(OR(c="B"),"B",LET(f,IF(c="",-1,IFERROR(XLOOKUP(c,${T("tblFees", "Category")},${T("tblFees", "Registration Fee")}),0)),INDEX(c,XMATCH(MAX(f),f)))))))`,
      width: 9,
    },
    // Current pricing (pricing.ts priceSubmission)
    {
      name: "Current Category",
      kind: "calc",
      f: `=LET(c,IF(${R("Category Override")}<>"",${R("Category Override")},${R("Category Auto")}),IF(c="","",IF(ISNUMBER(XMATCH(c,${T("tblFees", "Category")})),c,"")))`,
      hidden: true,
    },
    {
      name: "Current Fee",
      kind: "calc",
      f: `=IF(${R("Current Category")}="",0,IF(OR(${R("Filing Code")}="NEW",cfgFilingFeeOnUpdates="Y"),${feeCol("Registration Fee")},0))`,
      fmt: FMT.money,
      hidden: true,
    },
    ...(["Late Initial", "Late Daily", "Late Daily Cap"] as const).map(
      (c): ColumnSpec => ({
        name: `Current ${c === "Late Daily Cap" ? "Late Cap" : c}`,
        kind: "calc",
        f: `=IF(OR(${R("Current Category")}="",${R("Filing Code")}<>"NEW"),0,${feeCol(c)})`,
        fmt: FMT.money,
        hidden: true,
      }),
    ),
    {
      name: "Current Deadline",
      kind: "calc",
      f: `=IF(${R("Filing Code")}<>"NEW","",IF(${R("Operating on Effective Date (Y/N)")}="Y",cfgExistingDeadline,IF(${R("Planned Start Date")}="","",${R("Planned Start Date")}-cfgNewOpLeadDays)))`,
      fmt: FMT.date,
      hidden: true,
    },
    // Applied (snapshot ?? current)
    {
      name: "Category Applied",
      kind: "calc",
      f: `=IF(${priced},${R("Priced Category")},${R("Current Category")})`,
      width: 9,
    },
    {
      name: "Category Description",
      kind: "calc",
      f: `=IF(${R("Category Applied")}="","",XLOOKUP(${R("Category Applied")},${T("tblFees", "Category")},${T("tblFees", "Description")},""))`,
      width: 30,
    },
    {
      name: "Form Category",
      kind: "calc",
      f: `=IF(${R("Form Filed")}="","",XLOOKUP(${R("Form Filed")},${T("tblForms", "Form")},${T("tblForms", "Category")},""))`,
      hidden: true,
    },
    {
      name: "Documents Form",
      kind: "calc",
      f: `=LET(cc,${R("Confirmed Category")},ff,${R("Form Filed")},cf,IF(AND(cc<>"",cfgWrongForm=${q(WRONG_FORM.ACCEPT)}),XLOOKUP(cc,${T("tblForms", "Category")},${T("tblForms", "Form")},""),""),IF(cf<>"",cf,IF(AND(ff<>"",ISNUMBER(XMATCH(ff,${T("tblForms", "Form")}))),ff,IF(${R("Priced Category")}="","",XLOOKUP(${R("Priced Category")},${T("tblForms", "Category")},${T("tblForms", "Form")},"")))))`,
      width: 10,
    },
    ...[1, 2, 3].map(
      (i): ColumnSpec => ({
        name: `Other Form ${i}`,
        kind: "calc",
        f: `=LET(c,${R(`Cat Other ${i}`)},IF(OR(cfgOtherActivityDocs<>"Y",c="",c="I"),"","REG-01"&c))`,
        hidden: true,
      }),
    ),
    // Deadlines and fees (deadlines.ts, fees.ts)
    {
      name: "Effective Date Used",
      kind: "calc",
      f: `=IF(${priced},${R("Priced Effective Date")},cfgEffectiveDate)`,
      fmt: FMT.date,
      hidden: true,
    },
    {
      name: "Registration Deadline",
      kind: "calc",
      f: `=IF(${priced},IF(${R("Priced Deadline")}="","",${R("Priced Deadline")}),${R("Current Deadline")})`,
      fmt: FMT.date,
      width: 12,
    },
    {
      name: "Days Late",
      kind: "calc",
      f: `=IF(OR(${R("Date Submitted")}="",${R("Registration Deadline")}=""),0,MAX(0,${R("Date Submitted")}-${R("Registration Deadline")}))`,
      fmt: FMT.int,
      width: 7,
    },
    {
      name: "Registration Fee",
      kind: "calc",
      f: `=IF(${priced},N(${R("Priced Fee")}),${R("Current Fee")})`,
      fmt: FMT.money,
      width: 13,
    },
    {
      name: "Late Charge",
      kind: "calc",
      f: `=LET(s,${priced},i,IF(s,N(${R("Priced Late Initial")}),${R("Current Late Initial")}),d,IF(s,N(${R("Priced Late Daily")}),${R("Current Late Daily")}),cp,IF(s,N(${R("Priced Late Cap")}),${R("Current Late Cap")}),n,${R("Days Late")},IF(n<=0,0,i+MIN(d*n,cp)))`,
      fmt: FMT.money,
      width: 13,
    },
    { name: "Net Fee", kind: "calc", f: `=MAX(0,${R("Registration Fee")}-N(${R("Approved Waiver")}))`, fmt: FMT.money, hidden: true },
    {
      name: "Total Due",
      kind: "calc",
      f: `=IF(cfgWaiverOnLate="Y",MAX(0,${R("Registration Fee")}+${R("Late Charge")}-N(${R("Approved Waiver")})),${R("Net Fee")}+${R("Late Charge")})`,
      fmt: FMT.money,
      width: 13,
    },
    {
      name: "Amount Paid",
      kind: "calc",
      f: `=IF(${R("Ack No.")}="",0,SUMIFS(${T("tblPayments", "Amount")},${T("tblPayments", "Reference")},${R("Ack No.")},${T("tblPayments", "Counts as Paid")},"Yes"))`,
      fmt: FMT.money,
      width: 13,
    },
    {
      name: "With Finance",
      kind: "calc",
      f: `=IF(${R("Ack No.")}="",0,SUMIFS(${T("tblPayments", "Amount")},${T("tblPayments", "Reference")},${R("Ack No.")},${T("tblPayments", "With Finance")},"Yes"))`,
      fmt: FMT.money,
      width: 12,
    },
    {
      name: "Payments With Finance",
      kind: "calc",
      f: `=IF(${R("Ack No.")}="",0,COUNTIFS(${T("tblPayments", "Reference")},${R("Ack No.")},${T("tblPayments", "With Finance")},"Yes"))`,
      hidden: true,
    },
    {
      name: "Last Payment Date",
      kind: "calc",
      f: `=IF(${R("Amount Paid")}>0,MAXIFS(${T("tblPayments", "Date Received")},${T("tblPayments", "Reference")},${R("Ack No.")},${T("tblPayments", "Counts as Paid")},"Yes"),"")`,
      fmt: FMT.date,
      width: 12,
    },
    { name: "Balance", kind: "calc", f: `=ROUND(${R("Total Due")}-${R("Amount Paid")},2)`, fmt: FMT.money, width: 13 },
    {
      name: "Payment Status",
      kind: "calc",
      f: `=IF(${R("Total Due")}=0,"Nil",IF(${R("Balance")}<=0,"Paid",IF(${R("Amount Paid")}>0,"Part-paid","Unpaid")))`,
      width: 10,
    },
    // Finance gate (finance.ts)
    {
      name: "Release Requires",
      kind: "calc",
      f: `=IF(cfgLateRequiredForRelease="Y",${R("Total Due")},${R("Net Fee")})`,
      fmt: FMT.money,
      hidden: true,
    },
    { name: "Gate Cleared", kind: "calc", f: `=${yes(`${R("Amount Paid")}>=${R("Release Requires")}`)}`, width: 8 },
    {
      name: "Gate Reason",
      kind: "calc",
      f: `="Payment not yet confirmed by Finance: "&${NAIRA(R("Amount Paid"))}&" of "&${NAIRA(R("Release Requires"))}&" confirmed"&IF(${R("Payments With Finance")}>0,"; "&${NAIRA(R("With Finance"))}&" recorded and waiting for Finance","")`,
      hidden: true,
    },
    {
      name: "Stage",
      kind: "calc",
      f: `=IF(${R("Closed")}="Yes",5,IF(OR(${st}=${q(S.AWAITING)},${st}=""),IF(${isYes("Gate Cleared")},3,IF(${R("Payments With Finance")}>0,2,1)),4))`,
      fmt: FMT.int,
      hidden: true,
    },
    {
      name: "Process Stage",
      kind: "calc",
      f: `=CHOOSE(${R("Stage")},"Acknowledged – awaiting payment","Payment with Finance","Payment confirmed","Evaluation and determination","Closed – "&${st})`,
      width: 22,
    },
    // Documents (documents.ts)
    {
      name: "Evidence of Payment",
      kind: "calc",
      f: `=IF(${R("Net Fee")}=0,"N/A",IF(${R("Amount Paid")}>=${R("Net Fee")},"Y",""))`,
      hidden: true,
    },
    { name: "Document Values", kind: "calc", f: docList(`TEXTJOIN("|",FALSE,keys&"="&eff)`, `""`), hidden: true },
    { name: "Documents Listed", kind: "calc", f: countIn("Document Values", "="), fmt: FMT.int, hidden: true },
    { name: "Documents Outstanding", kind: "calc", f: countIn("Document Values", "=N|"), fmt: FMT.int, width: 8 },
    { name: "Documents Pending", kind: "calc", f: countIn("Document Values", "=|"), fmt: FMT.int, width: 8 },
    {
      name: "Documents Complete",
      kind: "calc",
      f: `=${yes(`AND(${R("Documents Listed")}>0,${R("Documents Outstanding")}=0,${R("Documents Pending")}=0)`)}`,
      width: 8,
    },
    {
      name: "Outstanding Documents",
      kind: "calc",
      f: docList(`TEXTJOIN("; ",TRUE,FILTER(txt,(eff<>"Y")*(eff<>"N/A"),""))`, `""`),
      width: 30,
    },
    { name: "Documents Received", kind: "calc", f: docList(`TEXTJOIN("; ",TRUE,FILTER(txt,eff="Y",""))`, `""`), width: 30 },
    {
      name: "Submission Complete",
      kind: "calc",
      f: `=${yes(`AND(${isYes("Documents Complete")},${R("Amount Paid")}>=IF(cfgLateBlocksComplete="Y",${R("Total Due")},${R("Net Fee")}))`)}`,
      width: 9,
    },
    // Clocks (deadlines.ts, sla.ts)
    {
      name: "Determination Due",
      kind: "calc",
      f: `=IF(${R("Date Submission Complete")}="","",${R("Date Submission Complete")}+cfgDeterminationDays)`,
      fmt: FMT.date,
      width: 12,
    },
    {
      name: "Deficiency Response Due",
      kind: "calc",
      f: `=IF(${R("Deficiency Notice Date")}="","",${R("Deficiency Notice Date")}+cfgDeficiencyDays)`,
      fmt: FMT.date,
      width: 12,
    },
    {
      name: "Licence Application Due",
      kind: "calc",
      f: `=IF(${R("Licence Status")}="Unlicensed",${R("Effective Date Used")}+cfgLicenceAppDays,"")`,
      fmt: FMT.date,
      width: 12,
    },
    {
      name: "Nearest Licence Expiry",
      kind: "calc",
      f: `=IF(COUNT(${R("Licence 1 Expiry")},${R("Licence 2 Expiry")},${R("Licence 3 Expiry")})=0,"",MIN(${R("Licence 1 Expiry")},${R("Licence 2 Expiry")},${R("Licence 3 Expiry")}))`,
      fmt: FMT.date,
      width: 12,
    },
    {
      name: "Days in Queue",
      kind: "calc",
      f: `=IF(OR(${R("Closed")}="Yes",${R("Date Submitted")}=""),"",MAX(0,AsOfDate-${R("Date Submitted")}))`,
      fmt: FMT.int,
      width: 7,
    },
    {
      name: "SLA",
      kind: "calc",
      f: `=LET(q,${R("Days in Queue")},det,${R("Determination Due")},dd,${R("Deficiency Response Due")},IF(OR(q="",${st}=${q(S.PROVISIONAL)},${st}=${q(S.AWAITING)}),"",IF(OR(IF(det="",FALSE,AsOfDate>det),IF(AND(${st}=${q(S.DEFICIENCY)},dd<>""),AsOfDate>dd,FALSE)),"Red",IF(IF(det="",q>cfgDeterminationDays,det-AsOfDate<=cfgAmberDays),"Amber","Green"))))`,
      width: 7,
    },
    {
      name: "Registration No. in Use",
      kind: "calc",
      f: `=IF(${R("Registration No.")}<>"",${R("Registration No.")},IF(${st}=${q(S.PROVISIONAL)},${R("Ack No.")},""))`,
      width: 26,
    },
    {
      name: "Evaluation Started",
      kind: "calc",
      f: `=IF(${R("Ack No.")}="","",LET(v,XLOOKUP(${R("Ack No.")},${T("tblEvaluation", "Ack No.")},${T("tblEvaluation", "Date Evaluation Started")},"")&"",IF(v="","",--v)))`,
      fmt: FMT.date,
      hidden: true,
    },
    // Flags (flags.ts)
    ...flagColumns(),
    {
      name: "Flag Count",
      kind: "calc",
      f: `=COUNTIF([@[${flags[0]}]:[${flags.at(-1)}]],"?*")`,
      fmt: FMT.int,
      width: 6,
    },
    { name: "Flags", kind: "calc", f: `=TEXTJOIN("; ",TRUE,[@[${flags[0]}]:[${flags.at(-1)}]])`, width: 40 },
    {
      name: "Flag Codes",
      kind: "calc",
      f: `=TEXTJOIN(",",TRUE,IF([@[${flags[0]}]:[${flags.at(-1)}]]<>"",${REG}[[#Headers],[${flags[0]}]:[${flags.at(-1)}]],""))`,
      hidden: true,
    },
    // Next action (next-action.ts)
    { name: "Next Action", kind: "calc", f: nextAction, width: 44 },
  ];

  const g = (title: string, from: string, to: string) => ({ title, from, to });
  return {
    name: REG,
    anchor: "A6",
    columns,
    capacity: 2000,
    groups: [
      g("SUBMISSION", "Ack No.", "Submission Channel"),
      g("IDENTITY AND SERVICE AREA", "Registrant Type", "Towns / Estates Served"),
      g("ACTIVITIES", "Primary Activity", "Customers"),
      g("LICENCES", "Licence Status", "Licence 3 Expiry"),
      g("CONTACT", "Compliance Officer", "Email"),
      g("TIMELINE AND FEES", "Operating on Effective Date (Y/N)", "Override Reason"),
      g("DOCUMENT CONDITIONS (blank = applies)", FIRST_COND, LAST_COND),
      g("FORM SECTIONS", "Form Sections Not Complete", "Capacity Stated in Sections (MW)"),
      g("DETERMINATION (set by buttons)", "Confirmed Category", "Created By"),
      g("PRICING SNAPSHOT (frozen at save)", "Priced Category", "Priced Effective Date"),
      g("CATEGORY", "Primary Code", "Category Description"),
      g("FEES AND PAYMENTS (only Finance-confirmed payments count)", "Registration Deadline", "Process Stage"),
      g("DOCUMENTS (per-form list)", "Documents Outstanding", "Submission Complete"),
      g("CLOCKS", "Determination Due", "Registration No. in Use"),
      g("FLAGS AND NEXT ACTION", "Flag Count", "Next Action"),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Documents

function documentsTable(): TableSpec {
  const ref = R("Reference");
  const isOun = `ISNUMBER(XMATCH(${ref},${T("tblOwnUse", "OUN No.")}))`;
  const dv = `IF(${isOun},XLOOKUP(${ref},${T("tblOwnUse", "OUN No.")},${T("tblOwnUse", "Document Values")},""),XLOOKUP(${ref},${T(REG, "Ack No.")},${T(REG, "Document Values")},""))`;
  return {
    name: "tblDocuments",
    anchor: "A6",
    capacity: 20000,
    columns: [
      { name: "Reference", kind: "macro", width: 24 },
      {
        name: "Registrant",
        kind: "calc",
        f: `=IF(${ref}="","",IF(${isOun},XLOOKUP(${ref},${T("tblOwnUse", "OUN No.")},${T("tblOwnUse", "Name")},""),XLOOKUP(${ref},${T(REG, "Ack No.")},${T(REG, "Registered Name")},"(not found)")))`,
        width: 26,
      },
      { name: "Form", kind: "macro", width: 9 },
      { name: "Key", kind: "macro", width: 22 },
      { name: "Received (Y/N/N/A)", kind: "input", list: "=lstYNNA", width: 11, help: "Y received, N outstanding, N/A not applicable, blank pending. Grey rows are set automatically." },
      { name: "Document", kind: "macro", width: 60, wrap: true },
      {
        name: "Requirement",
        kind: "calc",
        f: `=LET(k,${R("Key")},rw,XLOOKUP(${R("Form")}&"|"&k,${T("tblFormDocs", "Form Key")},${T("tblFormDocs", "Required When")},"")&"",IF(k=${q(PAYMENT_EVIDENCE_KEY)},"Automatic: ticked when Finance confirms the fee",IF(OR(rw="",rw="0"),"Required","Applies unless “"&XLOOKUP(rw,${T("tblConditions", "Condition")},${T("tblConditions", "Question")},rw)&"” is N")))`,
        width: 40,
        wrap: true,
      },
      {
        name: "Status",
        kind: "calc",
        f: `=LET(v,"|"&${dv}&"|",k,"|"&${R("Key")}&"=",p,SEARCH(k,v),IF(ISERROR(p),"(not on the current list)",LET(s,p+LEN(k),MID(v,s,SEARCH("|",v,s)-s))))`,
        width: 12,
      },
      {
        name: "On Current List",
        kind: "calc",
        f: `=${yes(`ISNUMBER(SEARCH("|"&${R("Key")}&"=","|"&${dv}))`)}`,
        width: 9,
      },
      { name: "Remarks", kind: "input", width: 30 },
      { name: "Lookup Key", kind: "calc", f: `=${ref}&"|"&${R("Key")}`, hidden: true },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Evaluation (evaluation.ts)

const AUTO_CHECKS: Record<string, string> = {
  "1.1": `IF(${R("Ack No.")}<>"","Y","N")`,
  "1.3": `IF(${R("Activity Code")}<>"","Y","N")`,
  "1.4": `IF(AND(${R("Activity Code")}="CPT",${R("x Capacity")}<1),"N","Y")`,
  "1.5": `IF(${R("x Duplicate CAC")},"N","Y")`,
  "1.8": `IF(${R("x Days Late")}=0,"Y","N")`,
  "1.9": `IF(${R("x Days Late")}=0,"N/A",IF(${R("x Late Charge")}>0,"Y","N"))`,
  "1.10": `LET(fc,${R("x Form Category")},cc,${R("x Confirmed Category")},IF(fc="","N",IF(cc="","",IF(fc=cc,"Y",IF(AND(cfgWrongForm=${q(WRONG_FORM.ACCEPT)},TRIM(${R("x Confirmed Reason")})<>""),"Y","N")))))`,
  "3.0": `IF(${R("x Documents Complete")},"Y","N")`,
  "4.3": `IF(${R("x Nearest Expiry")}="","N/A",IF(${R("x Nearest Expiry")}-${R("x Effective Date")}<=cfgExpiryWindowDays,"N","Y"))`,
  "5.4": `IF(${R("x Days Late")}=0,"N/A",IF(${R("x Late Charge")}>0,"Y","N"))`,
  "5.5": `IF(${R("x Balance")}<=0,"Y","N")`,
  "7.5": `"N/A"`,
  "7.6": `IF(OR(${R("x Flag Count")}=0,TRIM(${R("Flag Override Reason")})<>""),"Y","N")`,
  "9.1": `IF(${R("x Linked")},"N/A",IF(AND(${R("x Certificate Date")}<>"",${R("Submission Status")}="Registered"),"Y",""))`,
  "9.2": `IF(${R("x Linked")},"N/A",IF(${R("x Registration No.")}<>"","Y",""))`,
};
/** Checks that are N/A unless a condition holds (then entered by hand). */
const NA_UNLESS: Record<string, string> = {
  "1.7": "x MS",
  "2.4": "x Licensed",
  "3.1": "x Documents Outstanding",
  "3.2": "x Non-Company",
  "4.2": "x Licensed",
  "4.9": "x Unlicensed",
  "5.3": "x Waiver",
  "7.1": "x Unlicensed",
  "7.3": "x MS",
  "9.3": "x Not Linked",
  "9.4": "x Not Linked",
  "9.5": "x Not Linked",
};
export { AUTO_CHECKS, NA_UNLESS };

/** Effective values of a contiguous block of checks (evaluation.ts effectiveChecks), then `body`. */
function effective(ids: string[], first: string, last: string, body: string): string {
  const rules = ids.map((id) => (AUTO_CHECKS[id] ? "AUTO" : (NA_UNLESS[id] ?? "")));
  const used = [...new Set(Object.values(NA_UNLESS))];
  const codeOf = (col: string) => String(used.indexOf(col) + 1);
  const arr = `{${rules.map((r) => (r === "AUTO" || r === "" ? `"${r}"` : `"${codeOf(r)}"`)).join(",")}}`;
  const ap = used.reduceRight((acc, col) => `IF(r="${codeOf(col)}",${R(col)},${acc})`, "TRUE");
  return `=LET(v,[@[${first}]:[${last}]],r,${arr},ap,${ap},e,IF(ap,IF(ISNUMBER(XMATCH(v&"",{"Y","N","N/A"})),UPPER(v&""),""),"N/A"),${body})`;
}

function evaluationTable(): TableSpec {
  const decIds = decisionChecks.map((c) => c.id);
  const postIds = postChecks.map((c) => c.id);
  const dec = (body: string) => effective(decIds, DEC_FIRST, DEC_LAST, body);
  const rr = R("Reg Row");
  const reg = (c: string, kind: "text" | "num" | "date" | "bool" = "text"): string => {
    const v = `INDEX(${T(REG, c)},${rr})`;
    if (kind === "num") return `=IF(${rr}=0,0,N(${v}))`;
    if (kind === "date") return `=IF(${rr}=0,"",LET(v,${v}&"",IF(v="","",--v)))`;
    if (kind === "bool") return `=IF(${rr}=0,FALSE,${v}="Yes")`;
    return `=IF(${rr}=0,"",${v}&"")`;
  };
  const hidden = (name: string, f: string, fmt?: string): ColumnSpec => ({ name, kind: "calc", f, hidden: true, fmt });
  const same = (a: string, b: string) => `AND(TRIM(${a})<>"",LOWER(TRIM(${a}))=LOWER(TRIM(${b})))`;
  const sig = (n: string) => `OR(TRIM(${n})="",TRIM(${n})="[Name]")`;

  const blockers = `=LET(fl,${R("x Flag Count")},ao,${R("Approving Officer")},eo,${R("Evaluating Officer")},rs,${R("Reviewing Supervisor")},TEXTJOIN(CHAR(10),TRUE,
IF(${R("x Closed")},"Submission is closed ("&${R("Submission Status")}&")",""),
IF(${R("x Gate Cleared")},"",${R("x Gate Reason")}),
IF(TRIM(eo)="","No evaluating officer assigned",""),
IF(TRIM(rs)="","No reviewing supervisor assigned",""),
IF(TRIM(ao)="","No approving officer assigned",""),
IF(${R("x Complete")},"","Submission is not complete (documents or fees outstanding)"),
IF(${R("Failed")}>0,${R("Failed")}&" evaluation check(s) failed",""),
IF(${R("Pending")}>0,${R("Pending")}&" evaluation check(s) pending",""),
IF(OR(${R("Category")}="",${R("Activity Code")}=""),"Category or activity code cannot be determined",""),
IF(fl=0,"",IF(cfgFlagsBlockApproval="Y",fl&" unresolved data flag(s): "&${R("x Flags")},IF(TRIM(${R("Flag Override Reason")})="",fl&" unresolved data flag(s) with no written override reason: "&${R("x Flags")},""))),
IF(${same("ao", "eo")},"The approving officer cannot be the evaluating officer",""),
IF(${same("ao", "rs")},"The approving officer cannot be the reviewing supervisor",""),
IF(${same("ao", R("x Created By"))},"The approving officer cannot be the user who created the submission",""),
IF(${same("rs", "eo")},"The reviewing supervisor cannot be the evaluating officer",""),
IF(${R("x Linked")},IF(${R("x Linked Row")}="","Not linked to a registered submission",IF(${R("x Linked Status")}<>"Registered","The linked registration "&${R("x Linked Reg No")}&" is "&${R("x Linked Status")}&", not Registered","")),IF(OR(${sig("cfgChairName")},${sig("cfgCommName")}),"Certificate signatory names are not set in Settings",""))))`.replace(/\n/g, "");

  const rec = `=LET(ss,${R("Submission Status")},dd,${R("x Deficiency Due")},det,${R("x Determination Due")},lapse,IF(AND(ss=${q(S.DEFICIENCY)},dd<>""),AsOfDate>dd,FALSE),prov,IF(AND(det<>"",${R("Final Decision")}=""),AsOfDate>det,FALSE),IF(OR(${R("1.3")}="N",${R("1.4")}="N"),${q(FINAL_DECISION.REDIRECT)},IF(AND(ss=${q(S.AWAITING)},NOT(${R("x Gate Cleared")})),"Awaiting Finance confirmation",IF(lapse,${q(FINAL_DECISION.LAPSE)},IF(prov,${q(FINAL_DECISION.PROVISIONAL)},IF(${R("Failed")}>0,${q(FINAL_DECISION.DEFICIENCY)},IF(${R("Pending")}>0,"Evaluation in progress",IF(${R("x Linked")},${q(FINAL_DECISION.APPLY)},${q(FINAL_DECISION.REGISTER)}))))))))`;

  const checkCols: ColumnSpec[] = seed.evaluation_checks.map((c) =>
    AUTO_CHECKS[c.id]
      ? { name: c.id, kind: "calc", f: `=${AUTO_CHECKS[c.id]}`, width: 5 }
      : { name: c.id, kind: "input", list: "=lstYNNA", width: 5, help: c.text.slice(0, 250) },
  );

  return {
    name: "tblEvaluation",
    anchor: "A8",
    capacity: 2000,
    groups: [
      { title: "SUBMISSION", from: "Ack No.", to: "Submission Status" },
      { title: "ASSIGNMENT", from: "Evaluating Officer", to: "Flag Override Reason" },
      { title: "RESULT AND DECISION", from: "Satisfied", to: "Evaluation Remarks" },
      ...[...new Set(seed.evaluation_checks.map((c) => c.stage))].map((stage) => {
        const ids = seed.evaluation_checks.filter((c) => c.stage === stage).map((c) => c.id);
        return { title: stage, from: ids[0]!, to: ids.at(-1)! };
      }),
    ],
    aboveHeader: [
      {
        offset: 1,
        height: 90,
        values: Object.fromEntries(seed.evaluation_checks.map((c) => [c.id, c.text])),
      },
    ],
    columns: [
      { name: "Ack No.", kind: "macro", width: 22 },
      { name: "Registered Name", kind: "calc", f: reg("Registered Name"), width: 26 },
      { name: "Category", kind: "calc", f: reg("Category Applied"), width: 8 },
      { name: "Activity Code", kind: "calc", f: reg("Primary Code"), width: 8 },
      { name: "Submission Status", kind: "calc", f: reg("Status"), width: 22 },
      { name: "Evaluating Officer", kind: "input", list: "=lstEvaluators", width: 18 },
      { name: "Reviewing Supervisor", kind: "input", list: "=lstSupervisors", width: 18 },
      { name: "Approving Officer", kind: "input", list: "=lstApprovers", width: 18 },
      { name: "Date Evaluation Started", kind: "macro", fmt: FMT.date, width: 12 },
      { name: "Flag Override Reason", kind: "input", width: 24, help: "Approver's written reason for approving despite data flags (when Settings allow an override)." },
      { name: "Satisfied", kind: "calc", f: dec(`SUM(--(e="Y"))`), fmt: FMT.int, width: 7 },
      { name: "Failed", kind: "calc", f: dec(`SUM(--(e="N"))`), fmt: FMT.int, width: 7 },
      { name: "N/A", kind: "calc", f: dec(`SUM(--(e="N/A"))`), fmt: FMT.int, width: 7 },
      { name: "Pending", kind: "calc", f: dec(`SUM(--(e=""))`), fmt: FMT.int, width: 7 },
      { name: "Progress", kind: "calc", f: `=(${R("Satisfied")}+${R("Failed")}+${R("N/A")})/${decIds.length}`, fmt: "0%", width: 8 },
      {
        name: "Evaluation Status",
        kind: "calc",
        f: `=IF(${R("Final Decision")}<>"","Decided",IF(TRIM(${R("Evaluating Officer")})="","Not assigned",IF(${R("Pending")}>0,"In progress","Ready for decision")))`,
        width: 14,
      },
      { name: "Recommended Outcome", kind: "calc", f: rec, width: 30 },
      { name: "Approval Blockers", kind: "calc", f: blockers, width: 50, wrap: true },
      {
        name: "File Closed",
        kind: "calc",
        f: `=${effective(postIds, POST_FIRST, POST_LAST, `IF(AND((e="Y")+(e="N/A")),"Yes","No")`).slice(1)}`,
        width: 7,
      },
      { name: "Final Decision", kind: "macro", width: 28 },
      { name: "Reasons", kind: "macro", width: 24 },
      { name: "Review Date", kind: "macro", fmt: FMT.date, width: 12 },
      { name: "Approval Date", kind: "macro", fmt: FMT.date, width: 12 },
      { name: "Evaluation Remarks", kind: "input", width: 24 },
      ...checkCols,
      // Lookups from the Register (hidden)
      hidden("Reg Row", `=IF(${R("Ack No.")}="",0,IFERROR(XMATCH(${R("Ack No.")},${T(REG, "Ack No.")}),0))`),
      hidden("x Capacity", reg("Installed Capacity (MW)", "num")),
      hidden("x Licence Status", reg("Licence Status")),
      hidden("x Duplicate CAC", `=IF(${rr}=0,FALSE,INDEX(${T(REG, "DUPLICATE_CAC")},${rr})<>"")`),
      hidden("x Days Late", reg("Days Late", "num")),
      hidden("x Late Charge", reg("Late Charge", "num")),
      hidden("x Balance", reg("Balance", "num")),
      hidden("x Documents Complete", reg("Documents Complete", "bool")),
      hidden("x Complete", reg("Submission Complete", "bool")),
      hidden("x Form Category", reg("Form Category")),
      hidden("x Confirmed Category", reg("Confirmed Category")),
      hidden("x Confirmed Reason", reg("Category Confirmed Reason")),
      hidden("x Nearest Expiry", reg("Nearest Licence Expiry", "date"), FMT.date),
      hidden("x Effective Date", reg("Effective Date Used", "date"), FMT.date),
      hidden("x Flag Count", reg("Flag Count", "num")),
      hidden("x Flags", reg("Flags")),
      hidden("x Certificate Date", reg("Certificate Issue Date", "date"), FMT.date),
      hidden("x Registration No.", reg("Registration No.")),
      hidden("x Gate Cleared", reg("Gate Cleared", "bool")),
      hidden("x Gate Reason", reg("Gate Reason")),
      hidden("x Closed", reg("Closed", "bool")),
      hidden("x Determination Due", reg("Determination Due", "date"), FMT.date),
      hidden("x Deficiency Due", reg("Deficiency Response Due", "date"), FMT.date),
      hidden("x Created By", reg("Created By")),
      hidden("x Linked", `=IF(${rr}=0,FALSE,INDEX(${T(REG, "Filing Code")},${rr})<>"NEW")`),
      hidden("x Not Linked", `=NOT(${R("x Linked")})`),
      hidden("x Linked Row", reg("Linked Row")),
      hidden("x Linked Status", reg("Linked Status")),
      hidden("x Linked Reg No", `=IF(${rr}=0,"",TRIM(INDEX(${T(REG, "Linked Registration No.")},${rr})&""))`),
      hidden("x MS", `=OR(${R("Activity Code")}="MSL",${R("x Licence Status")}="NERC licence (multi-State)")`),
      hidden("x Licensed", `=${R("x Licence Status")}<>"Unlicensed"`),
      hidden("x Unlicensed", `=${R("x Licence Status")}="Unlicensed"`),
      hidden("x Documents Outstanding", `=NOT(${R("x Documents Complete")})`),
      hidden("x Non-Company", `=LET(t,${reg("Registrant Type").slice(1)},AND(TRIM(t)<>"",t<>"Company"))`),
      hidden("x Waiver", `=${reg("Approved Waiver", "num").slice(1)}>0`),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Payments, Finance Desk

function paymentsTable(): TableSpec {
  const ref = R("Reference");
  return {
    name: "tblPayments",
    anchor: "A6",
    capacity: 5000,
    columns: [
      { name: "Payment No.", kind: "macro", width: 22 },
      { name: "Date Received", kind: "input", fmt: FMT.date, width: 12 },
      { name: "Reference", kind: "input", width: 24, help: "The Ack No. or OUN No. the payment is for." },
      {
        name: "Registrant",
        kind: "calc",
        f: `=IF(${ref}="","",IFERROR(XLOOKUP(${ref},${T(REG, "Ack No.")},${T(REG, "Registered Name")}),IFERROR(XLOOKUP(${ref},${T("tblOwnUse", "OUN No.")},${T("tblOwnUse", "Name")}),"(not found)")))`,
        width: 26,
      },
      {
        name: "Category",
        kind: "calc",
        f: `=IF(${ref}="","",IFERROR(XLOOKUP(${ref},${T(REG, "Ack No.")},${T(REG, "Category Applied")}),IF(ISNUMBER(XMATCH(${ref},${T("tblOwnUse", "OUN No.")})),"I","")))`,
        width: 8,
      },
      { name: "Purpose", kind: "input", list: "=lstPaymentPurpose", width: 18 },
      { name: "Channel", kind: "input", list: "=lstPaymentChannel", width: 12 },
      { name: "Amount", kind: "input", fmt: FMT.money, width: 14 },
      { name: "RRR / Bank Reference", kind: "input", width: 20 },
      { name: "Recorded By", kind: "macro", width: 16 },
      { name: "Recorded On", kind: "macro", fmt: FMT.datetime, width: 15 },
      { name: "Finance Status", kind: "macro", width: 10 },
      { name: "Verified with Bank", kind: "macro", width: 8 },
      { name: "Decided By", kind: "macro", width: 16 },
      { name: "Decided On", kind: "macro", fmt: FMT.datetime, width: 15 },
      { name: "Finance Remarks", kind: "macro", width: 22 },
      { name: "Reversed", kind: "macro", width: 8 },
      { name: "Reversed By", kind: "macro", width: 16 },
      { name: "Reversed On", kind: "macro", fmt: FMT.datetime, width: 15 },
      { name: "Reversal Reason", kind: "macro", width: 22 },
      {
        name: "Counts as Paid",
        kind: "calc",
        f: `=${yes(`AND(${R("Finance Status")}="Confirmed",${R("Reversed")}<>"Y")`)}`,
        width: 8,
      },
      {
        name: "With Finance",
        kind: "calc",
        f: `=${yes(`AND(${R("Payment No.")}<>"",OR(${R("Finance Status")}="Pending",${R("Finance Status")}=""),${R("Reversed")}<>"Y")`)}`,
        width: 8,
      },
      {
        name: "Days Waiting",
        kind: "calc",
        f: `=IF(OR(${R("With Finance")}="No",${R("Recorded On")}=""),"",MAX(0,AsOfDate-INT(${R("Recorded On")})))`,
        fmt: FMT.int,
        width: 7,
      },
      {
        name: "Checks",
        kind: "calc",
        f: `=TEXTJOIN("; ",TRUE,IF(AND(${ref}<>"",${R("Registrant")}="(not found)"),"Reference is not an Ack No. or OUN No.",""),IF(TRIM(${R("RRR / Bank Reference")})="","",IF(SUM(--(TRIM(${T("tblPayments", "RRR / Bank Reference")})=TRIM(${R("RRR / Bank Reference")})))>1,"Duplicate RRR / bank reference","")))`,
        width: 30,
      },
    ],
  };
}

function financeDeskSheet(): SheetSpec {
  const cond = `${T("tblPayments", "With Finance")}="Yes"`;
  const sortKey = `${T("tblPayments", "Recorded On")}`;
  const col = (c: string) => `=IFERROR(SORTBY(FILTER(${T("tblPayments", c)},${cond}),FILTER(${sortKey},${cond}),1,FILTER(${T("tblPayments", "Payment No.")},${cond}),1),"")`;
  const headers = ["Payment No.", "Date Received", "Reference", "Registrant", "Amount", "RRR / Bank Reference", "Recorded By", "Recorded On", "Days Waiting"];
  const letters = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
  const fmts: Record<string, string> = { "Date Received": FMT.date, Amount: FMT.money, "Recorded On": FMT.datetime };
  return {
    name: "Finance Desk",
    tab: "gold",
    cells: [
      { addr: "A1", value: "Finance Desk: payments waiting for confirmation (oldest first)", bold: true, size: 16, color: "brand" },
      {
        addr: "A2",
        value:
          "Select a row and use Confirm or Reject. Confirming needs a bank/Remita check. The officer who recorded a payment cannot confirm it. Only confirmed payments count (SPEC §4.12).",
        italic: true,
      },
      { addr: "K4", value: "Waiting", bold: true },
      { addr: "L4", f: `=COUNTIFS(${cond.replace('="Yes"', ',"Yes"')})`, fmt: FMT.int },
      { addr: "K5", value: "Amount", bold: true },
      { addr: "L5", f: `=SUMIFS(${T("tblPayments", "Amount")},${T("tblPayments", "With Finance")},"Yes")`, fmt: FMT.money },
      ...headers.map((h, i) => ({ addr: `${letters[i]}6`, value: h, bold: true, fill: "header" })),
      ...headers.map((h, i) => ({ addr: `${letters[i]}7`, f: col(h), fmt: fmts[h] })),
    ],
    widths: { A: 22, B: 12, C: 24, D: 28, E: 14, F: 20, G: 16, H: 16, I: 8, K: 10, L: 16 },
    buttons: [
      { cell: "N2", caption: "Confirm selected payment", macro: "ConfirmSelectedPayment", width: 170 },
      { cell: "N4", caption: "Reject selected payment", macro: "RejectSelectedPayment", width: 170 },
    ],
    freeze: "A7",
    protect: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Own-Use (REG-01I, own-use.ts)

function ownUseTable(): TableSpec {
  const kw = [1, 2, 3, 4].map((i) => R(`Unit ${i} kW`));
  const cap = R("Installed Capacity (kW)");
  const flagsOU = ["OU_MISSING_REQUIRED", "OU_DUPLICATE_SITE", "OU_CAC_ON_REGISTER", "OU_FEE_UNPAID", "OU_PRICING_OUT_OF_DATE"];
  const hasSnap = `(${R("Priced Threshold (kW)")}<>"")`;
  const oneUnit = (i: number): ColumnSpec[] => [
    { name: `Unit ${i} Make/Model`, kind: "input", width: 16 },
    { name: `Unit ${i} kW`, kind: "input", fmt: FMT.num, width: 8 },
    { name: `Unit ${i} Fuel`, kind: "input", list: "=lstFuel", width: 11 },
    { name: `Unit ${i} Avg MWh`, kind: "input", fmt: FMT.num, width: 8 },
  ];
  const docs = (result: string) =>
    `=LET(ref,${R("OUN No.")},fm,${T("tblFormDocs", "Form")},keys,FILTER(${T("tblFormDocs", "Key")},fm="REG-01I"),txt,FILTER(${T("tblFormDocs", "Document")},fm="REG-01I"),d,IF(ref="","",FILTER(tblDocuments[[Key]:[Received (Y/N/N/A)]],${T("tblDocuments", "Reference")}=ref,"")),ent,IFERROR(XLOOKUP(keys,INDEX(d,0,1),INDEX(d,0,2),""),""),entv,IF(ISNUMBER(XMATCH(ent&"",{"Y","N","N/A"})),UPPER(ent&""),""),eff,IF(keys=${q(PAYMENT_EVIDENCE_KEY)},${R("Evidence of Payment")},entv),${result})`;
  const ouFlag = (name: string, f: string): ColumnSpec => ({ name, kind: "calc", f: `=${f}`, hidden: true });
  const sig = (n: string) => `OR(TRIM(${n})="",TRIM(${n})="[Name]")`;
  return {
    name: "tblOwnUse",
    anchor: "A6",
    capacity: 2000,
    groups: [
      { title: "NOTIFICATION (Form REG-01I, one per site)", from: "OUN No.", to: "Email" },
      { title: "GENERATOR UNITS (capacity = sum of the units)", from: "Unit 1 Make/Model", to: "Unit 4 Avg MWh" },
      { title: "SET BY BUTTONS", from: "Created By", to: "Registered By" },
      { title: "CALCULATED", from: "Units", to: "Registration Blockers" },
    ],
    columns: [
      { name: "OUN No.", kind: "macro", width: 22 },
      { name: "Name", kind: "input", width: 26 },
      { name: "Date Filed", kind: "input", fmt: FMT.date, width: 12 },
      { name: "CAC No.", kind: "input", width: 12 },
      { name: "Site Address", kind: "input", width: 26 },
      { name: "LGA", kind: "input", list: "=lstLGA", width: 15 },
      { name: "Nature of Business", kind: "input", width: 20 },
      { name: "Grid Connected (Y/N)", kind: "input", list: "=lstYN", width: 9 },
      { name: "Distribution Licensee", kind: "input", width: 14 },
      { name: "Contact Person", kind: "input", width: 16 },
      { name: "Phone", kind: "input", width: 14 },
      { name: "Email", kind: "input", width: 20 },
      ...[1, 2, 3, 4].flatMap(oneUnit),
      { name: "Flag Override Reason", kind: "input", width: 20 },
      { name: "Remarks", kind: "input", width: 20 },
      { name: "Created By", kind: "macro", width: 14 },
      { name: "Priced Fee", kind: "macro", fmt: FMT.money, width: 12 },
      { name: "Priced Threshold (kW)", kind: "macro", fmt: FMT.num, width: 9 },
      { name: "Registration No.", kind: "macro", width: 26 },
      { name: "Certificate Issue Date", kind: "macro", fmt: FMT.date, width: 12 },
      { name: "Registered By", kind: "macro", width: 14 },
      { name: "Units", kind: "calc", f: `=COUNT(${kw.join(",")})`, fmt: FMT.int, width: 6 },
      {
        name: "Installed Capacity (kW)",
        kind: "calc",
        f: `=IF(${R("Units")}=0,"",LET(u,CHOOSE({1,2,3,4},${kw.join(",")}),SUM(IF(ISNUMBER(u),ROUND(u*1000,0),0))/1000))`,
        fmt: FMT.num,
        width: 10,
      },
      {
        name: "Current Fee",
        kind: "calc",
        f: `=IF(${cap}="","",IF(AND(${cap}<1000,${cap}>=cfgOwnUseThresholdKw),XLOOKUP("I",${T("tblFees", "Category")},${T("tblFees", "Registration Fee")},0),0))`,
        fmt: FMT.money,
        hidden: true,
      },
      {
        name: "Threshold Used",
        kind: "calc",
        f: `=IF(${hasSnap},${R("Priced Threshold (kW)")},cfgOwnUseThresholdKw)`,
        hidden: true,
      },
      {
        name: "Eligibility",
        kind: "calc",
        f: `=IF(${cap}="","",IF(${cap}>=1000,"Register as operator",IF(${cap}<${R("Threshold Used")},"Not required","Notification required")))`,
        width: 18,
      },
      {
        name: "Fee Due",
        kind: "calc",
        f: `=IF(${hasSnap},N(${R("Priced Fee")}),N(${R("Current Fee")}))`,
        fmt: FMT.money,
        width: 12,
      },
      {
        name: "Amount Paid",
        kind: "calc",
        f: `=IF(${R("OUN No.")}="",0,SUMIFS(${T("tblPayments", "Amount")},${T("tblPayments", "Reference")},${R("OUN No.")},${T("tblPayments", "Counts as Paid")},"Yes"))`,
        fmt: FMT.money,
        width: 12,
      },
      { name: "Balance", kind: "calc", f: `=ROUND(${R("Fee Due")}-${R("Amount Paid")},2)`, fmt: FMT.money, width: 12 },
      {
        name: "Payment Status",
        kind: "calc",
        f: `=IF(${R("Fee Due")}=0,"Nil",IF(${R("Balance")}<=0,"Paid",IF(${R("Amount Paid")}>0,"Part-paid","Unpaid")))`,
        width: 9,
      },
      {
        name: "Filed After Deadline",
        kind: "calc",
        f: `=IF(${R("Date Filed")}="","No",IF(${R("Date Filed")}>cfgExistingDeadline,"Yes","No"))`,
        width: 8,
      },
      {
        name: "Evidence of Payment",
        kind: "calc",
        f: `=IF(${R("Fee Due")}=0,"N/A",IF(${R("Amount Paid")}>=${R("Fee Due")},"Y",""))`,
        hidden: true,
      },
      { name: "Document Values", kind: "calc", f: docs(`TEXTJOIN("|",FALSE,keys&"="&eff)`), hidden: true },
      { name: "Documents Listed", kind: "calc", f: countIn("Document Values", "="), hidden: true },
      { name: "Documents Outstanding", kind: "calc", f: countIn("Document Values", "=N|"), width: 8 },
      { name: "Documents Pending", kind: "calc", f: countIn("Document Values", "=|"), width: 8 },
      {
        name: "Documents Complete",
        kind: "calc",
        f: `=${yes(`AND(${R("Documents Listed")}>0,${R("Documents Outstanding")}=0,${R("Documents Pending")}=0)`)}`,
        width: 8,
      },
      {
        name: "Outstanding Documents",
        kind: "calc",
        f: docs(`TEXTJOIN("; ",TRUE,FILTER(txt,(eff<>"Y")*(eff<>"N/A"),""))`),
        width: 28,
      },
      { name: "CAC Norm", kind: "calc", f: `=LOWER(TRIM(${R("CAC No.")}))`, hidden: true },
      { name: "Site Norm", kind: "calc", f: `=LOWER(TRIM(${R("Site Address")}))`, hidden: true },
      ouFlag(
        "OU_MISSING_REQUIRED",
        `LET(m,TEXTJOIN(", ",TRUE,IF(TRIM(${R("Name")})="","name",""),IF(${R("Date Filed")}="","date filed",""),IF(TRIM(${R("LGA")})="","LGA",""),IF(${cap}="","generator units","")),IF(m="","","Missing required field: "&m))`,
      ),
      ouFlag(
        "OU_DUPLICATE_SITE",
        `IF(OR(${R("CAC Norm")}="",${R("Site Norm")}=""),"",IF(SUM((${T("tblOwnUse", "CAC Norm")}=${R("CAC Norm")})*(${T("tblOwnUse", "Site Norm")}=${R("Site Norm")})*(ROW(${T("tblOwnUse", "CAC Norm")})<>ROW()))>0,"Another own-use notification has the same CAC number and site address",""))`,
      ),
      ouFlag(
        "OU_CAC_ON_REGISTER",
        `IF(${R("CAC Norm")}="","",IF(SUM(--(${T(REG, "CAC Norm")}=${R("CAC Norm")}))>0,"CAC number is also on the Register",""))`,
      ),
      ouFlag("OU_FEE_UNPAID", `IF(${R("Amount Paid")}<${R("Fee Due")},"Fee not fully paid","")`),
      ouFlag(
        "OU_PRICING_OUT_OF_DATE",
        `IF(OR(NOT(${hasSnap}),${R("Current Fee")}=""),"",LET(d,TEXTJOIN("; ",TRUE,IF(N(${R("Priced Fee")})<>${R("Current Fee")},"fee "&${NAIRA(`N(${R("Priced Fee")})`)}&" → "&${NAIRA(R("Current Fee"))},""),IF(${R("Priced Threshold (kW)")}<>cfgOwnUseThresholdKw,"threshold "&${R("Priced Threshold (kW)")}&" kW → "&cfgOwnUseThresholdKw&" kW","")),IF(d="","","Saved pricing differs from current rules ("&d&") – an admin may recalculate")))`,
      ),
      { name: "Flag Count", kind: "calc", f: `=COUNTIF([@[${flagsOU[0]}]:[${flagsOU.at(-1)}]],"?*")`, fmt: FMT.int, width: 6 },
      { name: "Flags", kind: "calc", f: `=TEXTJOIN("; ",TRUE,[@[${flagsOU[0]}]:[${flagsOU.at(-1)}]])`, width: 36 },
      {
        name: "Registration Blockers",
        kind: "calc",
        f: `=LET(fl,TEXTJOIN("; ",TRUE,${R("OU_MISSING_REQUIRED")},${R("OU_DUPLICATE_SITE")},${R("OU_CAC_ON_REGISTER")},${R("OU_PRICING_OUT_OF_DATE")}),n,SUM(--(CHOOSE({1,2,3,4},${R("OU_MISSING_REQUIRED")},${R("OU_DUPLICATE_SITE")},${R("OU_CAC_ON_REGISTER")},${R("OU_PRICING_OUT_OF_DATE")})<>"")),TEXTJOIN(CHAR(10),TRUE,IF(cfgOwnUseCertificate="Y","","Own-use certificates are switched off in Settings"),IF(${R("Registration No.")}<>"","Already registered as "&${R("Registration No.")},""),IF(${R("Eligibility")}="Notification required","","Capacity "&N(${cap})&" kW: "&IF(${R("Eligibility")}="","no generator units recorded",${R("Eligibility")})),IF(${R("Amount Paid")}<${R("Fee Due")},"Fee not confirmed by Finance: "&${NAIRA(R("Amount Paid"))}&" of "&${NAIRA(R("Fee Due"))},""),IF(${R("Documents Complete")}="Yes","","Documents outstanding: "&${R("Outstanding Documents")}),IF(n=0,"",IF(cfgFlagsBlockApproval="Y",n&" unresolved data flag(s): "&fl,IF(TRIM(${R("Flag Override Reason")})="",n&" unresolved data flag(s) with no written override reason: "&fl,""))),IF(OR(${sig("cfgChairName")},${sig("cfgCommName")}),"Certificate signatory names are not set in Settings","")))`,
        width: 40,
        wrap: true,
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Dashboard (dashboard.ts)

function dashboardSheet(): SheetSpec {
  const RG = (c: string) => T(REG, c);
  const OU = (c: string) => T("tblOwnUse", c);
  const saved = `${RG("Ack No.")},"?*"`;
  const live = `${RG("Status")},"<>Refused",${RG("Status")},"<>Lapsed",${RG("Status")},"<>Cancelled"`;
  const cells: CellSpec[] = [
    { addr: "A1", value: "OGSERC Registration Dashboard", bold: true, size: 18, color: "brand" },
    { addr: "A2", f: `="As of "&${FD("AsOfDate")}&IF(cfgTodayOverride<>"","  (TODAY OVERRIDE IS ON: Settings)","")&"  ·  The web app is the system of record."`, italic: true },
  ];
  let row = 4;
  const tile = (label: string, f: string, name: string, fmt: string = FMT.int) => {
    cells.push({ addr: `A${row}`, value: label });
    cells.push({ addr: `B${row}`, f, name, fmt, bold: true, align: "right" });
    row++;
  };
  const head = (label: string) => {
    cells.push({ addr: `A${row}`, value: label, bold: true, color: "white", fill: "brand", merge: `A${row}:B${row}` });
    row++;
  };
  head("Key dates");
  tile("Effective Date", "=cfgEffectiveDate", "dashEffectiveDate", FMT.date);
  tile("Registration deadline", "=cfgExistingDeadline", "dashDeadline", FMT.date);
  tile("Days to deadline", "=cfgExistingDeadline-AsOfDate", "dashDaysToDeadline");
  row++;
  head("Submissions");
  tile("Total", `=COUNTIFS(${saved})`, "dashTotal");
  tile("Awaiting payment", `=COUNTIFS(${saved},${RG("Status")},${q(S.AWAITING)})`, "dashAwaiting");
  tile("Registered", `=COUNTIFS(${saved},${RG("Status")},"Registered")`, "dashRegistered");
  tile("Provisionally registered", `=COUNTIFS(${saved},${RG("Status")},${q(S.PROVISIONAL)})`, "dashProvisional");
  tile("In progress", `=COUNTIFS(${saved},${RG("Status")},${q(S.RECEIVED)})+COUNTIFS(${saved},${RG("Status")},${q(S.DEFICIENCY)})`, "dashInProgress");
  tile("Closed (refused, lapsed, cancelled)", `=SUM(COUNTIFS(${saved},${RG("Status")},{"Refused","Lapsed","Cancelled"}))`, "dashClosed");
  tile("Own-use notifications", `=COUNTIFS(${OU("OUN No.")},"?*")`, "dashOwnUse");
  tile("Late submissions", `=COUNTIFS(${saved},${RG("Days Late")},">0")`, "dashLate");
  row++;
  head("Workflow");
  tile("Overdue (SLA red)", `=COUNTIFS(${saved},${RG("SLA")},"Red")`, "dashRed");
  tile("Due within the warning window (amber)", `=COUNTIFS(${saved},${RG("SLA")},"Amber")`, "dashAmber");
  tile("Records with flags", `=COUNTIFS(${saved},${RG("Flag Count")},">0")`, "dashFlagged");
  tile("Average days in queue (open)", `=IFERROR(AVERAGEIFS(${RG("Days in Queue")},${saved},${RG("Closed")},"No"),"")`, "dashAvgDays", "0.0");
  row++;
  head("Evaluation (released submissions)");
  const evalCount = (s: string) =>
    `=COUNTIFS(${T("tblEvaluation", "Evaluation Status")},${q(s)},${T("tblEvaluation", "Submission Status")},"<>"&${q(S.AWAITING)},${T("tblEvaluation", "Ack No.")},"?*")`;
  tile("Not assigned", evalCount("Not assigned"), "dashEvalNotAssigned");
  tile("In progress", evalCount("In progress"), "dashEvalInProgress");
  tile("Ready for decision", evalCount("Ready for decision"), "dashEvalReady");
  tile("Decided", evalCount("Decided"), "dashEvalDecided");
  row++;
  head("Money (₦)");
  tile("Total due (fees + late charges, live records)", `=SUMIFS(${RG("Total Due")},${saved},${live})+SUMIFS(${OU("Fee Due")},${OU("OUN No.")},"?*")`, "dashTotalDue", FMT.money);
  tile("Collected (Finance-confirmed)", `=SUMIFS(${T("tblPayments", "Amount")},${T("tblPayments", "Counts as Paid")},"Yes")`, "dashCollected", FMT.money);
  tile("With Finance (recorded, not confirmed)", `=SUMIFS(${T("tblPayments", "Amount")},${T("tblPayments", "With Finance")},"Yes")`, "dashWithFinance", FMT.money);
  tile("Payments with Finance", `=COUNTIFS(${T("tblPayments", "With Finance")},"Yes")`, "dashWithFinanceCount");
  tile("Outstanding", `=SUMIFS(${RG("Balance")},${saved},${live},${RG("Balance")},">0")+SUMIFS(${OU("Balance")},${OU("OUN No.")},"?*",${OU("Balance")},">0")`, "dashOutstanding", FMT.money);
  tile("Collection rate", `=IF(dashTotalDue>0,(dashTotalDue-dashOutstanding)/dashTotalDue,"")`, "dashCollectionRate", FMT.pct);
  tile("Unpaid on closed submissions", `=SUM(SUMIFS(${RG("Balance")},${saved},${RG("Status")},{"Refused","Lapsed","Cancelled"},${RG("Balance")},">0"))`, "dashUnpaidClosed", FMT.money);
  tile("Overpaid / credits", `=-SUMIFS(${RG("Balance")},${saved},${RG("Balance")},"<0")-SUMIFS(${OU("Balance")},${OU("OUN No.")},"?*",${OU("Balance")},"<0")`, "dashOverpaid", FMT.money);

  // By category (D..L)
  const c0 = 4;
  cells.push({ addr: `D${c0}`, value: "By Schedule 3 category", bold: true, color: "white", fill: "brand", merge: `D${c0}:L${c0}` });
  const catHeads = ["Cat.", "Description", "Submissions", "Registered", "Fees", "Late charges", "Waivers", "Collected", "Outstanding"];
  const L = ["D", "E", "F", "G", "H", "I", "J", "K", "L"];
  catHeads.forEach((h, i) => cells.push({ addr: `${L[i]}${c0 + 1}`, value: h, bold: true, fill: "header" }));
  seed.schedule3_fees.forEach((f, i) => {
    const r = c0 + 2 + i;
    const cat = `$D${r}`;
    const by = `${saved},${RG("Category Applied")},${cat}`;
    cells.push({ addr: `D${r}`, value: f.category, bold: true });
    cells.push({ addr: `E${r}`, f: `=XLOOKUP(${cat},${T("tblFees", "Category")},${T("tblFees", "Description")},"")` });
    if (f.category === "I") {
      cells.push({ addr: `F${r}`, f: `=COUNTIFS(${OU("OUN No.")},"?*")`, fmt: FMT.int });
      cells.push({ addr: `G${r}`, value: "—", align: "right" });
      cells.push({ addr: `H${r}`, f: `=SUM(${OU("Fee Due")})`, fmt: FMT.money });
      cells.push({ addr: `I${r}`, value: 0, fmt: FMT.money });
      cells.push({ addr: `J${r}`, value: 0, fmt: FMT.money });
      cells.push({ addr: `K${r}`, f: `=SUM(${OU("Amount Paid")})`, fmt: FMT.money });
      cells.push({ addr: `L${r}`, f: `=SUMIFS(${OU("Balance")},${OU("Balance")},">0")`, fmt: FMT.money });
    } else {
      cells.push({ addr: `F${r}`, f: `=COUNTIFS(${by})`, fmt: FMT.int });
      cells.push({ addr: `G${r}`, f: `=COUNTIFS(${by},${RG("Status")},"Registered")`, fmt: FMT.int });
      cells.push({ addr: `H${r}`, f: `=SUMIFS(${RG("Registration Fee")},${by})`, fmt: FMT.money });
      cells.push({ addr: `I${r}`, f: `=SUMIFS(${RG("Late Charge")},${by})`, fmt: FMT.money });
      cells.push({ addr: `J${r}`, f: `=SUMIFS(${RG("Approved Waiver")},${by})`, fmt: FMT.money });
      cells.push({ addr: `K${r}`, f: `=SUMIFS(${RG("Amount Paid")},${by})`, fmt: FMT.money });
      cells.push({ addr: `L${r}`, f: `=SUMIFS(${RG("Balance")},${by},${live},${RG("Balance")},">0")`, fmt: FMT.money });
    }
  });
  // By status, by activity, by LGA
  let r2 = c0 + 2 + seed.schedule3_fees.length + 1;
  cells.push({ addr: `D${r2}`, value: "By status", bold: true, color: "white", fill: "brand", merge: `D${r2}:F${r2}` });
  cells.push({ addr: `H${r2}`, value: "By primary activity", bold: true, color: "white", fill: "brand", merge: `H${r2}:J${r2}` });
  cells.push({ addr: `K${r2}`, value: "By principal LGA", bold: true, color: "white", fill: "brand", merge: `K${r2}:M${r2}` });
  r2++;
  cells.push({ addr: `K${r2}`, value: "LGA", bold: true, fill: "header" });
  cells.push({ addr: `L${r2}`, value: "Registrants", bold: true, fill: "header" });
  cells.push({ addr: `M${r2}`, value: "Own-use", bold: true, fill: "header" });
  STATUSES.forEach((s, i) => {
    cells.push({ addr: `D${r2 + 1 + i}`, value: s, merge: `D${r2 + 1 + i}:E${r2 + 1 + i}` });
    cells.push({ addr: `F${r2 + 1 + i}`, f: `=COUNTIFS(${saved},${RG("Status")},$D${r2 + 1 + i})`, fmt: FMT.int });
  });
  seed.activities.forEach((a, i) => {
    cells.push({ addr: `H${r2 + 1 + i}`, value: a.code, bold: true });
    cells.push({ addr: `I${r2 + 1 + i}`, value: a.name });
    cells.push({ addr: `J${r2 + 1 + i}`, f: `=COUNTIFS(${saved},${RG("Primary Code")},$H${r2 + 1 + i})`, fmt: FMT.int });
  });
  seed.lgas.forEach((l, i) => {
    cells.push({ addr: `K${r2 + 1 + i}`, value: l });
    cells.push({ addr: `L${r2 + 1 + i}`, f: `=COUNTIFS(${saved},${RG("Principal LGA")},$K${r2 + 1 + i})`, fmt: FMT.int });
    cells.push({ addr: `M${r2 + 1 + i}`, f: `=COUNTIFS(${OU("OUN No.")},"?*",${OU("LGA")},$K${r2 + 1 + i})`, fmt: FMT.int });
  });
  // Monthly intake (12 months from the Effective Date month, then rolling)
  let r3 = Math.max(row, r2 + 1 + seed.lgas.length) + 2;
  cells.push({ addr: `A${r3}`, value: "Monthly (12 months from the Effective Date month; then the last 12 months)", bold: true, color: "white", fill: "brand", merge: `A${r3}:E${r3}` });
  r3++;
  ["Month", "Submissions", "Registered", "Collected (₦)"].forEach((h, i) =>
    cells.push({ addr: `${["A", "B", "C", "D"][i]}${r3}`, value: h, bold: true, fill: "header" }),
  );
  const start = `LET(s,(YEAR(cfgEffectiveDate)*12+MONTH(cfgEffectiveDate)-1),n,(YEAR(AsOfDate)*12+MONTH(AsOfDate)-1),IF(n>s+11,n-11,s))`;
  for (let i = 0; i < 12; i++) {
    const rr = r3 + 1 + i;
    cells.push({ addr: `A${rr}`, f: `=LET(k,${start}+${i},DATE(INT(k/12),MOD(k,12)+1,1))`, fmt: "mmm yyyy" });
    const between = (c: string) => `${c},">="&$A${rr},${c},"<"&EDATE($A${rr},1)`;
    cells.push({ addr: `B${rr}`, f: `=COUNTIFS(${saved},${between(RG("Date Submitted"))})`, fmt: FMT.int });
    cells.push({ addr: `C${rr}`, f: `=COUNTIFS(${saved},${between(RG("Certificate Issue Date"))})`, fmt: FMT.int });
    cells.push({ addr: `D${rr}`, f: `=SUMIFS(${T("tblPayments", "Amount")},${T("tblPayments", "Counts as Paid")},"Yes",${between(T("tblPayments", "Date Received"))})`, fmt: FMT.money });
  }
  // Work queues (dashboard.ts workQueues)
  let r4 = r3 + 15;
  const queue = (title: string, headers: string[], cols: string[], fmts: (string | undefined)[], width: string) => {
    cells.push({ addr: `A${r4}`, value: title, bold: true, color: "white", fill: "brand", merge: `A${r4}:${width}${r4}` });
    r4++;
    headers.forEach((h, i) => cells.push({ addr: `${String.fromCharCode(65 + i)}${r4}`, value: h, bold: true, fill: "header" }));
    r4++;
    cols.forEach((f, i) => cells.push({ addr: `${String.fromCharCode(65 + i)}${r4}`, f, fmt: fmts[i] }));
    r4 += 25;
  };
  const aw = `(${RG("Status")}=${q(S.AWAITING)})`;
  const awDays = `AsOfDate-${RG("Date Submitted")}`;
  const sortAw = (c: string) => `=IFERROR(SORTBY(FILTER(${c},${aw}),FILTER(${awDays},${aw}),-1),"")`;
  queue(
    "Awaiting payment, oldest first",
    ["Ack No.", "Registered Name", "Days since acknowledgement", "Process stage", "Reminder due"],
    [
      sortAw(RG("Ack No.")),
      sortAw(RG("Registered Name")),
      sortAw(awDays),
      sortAw(RG("Process Stage")),
      sortAw(`IF((cfgUnpaidReminderDays<>"")*(${awDays}>=N(cfgUnpaidReminderDays)),"Reminder due","")`),
    ],
    [undefined, undefined, FMT.int, undefined, undefined],
    "E",
  );
  const od = `(${RG("Status")}=${q(S.DEFICIENCY)})*IFERROR(AsOfDate>--${RG("Deficiency Response Due")},FALSE)`;
  const odDays = `IFERROR(AsOfDate-${RG("Deficiency Response Due")},0)`;
  const sortOd = (c: string) => `=IFERROR(SORTBY(FILTER(${c},${od}),FILTER(${odDays},${od}),-1),"")`;
  queue(
    "Overdue deficiency responses (lapse them; never automatic)",
    ["Ack No.", "Registered Name", "Days overdue"],
    [sortOd(RG("Ack No.")), sortOd(RG("Registered Name")), sortOd(odDays)],
    [undefined, undefined, FMT.int],
    "C",
  );
  const EV = (c: string) => T("tblEvaluation", c);
  const ready = `(${EV("Evaluation Status")}="Ready for decision")*(${EV("Submission Status")}<>${q(S.AWAITING)})*(XLOOKUP(${EV("Ack No.")},${RG("Ack No.")},${RG("Closed")},"Yes")="No")`;
  const readyKey = `IFERROR(--XLOOKUP(${EV("Ack No.")},${RG("Ack No.")},${RG("Determination Due")},""),1E+6)`;
  const sortReady = (c: string) => `=IFERROR(SORTBY(FILTER(${c},${ready}),FILTER(${readyKey},${ready}),1),"")`;
  queue(
    "Ready for decision (by determination date)",
    ["Ack No.", "Registered Name", "Recommended outcome"],
    [sortReady(EV("Ack No.")), sortReady(EV("Registered Name")), sortReady(EV("Recommended Outcome"))],
    [undefined, undefined, undefined],
    "C",
  );
  cells.push({ addr: `A${r4}`, value: "My assigned evaluations: type your name →", bold: true });
  cells.push({ addr: `C${r4}`, value: null, input: true, name: "dashMyName" });
  r4++;
  const mine = `(dashMyName<>"")*((${EV("Evaluating Officer")}=dashMyName)+(${EV("Reviewing Supervisor")}=dashMyName)+(${EV("Approving Officer")}=dashMyName)>0)*(${EV("Final Decision")}="")*(${EV("Submission Status")}<>${q(S.AWAITING)})*(XLOOKUP(${EV("Ack No.")},${RG("Ack No.")},${RG("Closed")},"Yes")="No")`;
  ["Ack No.", "Registered Name", "Evaluation status", "Recommended outcome"].forEach((h, i) =>
    cells.push({ addr: `${String.fromCharCode(65 + i)}${r4}`, value: h, bold: true, fill: "header" }),
  );
  r4++;
  [EV("Ack No."), EV("Registered Name"), EV("Evaluation Status"), EV("Recommended Outcome")].forEach((c, i) =>
    cells.push({ addr: `${String.fromCharCode(65 + i)}${r4}`, f: `=IFERROR(FILTER(${c},${mine}),"")` }),
  );

  return {
    name: "Dashboard",
    tab: "gold",
    cells,
    widths: { A: 40, B: 26, C: 16, D: 22, E: 40, F: 12, G: 11, H: 14, I: 30, J: 12, K: 16, L: 14, M: 10 },
    buttons: [{ cell: "N2", caption: "Run daily review now", macro: "DailyReview", width: 160 }],
    protect: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Guide

function guideSheet(): SheetSpec {
  const lines: [string, string, ("h" | "warn" | "b")?][] = [
    ["THE WEB APP IS THE SYSTEM OF RECORD", "This workbook mirrors the app's business rules for use where the app cannot be reached (offline work, a quick estimate, a training session). Anything recorded here must be entered in the web app, which holds the official Register, numbers, payments and audit trail. If the workbook and the app disagree, the app is right.", "warn"],
    ["", ""],
    ["What this workbook cannot enforce", "", "h"],
    ["Logins", "There are no accounts or passwords. The “user” on every record and audit entry is the Office user name of the computer (File › Options › General), which anyone can change."],
    ["Separation of duties", "The buttons compare officer names typed on the Evaluation sheet (approver ≠ evaluator ≠ supervisor ≠ the person who saved it; Finance cannot confirm a payment they recorded). Anyone can type another person's name, so this is a reminder, not a control."],
    ["A tamper-proof audit log", "The Audit Log sheet is written by the buttons and by edits, but anyone with Excel can unprotect the sheet, edit or delete rows, or turn macros off. It is not evidence."],
    ["Locked numbers and dates", "Sheet protection keeps typing out of the generated numbers, statuses and dates, but the protection password is in the macros and can be removed. Numbers are not guaranteed unique across copies of this file."],
    ["One shared record", "Each copy of the file is separate. Two people working on two copies create two registers, with clashing acknowledgement and payment numbers."],
    ["Documents and certificates", "The workbook does not produce the acknowledgement letter, EVAL-01, deficiency notice or CERT-01 certificate. Generate them in the app."],
    ["Category-specific sections", "The detailed sections of Forms REG-01A to K are not in the workbook. Enter only their summary on the Register: the sections not yet complete, and the capacity they state. Enter the document conditions (Y/N) yourself; in the app the sections decide them."],
    ["Limits", "Three other activities, three licences and four generator units per record. TIN format is not checked (the format is not yet confirmed by Finance). Today's date is the computer's date, not Africa/Lagos."],
    ["", ""],
    ["Before first use", "", "h"],
    ["Excel version", "Microsoft 365 or Excel 2021 or later on Windows (the formulas use LET, FILTER, XLOOKUP and TEXTJOIN). Regional settings should use “,” as the thousands separator."],
    ["Enable macros", "Save the file in a trusted folder, open it and click Enable Content. Without macros the buttons do nothing and no numbers are issued."],
    ["Settings", "Check the Effective Date (a placeholder until the Order is gazetted), the policy settings and the signatory names. Put staff names in the Lists sheet (Evaluating Officers, Reviewing Supervisors, Approving Officers) for the drop-downs."],
    ["", ""],
    ["How to use it", "", "h"],
    ["Colours", "Blue headers: enter data. Gold headers: set by the buttons (protected). Green headers: calculated (protected). Grey cells on the Evaluation sheet are N/A automatically."],
    ["1. Intake", "Register › New row, fill the blue cells, then Save submission. It checks the required fields and formats, issues the Ack No., freezes the pricing, sets “Acknowledged - Awaiting Payment”, creates the document checklist and the evaluation row, and writes the audit entry."],
    ["2. Payment", "Payments › New row, enter the payment, then Record payment. It stays Pending until Finance confirms it on the Finance Desk. Only confirmed payments count."],
    ["3. Finance", "Finance Desk › select a payment › Confirm (after checking the bank or Remita) or Reject (with a reason). Confirming the payment that clears the fee releases the submission for evaluation (Received - Under Review)."],
    ["4. Documents", "Documents sheet: mark each item Y, N or N/A. Grey items are automatic: evidence of payment ticks itself once Finance confirms the fee; an item whose condition is N is N/A."],
    ["5. Evaluation", "Evaluation sheet: assign the three officers, answer the manual checks (green columns are automatic), Confirm category, then Mark complete, Issue deficiency, Approve and register, Lapse or Refuse. Each button lists every reason it is blocked."],
    ["6. Daily review", "Dashboard › Run daily review now (also offered when the file is opened): releases missed payments, moves overdue determinations to Provisionally Registered (para 13(4)), lists overdue deficiency responses (never lapses them), locks missing numbers, and logs a summary."],
    ["", ""],
    ["Sheets", "", "h"],
    ["Settings", "Order parameters, policy settings, counters."],
    ["Lists", "Fee table, activity map, forms, Schedule 2 documents per form, evaluation checks, drop-down lists, staff names."],
    ["Register", "One row per submission (new registration, update or annual confirmation). Every calculated field: category, fees, late charge, deadlines, Finance gate, documents, completeness, SLA, flags and next action."],
    ["Documents", "The per-form Schedule 2 checklist of each submission and own-use notification, from registration-forms.json."],
    ["Evaluation", "Form OGSERC/EVAL-01: 56 decision checks and 7 post-approval checks, counts, recommended outcome and approval blockers."],
    ["Payments", "Payments ledger with the Finance status. Payments are never deleted: reverse one with a reason."],
    ["Finance Desk", "Payments waiting for Finance, oldest first."],
    ["Own-Use", "Own-use notifications (Form REG-01I), one row per site; capacity is the sum of the generator units."],
    ["Dashboard", "SPEC §10 figures and work queues."],
    ["Audit Log", "Every button action and edit."],
    ["", ""],
    ["Source", "Built from docs/SPEC.md, docs/DECISIONS.md and src/domain/ by `npm run export:workbook`, which also checks every SPEC §11 fixture against the app's domain functions. Rebuild it whenever the rules change; do not edit formulas by hand."],
  ];
  const cells: CellSpec[] = [
    { addr: "A1", value: "OGSERC Registration and Evaluation System: workbook v2", bold: true, size: 18, color: "brand" },
    { addr: "A2", value: "Order No. OGSERC/ORD/2026/001 (Order on Commencement of Operations and Registration of Licensees and Electricity Operators, 2026)", italic: true },
    { addr: "A3", f: `="Rules version "&cfgRulesVersion&" · built "&TEXT(cfgBuiltOn,"dd-mmm-yyyy")`, italic: true },
  ];
  lines.forEach(([a, b, kind], i) => {
    const r = 5 + i;
    if (kind === "h") cells.push({ addr: `A${r}`, value: a, bold: true, size: 13, color: "brand" });
    else if (kind === "warn") {
      cells.push({ addr: `A${r}`, value: a, bold: true, color: "white", fill: "brand", wrap: true });
      cells.push({ addr: `B${r}`, value: b, bold: true, fill: "goldLight", wrap: true });
    } else {
      cells.push({ addr: `A${r}`, value: a, bold: true, wrap: true });
      cells.push({ addr: `B${r}`, value: b, wrap: true });
    }
  });
  return { name: "Guide", tab: "brand", cells, widths: { A: 34, B: 120 }, protect: true, gridlines: false };
}

// ---------------------------------------------------------------------------------------------

export function buildSpec(): WorkbookSpec {
  const register: SheetSpec = {
    name: "Register",
    tab: "brand",
    cells: [
      { addr: "A1", value: "Register of Licensees and Electricity Operators (para 15)", bold: true, size: 16, color: "brand" },
      { addr: "A2", value: "Blue headers: enter data · gold: set by the buttons · green: calculated. Use New row, fill the blue cells, then Save submission.", italic: true },
      { addr: "A3", value: "The web app is the system of record.", italic: true, color: "brand" },
    ],
    tables: [registerTable()],
    buttons: [
      { cell: "H1", caption: "New row", macro: "NewSubmissionRow", width: 90 },
      { cell: "J1", caption: "Save submission", macro: "SaveSubmission", width: 120 },
      { cell: "M1", caption: "Recalculate pricing (Admin)", macro: "RecalculatePricing", width: 170 },
      { cell: "Q1", caption: "Cancel (Admin)", macro: "CancelSubmission", width: 110 },
    ],
    freeze: "F7",
    protect: true,
    zoom: 90,
  };
  const evaluation: SheetSpec = {
    name: "Evaluation",
    tab: "brand",
    cells: [
      { addr: "A1", value: "Evaluation (Form OGSERC/EVAL-01)", bold: true, size: 16, color: "brand" },
      { addr: "A2", value: "One row per submission, created by Save submission. Select a row, then use a button. Green check columns are automatic; grey cells are N/A automatically.", italic: true },
    ],
    tables: [evaluationTable()],
    cf: [
      ...Object.entries(NA_UNLESS).map(([id, col]) => ({
        range: `tblEvaluation[${id}]`,
        formula: `=NOT({${col}})`,
        fill: "naGrey",
        font: "naFont",
      })),
      { range: "tblEvaluation[Approval Blockers]", formula: `=LEN({Approval Blockers})>0`, font: "red" },
    ],
    buttons: [
      { cell: "H1", caption: "Confirm category", macro: "ConfirmCategory", width: 115 },
      { cell: "J1", caption: "Mark complete", macro: "MarkComplete", width: 105 },
      { cell: "L1", caption: "Issue deficiency notice", macro: "IssueDeficiency", width: 140 },
      { cell: "O1", caption: "Approve and register", macro: "ApproveAndRegister", width: 135 },
      { cell: "R1", caption: "Lapse", macro: "LapseSubmission", width: 70 },
      { cell: "T1", caption: "Refuse", macro: "RefuseSubmission", width: 70 },
    ],
    freeze: "C9",
    protect: true,
    zoom: 90,
  };
  const docs: SheetSpec = {
    name: "Documents",
    tab: "brand",
    cells: [
      { addr: "A1", value: "Schedule 2 documents checklist (per form)", bold: true, size: 16, color: "brand" },
      { addr: "A2", value: "Rows are created from the form's list (registration-forms.json) when a submission is saved, and again after Confirm category. Enter Y, N or N/A in the blue column; Status shows what counts.", italic: true },
    ],
    tables: [documentsTable()],
    cf: [
      { range: "tblDocuments[Status]", formula: `={On Current List}="No"`, fill: "naGrey", font: "naFont" },
      { range: "tblDocuments[Received (Y/N/N/A)]", formula: `=LEFT({Requirement},9)="Automatic"`, fill: "naGrey" },
      { range: "tblDocuments[Status]", formula: `={Status}="N"`, font: "red", bold: true },
    ],
    buttons: [{ cell: "H1", caption: "Refresh selected checklist", macro: "RefreshSelectedDocuments", width: 160 }],
    freeze: "C7",
    protect: true,
  };
  const payments: SheetSpec = {
    name: "Payments",
    tab: "gold",
    cells: [
      { addr: "A1", value: "Payments ledger", bold: true, size: 16, color: "brand" },
      { addr: "A2", value: "New row, enter the payment, then Record payment. Finance confirms or rejects it on the Finance Desk. Never delete a payment: reverse it.", italic: true },
    ],
    tables: [paymentsTable()],
    buttons: [
      { cell: "F1", caption: "New row", macro: "NewPaymentRow", width: 90 },
      { cell: "H1", caption: "Record payment", macro: "RecordPayment", width: 110 },
      { cell: "J1", caption: "Reverse payment (Finance/Admin)", macro: "ReversePayment", width: 190 },
    ],
    freeze: "B7",
    protect: true,
  };
  const ownUse: SheetSpec = {
    name: "Own-Use",
    tab: "gold",
    cells: [
      { addr: "A1", value: "Own-use generation notifications (Form REG-01I, Category I, para 3(4))", bold: true, size: 16, color: "brand" },
      { addr: "A2", value: "One row per site, 200 kW to below 1 MW. New row, fill the blue cells, then Save notification.", italic: true },
    ],
    tables: [ownUseTable()],
    buttons: [
      { cell: "F1", caption: "New row", macro: "NewOwnUseRow", width: 90 },
      { cell: "H1", caption: "Save notification", macro: "SaveOwnUse", width: 120 },
      { cell: "J1", caption: "Register with certificate", macro: "RegisterOwnUse", width: 160 },
    ],
    freeze: "C7",
    protect: true,
  };
  const audit: SheetSpec = {
    name: "Audit Log",
    tab: "grey",
    cells: [
      { addr: "A1", value: "Audit log", bold: true, size: 16, color: "brand" },
      { addr: "A2", value: "Written by the buttons and by edits. Not tamper-proof: the web app's audit log is the record.", italic: true },
    ],
    tables: [
      {
        name: "tblAudit",
        anchor: "A4",
        capacity: 50000,
        columns: [
          { name: "Timestamp", kind: "macro", fmt: "dd-mmm-yyyy hh:mm:ss", width: 20 },
          { name: "User", kind: "macro", width: 18 },
          { name: "Action", kind: "macro", width: 34 },
          { name: "Reference", kind: "macro", width: 24 },
          { name: "Detail", kind: "macro", width: 110, wrap: true },
        ],
      },
    ],
    freeze: "A5",
    protect: true,
  };

  const statusCf = (range: string): CfSpec[] => [
    { range, formula: `={SLA}="Red"`, fill: "redLight", font: "red", bold: true },
    { range, formula: `={SLA}="Amber"`, fill: "amberLight" },
    { range, formula: `={SLA}="Green"`, fill: "greenLight" },
  ];
  register.cf = [
    ...statusCf("tblRegister[SLA]"),
    { range: "tblRegister[Flags]", formula: `=LEN({Flags})>0`, font: "red" },
  ];

  const sheets = [
    guideSheet(),
    settingsSheet(),
    listsSheet(),
    register,
    docs,
    evaluation,
    payments,
    financeDeskSheet(),
    ownUse,
    dashboardSheet(),
    audit,
  ];

  const settingsDefaults: Record<string, string | number | null> = {};
  for (const s of SETTINGS_ROWS) if (s.name && !s.f) settingsDefaults[s.name] = s.value;

  return {
    title: "OGSERC Registration and Evaluation System v2",
    password: "ogserc-v2",
    colours: {
      brand: "#18702F",
      brandDark: "#0E401C",
      gold: "#F5B800",
      goldLight: "#FDE68A",
      header: "#D5EEDB",
      input: "#DDEBF7",
      inputFont: "#1F3864",
      macro: "#FFF2CC",
      calc: "#E2EFDA",
      grey: "#808080",
      naGrey: "#E7E6E6",
      naFont: "#7F7F7F",
      white: "#FFFFFF",
      red: "#C00000",
      redLight: "#F8CBAD",
      amberLight: "#FFE699",
      greenLight: "#C6EFCE",
    },
    sheets,
    names: [
      { name: "AsOfDate", refersTo: `=IF(cfgTodayOverride="",TODAY(),cfgTodayOverride)` },
      { name: "lstActivity", refersTo: "=tblActivities[Activity]" },
      ...SIMPLE_LISTS.filter((l) => l.name !== "lstActivity").map((l) => ({
        name: l.name,
        refersTo: `=${l.name.replace(/^lst/, "tblL")}[[${l.title}]]`,
      })),
    ],
    settingsDefaults,
  };
}

export { FLAG_CODES, WRONG_FORM };
