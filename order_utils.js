function formatOrderSummary(items = []) {
  const parts = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    parts[i] = `${item.title}(${item.spec}) x${item.quantity}`;
  }
  return parts.join('，');
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
