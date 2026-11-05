import { z } from "zod";

export const reportSchema = z.object({
  title: z.string().min(1).max(200).describe("Short headline of what is wrong, ideally under 80 characters"),
  severity: z.enum(["low", "medium", "high", "critical"]),
  status: z
    .enum(["confident", "likely", "inconclusive"])
    .describe("confident = evidence proves it; likely = strong evidence; inconclusive = could not determine"),
  hypotheses: z
    .array(
      z.object({
        claim: z.string().min(1).describe("The root cause in one sentence"),
        evidence: z
          .array(z.string().min(1))
          .min(1)
          .describe("Snapshot ids (snap_N), exact log lines, or queries that support the claim"),
      }),
    )
    .max(2)
    .describe("At most two root-cause hypotheses, most likely first"),
  nextSteps: z.array(z.string().min(1)).describe("What Ashwath should check or do next"),
  suggestedFix: z.string().optional().describe("Optional fix described as text or a diff; it will not be applied"),
  coverage: z
    .object({
      checked: z.array(z.string()),
      notChecked: z.array(z.string()),
    })
    .describe("Which sources were checked and which were not"),
});

export type Report = z.infer<typeof reportSchema>;

export function fallbackReport(checked: string[], reason: string): Report {
  return {
    title: "Investigation stopped before a report was written",
    severity: "medium",
    status: "inconclusive",
    hypotheses: [],
    nextSteps: [reason, "Review the tool-call transcript for partial findings."],
    coverage: { checked: [...new Set(checked)], notChecked: [] },
  };
}

export function renderReportMarkdown(report: Report, meta: { project: string; stopReason: string }): string {
  const lines = [
    `# ${report.title}`,
    "",
    `**Project:** ${meta.project} · **Severity:** ${report.severity} · **Status:** ${report.status} · **Stopped:** ${meta.stopReason}`,
    "",
    "## Hypotheses",
  ];
  if (report.hypotheses.length === 0) lines.push("_None — inconclusive._");
  for (const hypothesis of report.hypotheses) {
    lines.push(`- ${hypothesis.claim}`);
    for (const evidence of hypothesis.evidence) lines.push(`  - evidence: ${evidence}`);
  }
  lines.push("", "## Next steps");
  for (const step of report.nextSteps) lines.push(`- ${step}`);
  if (report.suggestedFix) lines.push("", "## Suggested fix (not applied)", "", "```", report.suggestedFix, "```");
  lines.push(
    "",
    "## Coverage",
    `**Checked:** ${report.coverage.checked.join(", ") || "nothing"}`,
    `**Not checked:** ${report.coverage.notChecked.join(", ") || "nothing"}`,
  );
  return lines.join("\n");
}
