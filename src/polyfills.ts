type MapWithComputed<K, V> = Map<K, V> & {
  getOrInsertComputed?: (key: K, callback: (key: K) => V) => V;
};

const mapPrototype = Map.prototype as MapWithComputed<unknown, unknown>;
if (typeof mapPrototype.getOrInsertComputed !== "function") {
  Object.defineProperty(Map.prototype, "getOrInsertComputed", {
    configurable: true,
    writable: true,
    value<K, V>(this: Map<K, V>, key: K, callback: (key: K) => V): V {
      if (this.has(key)) return this.get(key) as V;
      const value = callback(key);
      this.set(key, value);
      return value;
    },
  });
}