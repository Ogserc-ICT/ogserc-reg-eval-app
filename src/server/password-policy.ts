// Strength rules for the seeded admin password (and any other bootstrap secret).

const BANNED_FRAGMENTS = [
  "changeme",
  "change-me",
  "password",
  "passw0rd",
  "ogserc",
  "admin",
  "123456",
  "qwerty",
  "letmein",
];

/** Reasons a password is unacceptable for the production admin; empty when it is acceptable. */
export function adminPasswordProblems(password: string, email: string): string[] {
  const problems: string[] = [];
  const lower = password.toLowerCase();

  if (password.length < 14) problems.push("must be at least 14 characters");

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  // Long passphrases are fine with fewer character types.
  if (password.length < 20 && classes < 3) {
    problems.push(
      "must mix at least three of: lower case, upper case, digits, symbols (or be 20+ characters)",
    );
  }

  const banned = BANNED_FRAGMENTS.find((f) => lower.includes(f));
  if (banned) problems.push(`must not contain "${banned}" (default or easily guessed)`);

  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 3 && lower.includes(local)) problems.push("must not contain the email name");

  if (/^(.)\1+$/.test(password)) problems.push("must not be one repeated character");

  return problems;
}

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}
