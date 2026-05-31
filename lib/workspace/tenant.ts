export type DistributorLevel = "A" | "B" | "C";

export type BrandWorkspace = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
};

export type BrandScopedRecord = {
  brandId?: string;
  brand_id?: string;
};

export type DistributorInviteStatus = "pending" | "accepted" | "expired";

export type DistributorInvite = {
  id: string;
  brandId: string;
  brandName: string;
  distributorId: string;
  distributorName: string;
  distributorLevel: DistributorLevel;
  email: string;
  token: string;
  inviteUrl: string;
  status: DistributorInviteStatus;
  expiresAt: string;
  acceptedAt?: string | null;
  createdAt: string;
};

export type CreateInviteInput = {
  brandId: string;
  brandName: string;
  distributorId: string;
  distributorName: string;
  distributorLevel: DistributorLevel;
  email: string;
  appUrl?: string;
  now?: Date;
  expiresInDays?: number;
  tokenFactory?: () => string;
};

export const DEFAULT_BRAND_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
export const DEFAULT_BRAND_NAME = "Nimbus Home Goods";

export function createBrandWorkspace(input: { id?: string; name: string; slug?: string; createdAt?: string }): BrandWorkspace {
  return {
    id: input.id || `brand-${slugifyBrandName(input.name)}`,
    name: input.name,
    slug: input.slug || slugifyBrandName(input.name),
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

export function createDefaultBrandWorkspace() {
  return createBrandWorkspace({
    id: DEFAULT_BRAND_WORKSPACE_ID,
    name: DEFAULT_BRAND_NAME,
    slug: "nimbus-home-goods",
  });
}

export function slugifyBrandName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "brand";
}

export function brandStorageKey(brandId: string, key: string) {
  return `distributor-os:${brandId}:${key}`;
}

export function recordBelongsToBrand(record: BrandScopedRecord, brandId: string) {
  return (record.brandId || record.brand_id) === brandId;
}

export function filterByBrand<T extends BrandScopedRecord>(records: T[], brandId: string) {
  return records.filter((record) => recordBelongsToBrand(record, brandId));
}

export function createDistributorInvite(input: CreateInviteInput): DistributorInvite {
  const now = input.now || new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + (input.expiresInDays ?? 14));
  const token = input.tokenFactory?.() || `INV-${randomTokenPart()}`;
  const appUrl = (input.appUrl || "http://localhost:3000").replace(/\/+$/, "");

  return {
    id: `invite-${token.toLowerCase()}`,
    brandId: input.brandId,
    brandName: input.brandName,
    distributorId: input.distributorId,
    distributorName: input.distributorName,
    distributorLevel: input.distributorLevel,
    email: input.email,
    token,
    inviteUrl: `${appUrl}/invite/${token}`,
    status: "pending",
    expiresAt: expiresAt.toISOString(),
    acceptedAt: null,
    createdAt: now.toISOString(),
  };
}

export function isInviteExpired(invite: Pick<DistributorInvite, "expiresAt">, now = new Date()) {
  return Date.parse(invite.expiresAt) <= now.getTime();
}

export function getInviteStatus(invite: Pick<DistributorInvite, "acceptedAt" | "expiresAt">, now = new Date()): DistributorInviteStatus {
  if (invite.acceptedAt) return "accepted";
  return isInviteExpired(invite, now) ? "expired" : "pending";
}

export function acceptDistributorInvite(invite: DistributorInvite, acceptedAt = new Date()): DistributorInvite {
  if (isInviteExpired(invite, acceptedAt)) {
    return { ...invite, status: "expired" };
  }

  return {
    ...invite,
    status: "accepted",
    acceptedAt: acceptedAt.toISOString(),
  };
}

export function upsertInviteByToken(invites: DistributorInvite[], invite: DistributorInvite) {
  return [
    invite,
    ...invites.filter((current) => current.token !== invite.token),
  ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function randomTokenPart() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8).toUpperCase();
  }
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}
