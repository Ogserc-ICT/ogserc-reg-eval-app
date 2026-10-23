import { describe, expect, it } from "vitest";
import { adminPasswordProblems, isProduction } from "../password-policy";

describe("production admin password policy", () => {
  const EMAIL = "kemi.ade@ogserc.gov.ng";

  it.each([
    ["ChangeMe!2026", /changeme/],
    ["Admin-Strong-Pass-99", /admin/],
    ["Ogserc#Harmattan2026", /ogserc/],
    ["Kemi.Ade#Harmattan26", /email name/],
    ["Sh0rt!pass", /14 characters/],
    ["lowercaseandnumbers12", null],
    ["onlylowercaseletters", null],
    ["lowercase12345678", /three of/],
    ["aaaaaaaaaaaaaaaaaaaaa", /repeated/],
  ])("%s", (password, problem) => {
    const problems = adminPasswordProblems(password, EMAIL);
    if (problem) expect(problems.join("; ")).toMatch(problem);
    else expect(problems).toEqual([]);
  });

  it("accepts a strong password or a long passphrase", () => {
    expect(adminPasswordProblems("Tr1cky-Harmattan-Kettle", EMAIL)).toEqual([]);
    expect(adminPasswordProblems("cassava yam plantain egusi", EMAIL)).toEqual([]);
  });

  it("detects production from NODE_ENV", () => {
    expect(isProduction({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isProduction({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(false);
  });
});
