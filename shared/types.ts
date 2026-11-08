export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  base_unit: string;
  purchase_cost: string;
  pieces_per_base: string | null;
  selling_price: string | null;
  min_stock: string;
  stock_verified: boolean;
  active: boolean;
  quantity: string;
  average_cost: string;
  category?: string;
  supplier_names?: string[];
}
export interface Supplier {
  id: string;
  name: string;
  contact?: string;
  whatsapp?: string;
  address?: string;
  payment_days: number;
  lead_days: number;
}
export type FieldStatus =
  'detected' | 'needs_review' | 'unreadable' | 'manually_corrected' | 'confirmed';
export interface ParsedLine {
  id: string;
  raw: string;
  code: string | null;
  name: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  discount: number | null;
  tax: number | null;
  lineTotal: number | null;
  productId: string | null;
  receivedQuantity: number | null;
  damagedQuantity: number;
  status: FieldStatus;
  warnings: string[];
  evidence?: { page: number; bbox?: { x0: number; y0: number; x1: number; y1: number } };
}
export interface InvoiceDraft {
  supplier: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  deliveryDate: string | null;
  dueDate: string | null;
  subtotal: number | null;
  discount: number | null;
  tax: number | null;
  total: number | null;
  rounding?: number | null;
  lines: ParsedLine[];
  warnings: string[];
  rawText: string;
  reviewed: boolean;
}
export interface Insight {
  id: string;
  entityType: string;
  entityId: string;
  tag: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  reason: string;
  metric?: number;
  recommendation: string;
  evidence: Record<string, unknown>;
}
export interface Snapshot {
  products: Product[];
  balances: Record<string, unknown>[];
  suppliers: Supplier[];
  locations: { id: string; name: string }[];
  invoices: Record<string, unknown>[];
  orders: Record<string, unknown>[];
  sales: Record<string, unknown>[];
  movements: Record<string, unknown>[];
  imports: Record<string, unknown>[];
  source: Record<string, unknown>[];
  tags: Record<string, unknown>[];
  drafts: Record<string, unknown>[];
  summary: Record<string, string | number>;
  business: { id: string; name: string };
  user: { id: string; name: string; role: string; email: string };
  conversions: { product_id: string; unit: string; multiplier: string }[];
  mappings: {
    product_id: string;
    supplier_id: string;
    supplier_code: string;
    alias: string | null;
  }[];
  prices: Record<string, unknown>[];
}
