import { describe, expect, it } from "vitest";
import { can, isAdmin } from "@/server/policies";

/** Role matrix spot-checks against docs/ARCHITECTURE.md §4. */
describe("ability matrix", () => {
  it("owner/admin manage everything sensitive", () => {
    const roles = ["owner", "admin"] as const;
    for (const role of roles) {
      expect(can([role], "settings.manage")).toBe(true);
      expect(can([role], "decommission.execute")).toBe(true);
      expect(can([role], "hardDelete")).toBe(true);
      expect(can([role], "wo.plan")).toBe(true);
    }
  });

  it("maintenance manager plans but cannot execute admin-only abilities", () => {
    expect(can(["maintenance_manager"], "plan.manage")).toBe(true);
    expect(can(["maintenance_manager"], "wo.plan")).toBe(true);
    expect(can(["maintenance_manager"], "wo.execute")).toBe(true);
    expect(can(["maintenance_manager"], "settings.manage")).toBe(false);
    expect(can(["maintenance_manager"], "decommission.execute")).toBe(false);
  });

  it("technician executes but does not plan or manage inventory", () => {
    expect(can(["technician"], "wo.execute")).toBe(true);
    expect(can(["technician"], "wo.issueToOwnWo")).toBe(true);
    expect(can(["technician"], "wo.plan")).toBe(false);
    expect(can(["technician"], "plan.manage")).toBe(false);
    expect(can(["technician"], "inventory.manage")).toBe(false);
  });

  it("viewer sees but cannot change", () => {
    for (const ability of ["plan.manage", "wo.plan", "wo.execute", "inventory.manage", "settings.manage"] as const) {
      expect(can(["viewer"], ability)).toBe(false);
    }
  });

  it("external technician runs assigned jobs only", () => {
    expect(can(["external_technician"], "wo.runExternalJobs")).toBe(true);
    expect(can(["external_technician"], "wo.execute")).toBe(false);
    expect(can(["external_technician"], "wo.plan")).toBe(false);
    expect(can(["external_technician"], "inventory.manage")).toBe(false);
  });

  it("combined roles aggregate and isAdmin detects admins", () => {
    expect(can(["viewer", "technician"], "wo.execute")).toBe(true);
    expect(isAdmin(["viewer"])).toBe(false);
    expect(isAdmin(["admin"])).toBe(true);
    expect(isAdmin(["owner", "technician"])).toBe(true);
  });

  it("unknown roles get nothing", () => {
    expect(can([], "wo.execute")).toBe(false);
  });
});
