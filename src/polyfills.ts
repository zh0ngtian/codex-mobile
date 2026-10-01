export function installObjectHasOwnPolyfill(
  objectConstructor: typeof Object = Object,
) {
  if (typeof objectConstructor.hasOwn === "function") return;
  Object.defineProperty(objectConstructor, "hasOwn", {
    configurable: true,
    writable: true,
    value: (value: object, property: PropertyKey) =>
      Object.prototype.hasOwnProperty.call(value, property),
  });
}

installObjectHasOwnPolyfill();
