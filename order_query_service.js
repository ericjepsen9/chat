function queryOrders({ db, authUser, searchParams, isAdmin }) {
  const sellerId = String(searchParams.get('sellerId') || '');
  const requestedUserId = String(searchParams.get('userId') || '').trim();
  const adminUser = isAdmin(authUser);
  const queryUserId = requestedUserId || authUser.id;
  const userId = adminUser ? queryUserId : authUser.id;
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit')) || 50, 1), 200);
  const offset = Math.max(parseInt(searchParams.get('offset')) || 0, 0);

  // Single-pass: collect matching orders into a pre-sorted result
  // Orders are stored newest-first (unshift on create), so iterate in order
  const orders = db.orders || [];
  const matched = [];
  let total = 0;
  const end = offset + limit;
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    const deletedBy = Array.isArray(o.deletedBy) ? o.deletedBy : [];
    if (!adminUser && deletedBy.includes(authUser.id)) continue;
    if (adminUser && userId && deletedBy.includes(userId)) continue;
    if (sellerId) {
      if (adminUser) { if (o.sellerId !== sellerId) continue; }
      else { if (o.sellerId !== sellerId || (o.buyerId !== authUser.id && o.sellerId !== authUser.id)) continue; }
    } else {
      if (o.buyerId !== userId && o.sellerId !== userId) continue;
    }
    if (total >= offset && total < end) matched.push(o);
    total++;
  }
  // Sort only the page (orders are generally newest-first, but ensure correctness)
  matched.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { orders: matched, total, limit, offset, hasMore: end < total };
}

module.exports = {
  queryOrders,
};
