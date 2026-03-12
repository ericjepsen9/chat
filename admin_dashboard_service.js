function buildAdminDashboardData(db) {
  const users = db.users || [];
  const orders = db.orders || [];
  const userById = new Map(users.map((user) => [user.id, user]));

  const products = users.flatMap((user) => Array.isArray(user.products)
    ? user.products.map((product) => ({
      ...product,
      sellerId: user.id,
      sellerName: user.displayName || user.nickname || user.username,
    }))
    : []);

  const orderCountBySeller = new Map();
  for (const order of orders) {
    if (!order?.sellerId) continue;
    orderCountBySeller.set(order.sellerId, (orderCountBySeller.get(order.sellerId) || 0) + 1);
  }

  const blacklistCountByUser = new Map();
  let blacklistLinks = 0;
  for (const user of users) {
    const outgoing = Array.isArray(user.blacklist) ? user.blacklist.length : 0;
    blacklistLinks += outgoing;
    blacklistCountByUser.set(user.id, outgoing);
  }

  let broadcastCount = 0;
  for (const message of (db.messages || [])) { if (message.type === 'broadcast_card') broadcastCount++; }
  let pendingOrders = 0;
  for (const order of orders) { if (order.status !== 'completed') pendingOrders++; }
  const stats = {
    users: users.length,
    products: products.length,
    orders: orders.length,
    broadcasts: broadcastCount,
    blacklistLinks,
    pendingOrders,
  };

  const recentOrders = orders.slice(0, 20).map((order) => {
    const buyer = userById.get(order.buyerId);
    const seller = userById.get(order.sellerId);
    return {
      id: order.id,
      total: order.total,
      status: order.status,
      buyerName: buyer ? (buyer.displayName || buyer.nickname || buyer.username) : '买家',
      sellerName: seller ? (seller.displayName || seller.nickname || seller.username) : '卖家',
      summary: (order.items || []).map((item) => `${item.title} x${item.quantity}`).join('，'),
    };
  });

  const userList = users.slice(0, 30).map((user) => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.nickname || user.username,
    sellerOrderCount: orderCountBySeller.get(user.id) || 0,
    productCount: Array.isArray(user.products) ? user.products.length : 0,
    blacklistCount: blacklistCountByUser.get(user.id) || 0,
  }));

  const productList = products.slice(0, 30).map((product) => ({
    id: product.id,
    title: product.title,
    price: product.price,
    sellerName: product.sellerName,
  }));

  const reportList = [];
  if (blacklistLinks) reportList.push({ title: '黑名单关系提醒', summary: `当前共有 ${blacklistLinks} 条黑名单关系` });
  const pending = stats.pendingOrders;
  if (pending) reportList.push({ title: '待完成订单提醒', summary: `当前仍有 ${pending} 笔订单未完成` });

  return { stats, recentOrders, userList, productList, reportList };
}

module.exports = {
  buildAdminDashboardData,
};
