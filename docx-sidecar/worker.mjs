import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

export function sanitizeFileStem(value) {
  return String(value || "grant-keeper-draft")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "grant-keeper-draft";
}

export function paragraph(text, options = {}) {
  return new Paragraph({
    children: [new TextRun({ text })],
    ...options,
  });
}

export function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function sectionParagraphs(title, body) {
  if (!nonEmpty(body)) return [];
  return [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }),
    ...body
      .split(/\r?\n{2,}/)
      .map((block) => block.trim())
      .filter(nonEmpty)
      .map((block) => paragraph(block)),
  ];
}

export function grantMetaParagraphs(grant) {
  return [
    paragraph(`Portal ID: ${grant.portal_id || "not set"}`),
    paragraph(`Agency: ${grant.agency_dept || "not set"}`),
    paragraph(`Status: ${grant.status || "not set"}`),
    paragraph(`Deadline: ${grant.deadline_is_ongoing ? "Ongoing" : grant.application_deadline || "not set"}`),
    paragraph(`Funding: ${grant.est_amounts || grant.est_avail_funds || "not set"}`),
  ];
}

export function organizationMetaParagraphs(organization) {
  return [
    paragraph(`Organization: ${organization.name || "not set"}`),
    paragraph(`UID: ${organization.uid || "not set"}`),
    paragraph(`Contact: ${organization.contact_name || "not set"}`),
    paragraph(`Email: ${organization.contact_email || "not set"}`),
    paragraph(`Website: ${organization.website || "not set"}`),
  ];
}

export async function buildDocument(payload) {
  const draft = payload.draft || {};
  const grant = payload.grant || {};
  const organization = payload.organization || {};

  const body = draft.body || "";
  const children = [
    new Paragraph({ text: draft.title || grant.title || "Grant Keeper Draft", heading: HeadingLevel.TITLE }),
    new Paragraph({ text: `Generated ${payload.generated_at || new Date().toISOString()}`, spacing: { after: 160 } }),
    new Paragraph({ text: "Grant Summary", heading: HeadingLevel.HEADING_1, spacing: { before: 120, after: 120 } }),
    ...grantMetaParagraphs(grant),
    new Paragraph({ text: "Organization Summary", heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }),
    ...organizationMetaParagraphs(organization),
    new Paragraph({ text: "Draft Body", heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }),
    ...(nonEmpty(body)
      ? body
          .split(/\r?\n{2,}/)
          .map((block) => block.trim())
          .filter(nonEmpty)
          .map((block) => paragraph(block))
      : []),
    ...sectionParagraphs("Organization Overview", draft.section_org_overview),
    ...sectionParagraphs("Need Statement", draft.section_need_statement),
    ...sectionParagraphs("Project Description", draft.section_project_description),
    ...sectionParagraphs("Goals and Objectives", draft.section_goals_objectives),
    ...sectionParagraphs("Implementation Plan", draft.section_implementation_plan),
    ...sectionParagraphs("Evaluation Plan", draft.section_evaluation_plan),
    ...sectionParagraphs("Budget Narrative", draft.section_budget_narrative),
    ...sectionParagraphs("Sustainability", draft.section_sustainability),
    ...sectionParagraphs("Organization Capacity", draft.section_org_capacity),
    ...sectionParagraphs("Letter of Intent", draft.section_loi_text),
  ];

  return new Document({ sections: [{ children }] });
}

export function resolveOutputPath(payload, outputDirArg) {
  const draft = payload.draft || {};
  const grant = payload.grant || {};
  const fileStem = sanitizeFileStem(`${draft.title || grant.title || "Grant Keeper Draft"}-${draft.draft_id || "draft"}`);
  const outputBase = outputDirArg || path.join(os.homedir(), "Downloads", "Grant Keeper");
  return path.extname(outputBase).toLowerCase() === ".docx"
    ? outputBase
    : path.join(outputBase, `${fileStem}.docx`);
}

export async function main(argv = process.argv.slice(2)) {
  const [payloadPath, outputDirArg] = argv;
  if (!payloadPath) {
    throw new Error("missing export payload path");
  }

  const payload = JSON.parse(await readFile(payloadPath, "utf8"));
  const outputPath = resolveOutputPath(payload, outputDirArg);
  await mkdir(path.dirname(outputPath), { recursive: true });

  const doc = await buildDocument(payload);
  const buffer = await Packer.toBuffer(doc);
  await writeFile(outputPath, buffer);
  process.stdout.write(outputPath);
  return outputPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
