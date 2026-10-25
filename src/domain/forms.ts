// Category-specific registration forms REG-01A to REG-01K (registration-forms.json). Each Schedule 3
// category has its own form and its own Schedule 2 document list; REG-01I is the own-use notification.

/** Yes/no facts on a submission that decide whether a conditional document applies. */
export const CONDITION_KEYS = [
  "holds_any_licence",
  "multi_state_licensee",
  "generation_for_sale",
  "grid_connected",
  "interconnected_minigrid",
  "f_distribution",
  "f_trading",
  "g_disco_bulk_supply",
  "sub_franchise",
] as const;

export type ConditionKey = (typeof CONDITION_KEYS)[number];

/** Each condition as a question for the intake form (registration-forms.json `document_conditions`). */
export const CONDITION_LABELS: Record<ConditionKey, string> = {
  holds_any_licence: "Holds any licence, permit or registration?",
  multi_state_licensee: "Multi-State licensee?",
  generation_for_sale: "Generation includes sale (not captive only)?",
  grid_connected: "Plant connected to TCN, a DisCo or a private network?",
  interconnected_minigrid: "Interconnected mini-grid?",
  f_distribution: "Part 1 (distribution) applies?",
  f_trading: "Part 2 (trading and bulk supply) applies?",
  g_disco_bulk_supply: "Supplied by DisCo bulk supply?",
  sub_franchise: "Sub-franchisee?",
};

/** A condition is recorded as Y, N, or not yet answered (null). */
export type Conditions = Record<ConditionKey, "Y" | "N" | null>;

export const NO_CONDITIONS: Conditions = Object.fromEntries(
  CONDITION_KEYS.map((k) => [k, null]),
) as Conditions;

/** The document every form ends with; it ticks itself once Finance confirms the fee. */
export const PAYMENT_EVIDENCE_KEY = "payment_evidence";

export interface FormDocumentDef {
  /** Shared across forms: "incorporation" on REG-01A is the same item as on REG-01E. */
  key: string;
  text: string;
  /** Applies only when this condition is Y; N/A automatically when it is N. */
  requiredWhen: ConditionKey | null;
}

export interface RegistrationFormDef {
  /** "REG-01A" … "REG-01K". */
  form: string;
  category: string;
  title: string;
  para: string;
  documents: FormDocumentDef[];
}

export const OWN_USE_FORM = "REG-01I";

/** "REG-01" + category letter. */
export function formCodeFor(category: string): string {
  return `REG-01${category}`;
}

export function findForm(
  form: string | null,
  forms: readonly RegistrationFormDef[],
): RegistrationFormDef | null {
  if (!form) return null;
  return forms.find((f) => f.form === form) ?? null;
}

export function formForCategory(
  category: string | null,
  forms: readonly RegistrationFormDef[],
): RegistrationFormDef | null {
  if (!category) return null;
  return forms.find((f) => f.category === category) ?? null;
}

/** Category letter of a form code, or null if it is not one of the forms. */
export function categoryOfForm(
  form: string | null,
  forms: readonly RegistrationFormDef[],
): string | null {
  return findForm(form, forms)?.category ?? null;
}

// Shape of registration-forms.json (only the parts read here).
interface FormsFile {
  forms: {
    form: string;
    category: string;
    title: string;
    para: string;
    documents: { key: string; text: string; required_when?: string }[];
  }[];
}

const isConditionKey = (s: string): s is ConditionKey =>
  (CONDITION_KEYS as readonly string[]).includes(s);

export function formsFromSeed(file: FormsFile): RegistrationFormDef[] {
  return file.forms.map((f) => ({
    form: f.form,
    category: f.category,
    title: f.title,
    para: f.para,
    documents: f.documents.map((d) => {
      if (d.required_when && !isConditionKey(d.required_when)) {
        throw new Error(`${f.form} ${d.key}: unknown condition "${d.required_when}"`);
      }
      return { key: d.key, text: d.text, requiredWhen: (d.required_when as ConditionKey) ?? null };
    }),
  }));
}

/** Conditions any of these forms' documents depend on, in the order of CONDITION_KEYS. */
export function conditionsUsedBy(forms: readonly (RegistrationFormDef | null)[]): ConditionKey[] {
  const used = new Set(
    forms.flatMap((f) => f?.documents.map((d) => d.requiredWhen) ?? []).filter(Boolean),
  );
  return CONDITION_KEYS.filter((k) => used.has(k));
}
