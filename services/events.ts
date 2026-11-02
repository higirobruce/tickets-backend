/** Shapes an event for public responses: adds `remaining` per package and derives `soldOut`. */
export function publicEvent(doc: any) {
  const event = typeof doc?.toObject === "function" ? doc.toObject() : { ...doc };
  event.packages = (event.packages || []).map((pkg: any) => {
    const remaining = typeof pkg.capacity === "number" ? Math.max(0, pkg.capacity - (pkg.sold || 0)) : null;
    return { ...pkg, remaining, soldOut: Boolean(pkg.soldOut) || remaining === 0 };
  });
  return event;
}

/**
 * Merges an incoming package list into the stored one so `sold` survives edits.
 * Returns an error message when a capacity would drop below what is already sold.
 */
export function mergePackages(existing: any[], incoming: any[]): { packages?: any[]; error?: string } {
  const byId = new Map(existing.map((p: any) => [String(p._id), p]));
  const packages = incoming.map((pkg: any) => {
    const current = pkg._id ? byId.get(String(pkg._id)) : undefined;
    const sold = current?.sold || 0;
    const capacity = pkg.capacity === "" || pkg.capacity === null ? undefined : pkg.capacity;
    return { ...pkg, capacity, sold };
  });
  const bad = packages.find((p) => typeof p.capacity === "number" && p.capacity < p.sold);
  if (bad) return { error: `"${bad.title}" already has ${bad.sold} tickets sold; capacity cannot be below that` };
  return { packages };
}
