function queryOrders({ db, authUser, searchParams, isAdmin, index }) {
  const sellerId = String(searchParams.get('sellerId') || '');
  const requestedUserId = String(searchParams.get('userId') || '').trim();
  const adminUser = isAdmin(authUser);
  const queryUserId = requestedUserId || authUser.id;
  const userId = adminUser ? queryUserId : authUser.id;
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit')) || 50, 1), 200);
  const offset = Math.max(parseInt(searchParams.get('offset')) || 0, 0);

  // Use indexed lookup when available, fall back to linear scan
  let candidates;
  if (index && sellerId) {
    // Filter by specific seller — use seller index for both admin and normal users
    candidates = index.ordersBySeller.get(sellerId) || [];
  } else if (index && !sellerId && userId) {
    // Merge buyer + seller orders for this user via indexes (Set dedup by id)
    const buyerOrders = index.ordersByBuyer.get(userId) || [];
    const sellerOrders = index.ordersBySeller.get(userId) || [];
    if (!buyerOrders.length) candidates = sellerOrders;
    else if (!sellerOrders.length) candidates = buyerOrders;
    else {
      const seen = new Set();
      candidates = [];
      for (const o of buyerOrders) { seen.add(o.id); candidates.push(o); }
      for (const o of sellerOrders) { if (!seen.has(o.id)) candidates.push(o); }
    }
  } else {
    candidates = db.orders || [];
  }

  // Filter all matching orders first
  const matched = [];
  for (let i = 0; i < candidates.length; i++) {
    const o = candidates[i];
    if (Array.isArray(o.deletedBy) && o.deletedBy.length) {
      if (!(o._deletedBySet instanceof Set)) o._deletedBySet = new Set(o.deletedBy);
      if (!adminUser && o._deletedBySet.has(authUser.id)) continue;
      if (adminUser && userId && o._deletedBySet.has(userId)) continue;
    }
    if (sellerId) {
      if (adminUser) { if (o.sellerId !== sellerId) continue; }
      else { if (o.sellerId !== sellerId || (o.buyerId !== authUser.id && o.sellerId !== authUser.id)) continue; }
    } else {
      if (o.buyerId !== userId && o.sellerId !== userId) continue;
    }
    matched.push(o);
  }
  // Sort all matched orders by newest first, then paginate
  matched.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const total = matched.length;
  const orders = matched.slice(offset, offset + limit);
  return { orders, total, limit, offset, hasMore: offset + limit < total };
}

module.exports = {
  queryOrders,
};
