function queryOrders({ db, authUser, searchParams, isAdmin }) {
  const sellerId = String(searchParams.get('sellerId') || '');
  const requestedUserId = String(searchParams.get('userId') || '').trim();
  const adminUser = isAdmin(authUser);
  const queryUserId = requestedUserId || authUser.id;
  const userId = adminUser ? queryUserId : authUser.id;
  const orders = (db.orders || []).filter((o) => {
    if (sellerId) {
      if (adminUser) return o.sellerId === sellerId;
      return o.sellerId === sellerId && (o.buyerId === authUser.id || o.sellerId === authUser.id);
    }
    return o.buyerId === userId || o.sellerId === userId;
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { orders };
}

module.exports = {
  queryOrders,
};
