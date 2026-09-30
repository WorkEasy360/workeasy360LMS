// Pure price formatting shared by cards, details and checkout (no data dependencies).
export const CURRENCIES = [{ value: "INR", label: "INR ₹" }, { value: "USD", label: "USD $" }, { value: "EUR", label: "EUR €" }, { value: "GBP", label: "GBP £" }];
const SYMBOL = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };
export const isFree = (course) => !course || !(course.price > 0);
export function formatPrice(cents, currency = "INR") {
  const amount = (cents || 0) / 100;
  const s = SYMBOL[currency] || currency + " ";
  return s + (Number.isInteger(amount) ? amount.toLocaleString() : amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}
/** "FREE" or "PAID · ₹499" — what cards and details show. */
export const priceLabel = (course) => (isFree(course) ? "FREE" : `PAID · ${formatPrice(course.price, course.currency)}`);
/** Badge tone for the price label. */
export const priceTone = (course) => (isFree(course) ? "success" : "warning");
