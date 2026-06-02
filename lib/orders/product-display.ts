const fallbackDemoProduct = {
  name: "Rigorer Custom Team Jersey Set",
  sku: "RIG-TEAM-JSY",
};

const placeholderProductNames = new Set([
  "custom",
  "demo",
  "item",
  "product",
  "sample",
  "test",
  "testing",
]);

export function isPlaceholderProductName(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  return !text || placeholderProductNames.has(text) || /^test[\s_-]*\d*$/.test(text);
}

export function polishDemoProductName(value: unknown, fallback = fallbackDemoProduct.name) {
  const text = String(value ?? "").trim();
  return isPlaceholderProductName(text) ? fallback : text;
}

export function polishDemoSku(value: unknown, productName?: unknown, fallback = fallbackDemoProduct.sku) {
  const text = String(value ?? "").trim();
  if (!text || isPlaceholderProductName(productName) || /^test[\s_-]*\d*$/i.test(text)) return fallback;
  return text;
}
