export async function readApiError(response: Response, fallback: string) {
  try {
    const data = await response.json();
    const error = data?.error;
    if (Array.isArray(error)) return error.join("; ");
    if (typeof error === "string") return error;
    if (error && typeof error === "object") return JSON.stringify(error);
  } catch {
    // Some production failures return an empty body or HTML error page.
  }

  return fallback;
}
