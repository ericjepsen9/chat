function buildAdminDashboardData(db) {
  const users = db.users || [];
  const orders = db.orders || [];
  const userById = new Map();
  for (let i = 0; i < users.length; i++) userById.set(users[i].id, users[i]);

  // Single-pass product collection without spread
  const products = [];
  for (let u = 0; u < users.length; u++) {
    const user = users[u];
    const userProducts = user.products;
    if (!Array.isArray(userProducts)) continue;
    const sellerName = user.displayName || user.nickname || user.username;
    for (let p = 0; p < userProducts.length; p++) {
      const product = userProducts[p];
      products.push({
        id: product.id,
        title: product.title,
        price: product.price,
        sellerId: user.id,
        sellerName,
      });
    }
  }

  // Single-pass order stats
  const orderCountBySeller = new Map();
  let pendingOrders = 0;
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    if (order.sellerId) orderCountBySeller.set(order.sellerId, (orderCountBySeller.get(order.sellerId) || 0) + 1);
    if (order.status !== 'completed') pendingOrders++;
  }

  let blacklistLinks = 0;
  const blacklistCountByUser = new Map();
  for (let i = 0; i < users.length; i++) {
    const outgoing = Array.isArray(users[i].blacklist) ? users[i].blacklist.length : 0;
    blacklistLinks += outgoing;
    blacklistCountByUser.set(users[i].id, outgoing);
  }

  let broadcastCount = 0;
  const messages = db.messages || [];
  for (let i = 0; i < messages.length; i++) { if (messages[i].type === 'broadcast_card') broadcastCount++; }

  const stats = {
    users: users.length,
    products: products.length,
    orders: orders.length,
    broadcasts: broadcastCount,
    blacklistLinks,
    pendingOrders,
  };

  // Build recent orders (already newest-first)
  const recentCount = Math.min(orders.length, 20);
  const recentOrders = new Array(recentCount);
  for (let i = 0; i < recentCount; i++) {
    const order = orders[i];
    const buyer = userById.get(order.buyerId);
    const seller = userById.get(order.sellerId);
    const items = order.items || [];
    const summaryParts = new Array(items.length);
    for (let j = 0; j < items.length; j++) summaryParts[j] = items[j].title + ' x' + items[j].quantity;
    recentOrders[i] = {
      id: order.id,
      total: order.total,
      status: order.status,
      buyerName: buyer ? (buyer.displayName || buyer.nickname || buyer.username) : '买家',
      sellerName: seller ? (seller.displayName || seller.nickname || seller.username) : '卖家',
      summary: summaryParts.join('，'),
    };
  }

  const userListCount = Math.min(users.length, 30);
  const userList = new Array(userListCount);
  for (let i = 0; i < userListCount; i++) {
    const user = users[i];
    userList[i] = {
      id: user.id,
      username: user.username,
      displayName: user.displayName || user.nickname || user.username,
      sellerOrderCount: orderCountBySeller.get(user.id) || 0,
      productCount: Array.isArray(user.products) ? user.products.length : 0,
      blacklistCount: blacklistCountByUser.get(user.id) || 0,
    };
  }

  const productListCount = Math.min(products.length, 30);
  const productList = new Array(productListCount);
  for (let i = 0; i < productListCount; i++) {
    productList[i] = {
      id: products[i].id,
      title: products[i].title,
      price: products[i].price,
      sellerName: products[i].sellerName,
    };
  }

  const reportList = [];
  if (blacklistLinks) reportList.push({ title: '黑名单关系提醒', summary: `当前共有 ${blacklistLinks} 条黑名单关系` });
  if (pendingOrders) reportList.push({ title: '待完成订单提醒', summary: `当前仍有 ${pendingOrders} 笔订单未完成` });

  return { stats, recentOrders, userList, productList, reportList };
}

module.exports = {
  buildAdminDashboardData,
};
