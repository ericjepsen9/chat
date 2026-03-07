function buildUserStoreItems({ usersById, sellerId }) {
  const seller = usersById.get(sellerId);
  if (!seller) return { ok: false, status: 404, error: 'not_found' };
  const items = (seller.products || []).map((product) => ({
    ...product,
    imageUrl: product.image,
    specs: Array.isArray(product.specs) ? product.specs : ['默认规格', '标准版', '高配版'],
  }));
  return { ok: true, status: 200, payload: { items } };
}

function queryMallItems({ mallItems, keyword }) {
  const q = String(keyword || '').toLowerCase();
  const filtered = q ? mallItems.filter((item) => item._searchText.includes(q)) : mallItems;
  const items = filtered.map(({ _searchText, ...item }) => item);
  return { items };
}

module.exports = {
  buildUserStoreItems,
  queryMallItems,
};
