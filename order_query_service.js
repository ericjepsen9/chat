function queryOrders({ db, authUser, searchParams, isAdmin }) {
  const sellerId = String(searchParams.get('sellerId') || '');
  const requestedUserId = String(searchParams.get('userId') || '').trim();
  const adminUser = isAdmin(authUser);
  const queryUserId = requestedUserId || authUser.id;
  const userId = adminUser ? queryUserId : authUser.id;
  const allOrders = (db.orders || []).filter((o) => {
    const deletedBy = Array.isArray(o.deletedBy) ? o.deletedBy : [];
    if (!adminUser && deletedBy.includes(authUser.id)) return false;
    if (adminUser && userId && deletedBy.includes(userId)) return false;
    if (sellerId) {
      if (adminUser) return o.sellerId === sellerId;
      return o.sellerId === sellerId && (o.buyerId === authUser.id || o.sellerId === authUser.id);
    }
    return o.buyerId === userId || o.sellerId === userId;
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit')) || 50, 1), 200);
  const offset = Math.max(parseInt(searchParams.get('offset')) || 0, 0);
  const orders = allOrders.slice(offset, offset + limit);
  return { orders, total: allOrders.length, limit, offset, hasMore: offset + limit < allOrders.length };
}

module.exports = {
  queryOrders,
};
