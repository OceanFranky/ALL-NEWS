// Changing this deployment setting requires an explicitly approved cumulative allowance.
export function admissionLimit(value: string | undefined): number {
  if (value === undefined) return 5;
  const limit = Number(value);
  if (!value.trim() || !Number.isFinite(limit) || limit <= 0) throw new Error("ADMISSION_BUDGET_CNY must be a positive finite number");
  return limit;
}
