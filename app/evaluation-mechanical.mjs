import { validateWorkspace } from "../packages/revision/change-entries.mjs";
import { changeSetHash } from "../packages/revision/change-set-hash.mjs";
import { canonicalSchema, changeSetSchema } from "../packages/revision/contracts.ts";
import { projectEntries, workspaceHash } from "../packages/revision/workspace.mjs";
import { DomainError } from "./errors.mjs";

const check = (id, verdict, code, message, keys = []) => ({ id, verdict, code, message, keys });
const protectionCodes = new Set(["PROTECTED_SCENE", "PROTECTED_QUOTE_METADATA", "PROTECTED_QUOTE", "MERGE_PROTECTION_VIOLATION"]);

export function changeSetBindingIssues(changeSet) {
  const issues = [];
  if (changeSet.schemaVersion !== 2 || changeSet.policyVersion !== 2) issues.push("POLICY_MISMATCH");
  if (!changeSetSchema.safeParse(changeSet).success) issues.push("CHANGESET_SCHEMA_INVALID");
  if (changeSetHash(changeSet) !== changeSet.hash) issues.push("CHANGESET_HASH_MISMATCH");
  if (changeSet._baseWorkspace && workspaceHash(changeSet._baseWorkspace) !== changeSet.baseWorkspaceHash) {
    issues.push("BASE_WORKSPACE_CORRUPT");
  }
  return [...new Set(issues)];
}

export function mechanicalChecks(changeSet) {
  if (changeSetHash(changeSet) !== changeSet.hash) {
    throw new DomainError("CHANGESET_HASH_MISMATCH", "The immutable change-set hash does not match.", 409);
  }
  const bindingIssues = changeSetBindingIssues(changeSet);
  const integrity = bindingIssues.length === 0
    ? check("integrity", "pass", "CHANGESET_BINDING_VALID", "The public change-set schema, policy, and immutable hash match.")
    : check("integrity", "fail", bindingIssues[0], "The public change-set binding is invalid.");
  if (!changeSet._baseWorkspace) return [integrity,
    check("workspace_schema", "unknown", "BASE_WORKSPACE_UNAVAILABLE", "The frozen base workspace is unavailable."),
    check("protected_content", "unknown", "BASE_WORKSPACE_UNAVAILABLE", "Protected content cannot be checked without the frozen base."),
    check("temporal", "unknown", "NO_STRUCTURED_TEMPORAL_CONSTRAINTS", "No structured temporal constraints were supplied.")];
  if (workspaceHash(changeSet._baseWorkspace) !== changeSet.baseWorkspaceHash) {
    throw new DomainError("BASE_WORKSPACE_CORRUPT", "The frozen base workspace hash does not match.", 409);
  }
  let schema = check("workspace_schema", "pass", "WORKSPACE_SCHEMA_VALID", "The projected workspace schema is valid.");
  let protection = check("protected_content", "pass", "PROTECTED_CONTENT_VALID", "Frozen protected content is preserved.");
  const base = canonicalSchema.safeParse(changeSet._baseWorkspace);
  const projected = base.success ? canonicalSchema.safeParse(projectEntries(base.data, changeSet.entries)) : null;
  if (!base.success || !projected?.success) return [integrity,
    check("workspace_schema", "fail", "WORKSPACE_SCHEMA_INVALID", "The frozen or projected workspace violates the canonical schema."),
    check("protected_content", "unknown", "CHECK_SKIPPED_SCHEMA_FAILURE",
      "Protected content was not evaluated because workspace schema validation failed."),
    check("temporal", "unknown", "NO_STRUCTURED_TEMPORAL_CONSTRAINTS", "No structured temporal constraints were supplied.")];
  try {
    validateWorkspace(base.data, changeSet.entries, changeSet.merge?.protectionRequirements);
  } catch (error) {
    if (!error?.code) throw error;
    if (protectionCodes.has(error.code)) {
      protection = check("protected_content", "fail", error.code, error.message, error.keys ?? []);
    } else {
      schema = check("workspace_schema", "fail", error.code, error.message, error.keys ?? []);
      protection = check("protected_content", "unknown", "CHECK_SKIPPED_SCHEMA_FAILURE",
        "Protected content was not evaluated because workspace schema validation failed.");
    }
  }
  return [integrity, schema, protection,
    check("temporal", "unknown", "NO_STRUCTURED_TEMPORAL_CONSTRAINTS", "No structured temporal constraints were supplied.")];
}
