function formatOrderSummary(items = []) {
  return items.map((item) => `${item.title}(${item.spec}) x${item.quantity}`).join('，');
}

function normalizeText(value, maxLen) {
  return String(value || '').trim().slice(0, maxLen);
}

function findOrderById(orderId, { ordersById, db } = {}) {
  return ordersById?.get(orderId) || (db.orders || []).find((item) => item.id === orderId) || null;
}

module.exports = {
  formatOrderSummary,
  normalizeText,
  findOrderById,
};
