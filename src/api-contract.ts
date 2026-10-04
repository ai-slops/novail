export const branchHeaders = (branchId: string): Readonly<Record<string, string>> => ({ "X-Novail-Branch-Id": branchId })

export const snapshotExportUrl = (
  snapshotId: string,
  format: "markdown" | "docx" | "manifest",
  branchId: string,
): string => `/api/export?snapshotId=${encodeURIComponent(snapshotId)}&branchId=${encodeURIComponent(branchId)}&format=${format}`
