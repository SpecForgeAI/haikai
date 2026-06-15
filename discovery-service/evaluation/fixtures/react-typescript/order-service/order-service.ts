
export interface OrderItem { sku: string; price: number; quantity: number; }

// Genuine business logic
export function calculateOrderTotal(items: OrderItem[]): number {
  return items.reduce((sum, i) => sum + i.price * i.quantity, 0);
}

export function applyDiscount(total: number, percent: number): number {
  return total * (1 - percent / 100);
}

// CRUD-prefixed — excluded from business_logic
export function fetchOrder(id: number) { return null; }
