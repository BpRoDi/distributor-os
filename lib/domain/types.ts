export type Role = "brand_admin" | "brand_staff" | "distributor_user";
export type OrderStatus = "Draft" | "Submitted" | "Confirmed" | "Ready to Ship" | "Shipped" | "Delivered" | "Cancelled";
export type ThreadType = "Order Thread" | "Product Inquiry" | "Change Request";
export type ThreadStatus = "Open" | "Resolved";

export type Product = {
  id: string;
  brand_id: string;
  name: string;
  sku: string;
  category: string;
  moq: number;
  wholesale_price: number;
  distributor_price: number;
  stock: number;
  reserved: number;
  status: "Available" | "Low Stock" | "Out of Stock";
};

export type Order = {
  id: string;
  brand_id: string;
  distributor_id: string;
  amount: number;
  status: OrderStatus;
  payment_status: string;
  delivery_eta: string | null;
};

export type MessageThread = {
  id: string;
  brand_id: string;
  distributor_id: string;
  type: ThreadType;
  status: ThreadStatus;
  topic: string;
  order_id?: string | null;
  sku?: string | null;
};
