const DEFAULT_CALENDLY_URL = "https://calendly.com/bprodis/distributor-os-pilot";

export function getPilotCallUrl(source: string) {
  const configuredUrl = process.env.NEXT_PUBLIC_CALENDLY_URL || DEFAULT_CALENDLY_URL;

  try {
    const url = new URL(configuredUrl);
    url.searchParams.set("utm_source", "distributor-os-demo");
    url.searchParams.set("utm_medium", source);
    url.searchParams.set("utm_campaign", "pilot-call");
    return url.toString();
  } catch {
    return DEFAULT_CALENDLY_URL;
  }
}
