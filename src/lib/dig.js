/**
 * Shape-agnostic object traversal.
 *
 * LinkedIn reshapes its API envelopes far more often than it renames the leaf
 * keys inside them. Hard-coding `response.data.elements[0].hitInfo...` breaks on
 * the next deploy; searching for a *structure* does not. Everything downstream
 * is built on these four primitives.
 */
(function (root) {
  const SNS = (root.SNS = root.SNS || {});
  const MAX_DEPTH = 14;

  /** Resolve a dotted path, numeric segments indexing arrays: `a.0.b`. */
  function dig(obj, path) {
    let cur = obj;
    for (const part of String(path).split(".")) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[part];
    }
    return cur;
  }

  const isEmpty = (v) =>
    v === undefined ||
    v === null ||
    v === "" ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

  /** First non-empty value among candidate paths, tried in priority order. */
  function digAny(obj, paths) {
    for (const path of paths) {
      const value = dig(obj, path);
      if (!isEmpty(value)) return value;
    }
    return undefined;
  }

  /** Depth-first walk over plain objects and arrays, with cycle protection. */
  function walk(node, visit) {
    const seen = new WeakSet();

    (function descend(current, depth) {
      if (!current || typeof current !== "object" || depth > MAX_DEPTH) return;
      if (seen.has(current)) return;
      seen.add(current);

      if (Array.isArray(current)) {
        for (const item of current) descend(item, depth + 1);
        return;
      }

      if (visit(current) === false) return; // visitor claimed this subtree
      for (const key of Object.keys(current)) descend(current[key], depth + 1);
    })(node, 0);
  }

  /** Every object anywhere in `tree` satisfying `predicate`, in document order. */
  function collect(tree, predicate) {
    const found = [];
    walk(tree, (node) => {
      if (predicate(node)) found.push(node);
    });
    return found;
  }

  /**
   * First non-empty value stored under any of `keys`, at any depth. The escape
   * hatch for when a field moved but kept its name.
   */
  function deepGet(tree, keys, accept) {
    const wanted = new Set(keys);
    let result;

    walk(tree, (node) => {
      for (const key of wanted) {
        const value = node[key];
        if (isEmpty(value)) continue;
        if (accept && !accept(value)) continue;
        result = value;
        return false;
      }
    });

    return result;
  }

  Object.assign(SNS, { dig, digAny, walk, collect, deepGet, isEmpty });
})(typeof window !== "undefined" ? window : globalThis);
