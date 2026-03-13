function buildUserStoreItems({ usersById, sellerId }) {
  const seller = usersById.get(sellerId);
  if (!seller) return { ok: false, status: 404, error: 'not_found' };
  const allProducts = seller.products || [];
  const items = [];
  for (let i = 0; i < allProducts.length; i++) {
    const product = allProducts[i];
    if (product.listed === false) continue;
    items.push({
      id: product.id,
      title: product.title,
      category: product.category,
      desc: product.desc,
      price: product.price,
      image: product.image,
      imageUrl: product.image,
      specs: Array.isArray(product.specs) && product.specs.length ? product.specs : ['默认规格'],
      stock: product.stock,
      listed: product.listed,
      createdAt: product.createdAt,
    });
  }
  return { ok: true, status: 200, payload: { items } };
}

function queryMallItems({ mallItems, keyword, limit: rawLimit, offset: rawOffset }) {
  const q = String(keyword || '').toLowerCase();
  const limit = Math.min(Math.max(parseInt(rawLimit) || 50, 1), 200);
  const offset = Math.max(parseInt(rawOffset) || 0, 0);
  // When no keyword, use direct slice to avoid allocating a full copy
  if (!q) {
    const paged = mallItems.slice(offset, offset + limit);
    return { items: paged, total: mallItems.length, limit, offset, hasMore: offset + limit < mallItems.length };
  }
  // Single-pass: skip offset items, collect limit items, count total
  const paged = [];
  let total = 0;
  const end = offset + limit;
  for (let i = 0; i < mallItems.length; i++) {
    const item = mallItems[i];
    if (!item._searchText || !item._searchText.includes(q)) continue;
    if (total >= offset && total < end) paged.push(item);
    total++;
  }
  return { items: paged, total, limit, offset, hasMore: end < total };
}

module.exports = {
  buildUserStoreItems,
  queryMallItems,
};
