// Intentionally buggy demo input. Fix a COPY in your task workspace.
export function cartTotal(items) {
  return items.reduce((total, item) => total + item.price, 0);
}
