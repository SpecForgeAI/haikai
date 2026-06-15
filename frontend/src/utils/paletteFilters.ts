/**
 * Filter items by search query (case-insensitive substring match on name field)
 */
export function filterItemsBySearch<T extends { name: string }>(
  items: T[],
  searchQuery: string
): T[] {
  if (!searchQuery || searchQuery.trim() === '') {
    return items;
  }

  const lowerQuery = searchQuery.toLowerCase().trim();

  return items.filter((item) =>
    item.name.toLowerCase().includes(lowerQuery)
  );
}
