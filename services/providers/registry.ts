import { PaymentProvider, ProviderConfigError } from "./types";
import { mockProvider } from "./mock";
import { momoProvider } from "./momo";
import { lumicashProvider } from "./lumicash";

const factories: Record<string, () => PaymentProvider> = {
  mock: () => mockProvider(),
  momo: () => momoProvider(),
  lumicash: () => lumicashProvider(),
};

let cache: Map<string, PaymentProvider> | null = null;

/** Reads the enabled provider ids from env so deployments choose providers without code changes. */
export function enabledProviderIds(): string[] {
  const raw = process.env.PAYMENT_PROVIDERS;
  if (raw === undefined || raw.trim() === "") {
    return process.env.PAYMENTS_MODE === "mock" ? ["mock"] : ["momo"];
  }
  const ids = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  // Only separators is a typo, not a wish for no providers at all.
  if (!ids.length) throw new ProviderConfigError("PAYMENT_PROVIDERS is empty");
  return ids;
}

/** Builds providers lazily and caches them, so a bad id fails at first use rather than at import. */
export function enabledProviders(): PaymentProvider[] {
  if (!cache) {
    const built = new Map<string, PaymentProvider>();
    for (const id of enabledProviderIds()) {
      const factory = factories[id];
      if (!factory) throw new ProviderConfigError(`Unknown payment provider "${id}"`);
      built.set(id, factory());
    }
    cache = built;
  }
  return [...cache.values()];
}

/** Returns undefined for a provider that is not enabled, so callers can reject it cleanly. */
export function getProvider(id: string): PaymentProvider | undefined {
  return enabledProviders().find((p) => p.id === id);
}

/** An empty currencies list means the provider accepts any currency. */
export function providersForCurrency(currency: string): PaymentProvider[] {
  return enabledProviders().filter((p) => p.currencies.length === 0 || p.currencies.includes(currency));
}

/** Drops the provider cache; tests call it after changing env. */
export function resetProviders(): void {
  cache = null;
}
