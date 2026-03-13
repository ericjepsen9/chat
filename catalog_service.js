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
  const filtered = q ? mallItems.filter((item) => item._searchText && item._searchText.includes(q)) : mallItems;
  const limit = Math.min(Math.max(parseInt(rawLimit) || 50, 1), 200);
  const offset = Math.max(parseInt(rawOffset) || 0, 0);
  const paged = filtered.slice(offset, offset + limit);
  return { items: paged, total: filtered.length, limit, offset, hasMore: offset + limit < filtered.length };
}

module.exports = {
  buildUserStoreItems,
  queryMallItems,
};
