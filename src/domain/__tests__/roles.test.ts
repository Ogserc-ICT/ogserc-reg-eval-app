import { describe, expect, it } from "vitest";
import { can, canEditChecks, eligibleOfficers, permissionsFor } from "../roles";

describe("roles and permissions (§5)", () => {
  it("gives each role its duties and every role read access", () => {
    expect(can(["REGISTRY_OFFICER"], "submission.create")).toBe(true);
    expect(can(["REGISTRY_OFFICER"], "submission.approve")).toBe(false);
    expect(can(["FINANCE_OFFICER"], "payment.confirm")).toBe(true);
    expect(can(["REVIEWING_SUPERVISOR"], "submission.lapse")).toBe(true);
    expect(can(["APPROVING_OFFICER"], "submission.refuse")).toBe(true);
    expect(can(["ADMIN"], "submission.cancel")).toBe(true);
    expect(can(["ADMIN"], "submission.approve")).toBe(false);
    expect([...permissionsFor(["VIEWER"])].sort()).toEqual(["dashboard.read", "records.read"]);
    expect(permissionsFor([]).size).toBe(0);
  });

  it("unions several roles", () => {
    const roles = ["REGISTRY_OFFICER", "FINANCE_OFFICER"] as const;
    expect(can(roles, "ownUse.create") && can(roles, "payment.confirm")).toBe(true);
  });

  it("lets only the assigned evaluator or a supervisor edit checks", () => {
    expect(canEditChecks({ id: "e1", roles: ["EVALUATING_OFFICER"] }, "e1")).toBe(true);
    expect(canEditChecks({ id: "e2", roles: ["EVALUATING_OFFICER"] }, "e1")).toBe(false);
    expect(canEditChecks({ id: "s1", roles: ["REVIEWING_SUPERVISOR"] }, "e1")).toBe(true);
    expect(canEditChecks({ id: "e1", roles: ["VIEWER"] }, "e1")).toBe(false);
  });

  it("filters officer drop-downs by role and active status", () => {
    const users = [
      { id: "a", roles: ["APPROVING_OFFICER" as const], active: true },
      { id: "b", roles: ["APPROVING_OFFICER" as const], active: false },
      { id: "c", roles: ["EVALUATING_OFFICER" as const], active: true },
    ];
    expect(eligibleOfficers(users, "APPROVING_OFFICER").map((u) => u.id)).toEqual(["a"]);
  });
});
