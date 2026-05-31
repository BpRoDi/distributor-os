export type WorkspaceRole =
  | "brand_admin"
  | "brand_finance"
  | "brand_ops"
  | "brand_sales"
  | "distributor_buyer";

export const roleLabels: Record<WorkspaceRole, string> = {
  brand_admin: "Brand Admin",
  brand_finance: "Brand Finance",
  brand_ops: "Brand Ops",
  brand_sales: "Brand Sales",
  distributor_buyer: "Distributor Buyer",
};

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && value in roleLabels;
}

export function isBrandRole(role: WorkspaceRole) {
  return role !== "distributor_buyer";
}
