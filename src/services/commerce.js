// Course pricing and purchases. Entitlement is decided by the backend (an enrolment row: free enrolment, purchase or
// assignment); this module only formats prices and drives the checkout conversation with the API.
import { isBackendOnline, getUser } from "../lib/store.js";
import { api } from "./api.js";
import { getEnrollment } from "./learning.js";

export { CURRENCIES, isFree, formatPrice, priceLabel, priceTone } from "./pricing.js";
import { isFree } from "./pricing.js";

/**
 * Whether the signed-in user may open this course's content. Online this is the server's answer; offline (demo
 * mode) free courses are open and paid ones need a local enrolment (which only a purchase or assignment creates).
 */
export async function courseAccess(course) {
  const user = getUser();
  if (!user) return { free: isFree(course), canAccess: false, entitled: false, canPurchase: false };
  if (isBackendOnline()) {
    try { return await api.courseAccess(course.id); }
    catch (err) { if (err.status !== 0) throw err; }
  }
  const e = getEnrollment(user.id, course.id);
  const editor = user.role !== "learner";
  return { free: isFree(course), priceCents: course.price || 0, currency: course.currency || "INR", entitled: !!e, source: e?.source, canAccess: editor || isFree(course) || !!e, canPurchase: false, offline: true };
}

export const paymentsStatus = () => (isBackendOnline() ? api.paymentsStatus().catch(() => ({ provider: "none", available: false, mock: false })) : Promise.resolve({ provider: "none", available: false, mock: false }));
export const startPurchase = (courseId) => api.createOrder(courseId);
export const getOrder = (id) => api.getOrder(id);
export const cancelOrder = (id) => api.cancelOrder(id);
export const mockOutcome = (id, outcome) => api.mockOrderOutcome(id, outcome);
export const myOrders = () => (isBackendOnline() ? api.myOrders().catch(() => []) : Promise.resolve([]));
