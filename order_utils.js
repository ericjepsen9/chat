function formatOrderSummary(items = []) {
  return items.map((item) => `${item.title}(${item.spec}) x${item.quantity}`).join('，');
}

module.exports = {
  formatOrderSummary,
};
