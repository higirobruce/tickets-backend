"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicEvent = publicEvent;
exports.mergePackages = mergePackages;
/** Shapes an event for public responses: adds `remaining` per package and derives `soldOut`. */
function publicEvent(doc) {
    const event = typeof (doc === null || doc === void 0 ? void 0 : doc.toObject) === "function" ? doc.toObject() : Object.assign({}, doc);
    event.packages = (event.packages || []).map((pkg) => {
        const remaining = typeof pkg.capacity === "number" ? Math.max(0, pkg.capacity - (pkg.sold || 0)) : null;
        return Object.assign(Object.assign({}, pkg), { remaining, soldOut: Boolean(pkg.soldOut) || remaining === 0 });
    });
    return event;
}
/**
 * Merges an incoming package list into the stored one so `sold` survives edits.
 * Returns an error message when a capacity would drop below what is already sold.
 */
function mergePackages(existing, incoming) {
    const byId = new Map(existing.map((p) => [String(p._id), p]));
    const packages = incoming.map((pkg) => {
        const current = pkg._id ? byId.get(String(pkg._id)) : undefined;
        const sold = (current === null || current === void 0 ? void 0 : current.sold) || 0;
        const capacity = pkg.capacity === "" || pkg.capacity === null ? undefined : pkg.capacity;
        return Object.assign(Object.assign({}, pkg), { capacity, sold });
    });
    const bad = packages.find((p) => typeof p.capacity === "number" && p.capacity < p.sold);
    if (bad)
        return { error: `"${bad.title}" already has ${bad.sold} tickets sold; capacity cannot be below that` };
    return { packages };
}
