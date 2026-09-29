import { describe, expect, test } from "bun:test";

import { fallbackReport, renderReportMarkdown, reportSchema, type Report } from "./report";

const valid: Report = {
  title: "Orders API returns 500 after deploy",
  severity: "high",
  status: "likely",
  hypotheses: [
    { claim: "Migration dropped orders.status default", evidence: ["snap_2", "ERROR null value in column status"] },
    { claim: "Pool exhausted under load", evidence: ["snap_3"] },
  ],
  nextSteps: ["Check the last migration"],
  coverage: { checked: ["coolify", "axiom"], notChecked: ["aws"] },
};

describe("reportSchema", () => {
  test("accepts a valid report", () => {
    expect(reportSchema.safeParse(valid).success).toBe(true);
  });

  test("rejects more than two hypotheses", () => {
    const three = { ...valid, hypotheses: [...valid.hypotheses, { claim: "x", evidence: ["y"] }] };
    expect(reportSchema.safeParse(three).success).toBe(false);
  });

  test("rejects a hypothesis without evidence", () => {
    const bad = { ...valid, hypotheses: [{ claim: "x", evidence: [] }] };
    expect(reportSchema.safeParse(bad).success).toBe(false);
  });

  test("allows zero hypotheses for inconclusive reports", () => {
    expect(reportSchema.safeParse({ ...valid, status: "inconclusive", hypotheses: [] }).success).toBe(true);
  });
});

describe("fallbackReport", () => {
  test("is a valid inconclusive report listing checked tools once", () => {
    const report = fallbackReport(["coolify_app_logs", "coolify_app_logs", "axiom_query"], "Budget exhausted");
    expect(reportSchema.safeParse(report).success).toBe(true);
    expect(report.status).toBe("inconclusive");
    expect(report.coverage.checked).toEqual(["coolify_app_logs", "axiom_query"]);
    expect(report.nextSteps[0]).toBe("Budget exhausted");
  });
});

describe("renderReportMarkdown", () => {
  test("renders title, meta, hypotheses with evidence, and coverage", () => {
    const md = renderReportMarkdown({ ...valid, suggestedFix: "ALTER TABLE ..." }, { project: "acme", stopReason: "submitted" });
    expect(md).toContain("# Orders API returns 500 after deploy");
    expect(md).toContain("**Project:** acme");
    expect(md).toContain("**Severity:** high");
    expect(md).toContain("- Migration dropped orders.status default");
    expect(md).toContain("  - evidence: snap_2");
    expect(md).toContain("ALTER TABLE ...");
    expect(md).toContain("**Not checked:** aws");
  });
});
