import type { DistributorLevel } from "@/lib/commercial-demo";
import type { CatalogProduct } from "./products.ts";

export type ParsedCatalogOrderItem = CatalogProduct & {
  requestedName: string;
  qty: number;
  confidence: number;
  levelPrice: number;
  standardPrice: number;
  priceDelta: number;
  matchedAlias: string;
  extractedPhrase: string;
  needsReview: boolean;
};

type CandidateMatch = {
  product: CatalogProduct;
  alias: string;
  normalizedAlias: string;
  index: number;
  quantity: number;
  confidence: number;
};

export function parseCatalogOrder(
  message: string,
  level: DistributorLevel,
  products: CatalogProduct[]
): ParsedCatalogOrderItem[] {
  const normalizedMessage = normalizeText(message);
  if (!normalizedMessage) return [];

  const matches = findCatalogMatches(normalizedMessage, products);
  const bySku = new Map<string, CandidateMatch>();
  matches.forEach((match) => {
    const current = bySku.get(match.product.sku);
    if (!current || match.confidence > current.confidence) {
      bySku.set(match.product.sku, match);
    }
  });

  return Array.from(bySku.values())
    .sort((a, b) => a.index - b.index)
    .map((match) => {
      const levelPrice = match.product.levelPrices[level];
      return {
        ...match.product,
        requestedName: match.alias,
        qty: match.quantity || match.product.moq,
        confidence: match.confidence,
        levelPrice,
        standardPrice: match.product.levelPrices.B,
        priceDelta: levelPrice - match.product.levelPrices.B,
        matchedAlias: match.alias,
        extractedPhrase: match.normalizedAlias,
        needsReview: match.confidence < 80,
      };
    });
}

export function extractOrderPhrases(message: string) {
  const normalized = normalizeText(message);
  const quantityPhrasePattern = /\b(\d+)\s*(pcs|pieces|units|unit|cases|case|ctns|cartons|x)?\s+([a-z0-9][a-z0-9\s-]{1,80}?)(?=\s+(?:and|plus|with|next|this|tomorrow|asap|please|for)\b|[,.!?]|$)/g;
  const phrases: Array<{ quantity: number; phrase: string }> = [];
  for (const match of normalized.matchAll(quantityPhrasePattern)) {
    phrases.push({
      quantity: Number(match[1]),
      phrase: match[3].trim(),
    });
  }
  return phrases;
}

function findCatalogMatches(normalizedMessage: string, products: CatalogProduct[]) {
  const matches: CandidateMatch[] = [];
  products.forEach((product) => {
    const aliases = buildProductAliases(product);
    aliases.forEach((alias) => {
      const normalizedAlias = normalizeText(alias);
      if (!normalizedAlias || normalizedAlias.length < 2) return;
      const index = normalizedMessage.indexOf(normalizedAlias);
      if (index < 0) return;
      matches.push({
        product,
        alias,
        normalizedAlias,
        index,
        quantity: extractQuantityForMatch(normalizedMessage, normalizedAlias, index),
        confidence: scoreMatch(product, alias, normalizedAlias, normalizedMessage),
      });
    });
  });
  return matches;
}

function buildProductAliases(product: CatalogProduct) {
  return Array.from(new Set([product.sku, product.name, product.requestedName, ...product.aliases].filter(Boolean)));
}

function scoreMatch(product: CatalogProduct, alias: string, normalizedAlias: string, normalizedMessage: string) {
  if (normalizeText(product.sku) === normalizedAlias) return 98;
  if (product.aliases.some((item) => normalizeText(item) === normalizedAlias)) {
    return normalizedAlias.length >= 6 ? 94 : 78;
  }
  if (normalizeText(product.name) === normalizedAlias || normalizeText(product.requestedName) === normalizedAlias) return 90;
  return normalizedMessage.includes(normalizedAlias) ? 72 : 0;
}

function extractQuantityForMatch(normalizedMessage: string, normalizedAlias: string, aliasIndex: number) {
  const before = normalizedMessage.slice(Math.max(0, aliasIndex - 70), aliasIndex);
  const after = normalizedMessage.slice(aliasIndex + normalizedAlias.length, aliasIndex + normalizedAlias.length + 40);
  const beforeMatches = Array.from(before.matchAll(/\b(\d+)\s*(pcs|pieces|units|unit|cases|case|ctns|cartons|x)?\s*$/g));
  const beforeNumber = beforeMatches.at(-1)?.[1];
  if (beforeNumber) return Number(beforeNumber);

  const afterNumber = after.match(/^\s*(?:x\s*)?(\d+)\b/)?.[1];
  if (afterNumber) return Number(afterNumber);

  const extractedPhrase = extractOrderPhrases(normalizedMessage).find((phrase) => phrase.phrase.includes(normalizedAlias));
  return extractedPhrase?.quantity || 0;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
