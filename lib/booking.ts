const FALLBACK_CONTACT_URL = "mailto:hello@distributor-os.com?subject=Distributor%20OS%20pilot%20call";

export function getPilotCallUrl(source: string) {
  const configuredUrl = process.env.NEXT_PUBLIC_CALENDLY_URL;

  if (!configuredUrl) {
    return FALLBACK_CONTACT_URL;
  }

  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "https:" || !url.hostname.endsWith("calendly.com")) {
      return FALLBACK_CONTACT_URL;
    }
    url.searchParams.set("utm_source", "distributor-os-demo");
    url.searchParams.set("utm_medium", source);
    url.searchParams.set("utm_campaign", "pilot-call");
    return url.toString();
  } catch {
    return FALLBACK_CONTACT_URL;
  }
}
