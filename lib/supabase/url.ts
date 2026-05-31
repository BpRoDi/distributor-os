export function normalizeSupabaseUrl(url: string | undefined) {
  const value = url?.trim().replace(/^["']|["']$/g, "");
  if (!value) return "";

  try {
    const parsed = new URL(value);
    if (parsed.pathname.toLowerCase().includes("/rest/v1")) return parsed.origin;
  } catch {
    // Fall through to string cleanup for partial values.
  }

  return value.replace(/\/rest\/v1.*$/i, "").replace(/\/+$/, "");
}
