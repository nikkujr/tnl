import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type Role = 'ADMIN' | 'AGENT';
export interface SessionUser { id: number; email: string; fullName: string; role: Role }
export interface ApiResponse<T> { data: T; meta?: { page: number; limit: number; total?: number } }
export interface Category { id: number; name: string; description: string | null; productCount: number }
export interface DashboardSummary {
  totalOrders: number;
  pendingOrders: number;
  completedOrders: number;
  openOrders: number;
  activeDeliveries: number;
  revenue: number;
  totalCustomers: number;
  totalProducts: number;
  lowStockProducts: number;
  monthlyRevenue: Array<{ month: string; revenue: number }>;
  notifications: DashboardNotification[];
}
export interface DashboardNotification {
  id: string;
  type: 'ORDER' | 'CUSTOMER';
  title: string;
  message: string;
  createdAt: string;
}
export interface Customer {
  id: number;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  assignedAgentId: number | null;
  assignedAgentName: string | null;
}
export interface Product {
  id: number;
  categoryId: number;
  name: string;
  sku: string;
  price: number;
  description: string | null;
  stockOnHand: number;
  stockReserved: number;
  lowStockThreshold: number;
  reorderLevel: number;
  category: string;
}
export interface Order {
  id: number;
  trackingNumber: string;
  customerId: number;
  agentId: number;
  customerName: string;
  agentName: string;
  items: OrderItem[];
  orderStatus: string;
  deliveryStatus: string | null;
  paymentStatus: string;
  paymentMethod: string;
  cashReceived: number | null;
  cashChange: number | null;
  deliveryAddress: string;
  createdAt: string;
}
export interface OrderItem { productId:number; productName:string; sku:string; quantity:number; unitPrice:number }
export interface OrderHistoryEvent { id:number; type:string; message:string; createdAt:string; actorName:string|null }
export interface DeliveryEvent { status:string; notes:string|null; occurredAt:string }
export interface OrderDetail extends Order {
  customerEmail: string;
  customerPhone: string;
  agentEmail: string;
  updatedAt: string;
  history: OrderHistoryEvent[];
  deliveryEvents: DeliveryEvent[];
}
export interface TrackingResult {
  trackingNumber: string;
  orderStatus: string;
  deliveryStatus: string | null;
  deliveryAddress: string;
  events: Array<{
    status: string;
    notes: string | null;
    latitude: number | null;
    longitude: number | null;
    occurredAt: string;
  }>;
}
export interface Lead { id:number; fullName:string; email:string; phone:string; source:string; status:string; assignedAgentId:number|null; assignedAgentName:string|null }
export interface Campaign { id:number; name:string; targetAudience:string; content:string; startDate:string; endDate:string; status:string }
export interface Agent { id:number; fullName:string; email:string; phone:string; commissionRate:number; active:boolean; closedDeals:number }
export interface Commission { id:number; amount:number; rate:number; createdAt:string; orderId:string; customerName:string; agentName:string }
export interface AgentCustomer { id:number; fullName:string; email:string; phone:string; address:string; createdAt:string }
export interface AgentOrder { id:number; trackingNumber:string; customerName:string; orderStatus:string; deliveryStatus:string|null; paymentStatus:string; createdAt:string; amount:number }
export interface AgentCommission { id:number; amount:number; rate:number; createdAt:string; orderId:number; trackingNumber:string; customerName:string }
export interface AgentDetail extends Agent {
  createdAt: string;
  customers: AgentCustomer[];
  orders: AgentOrder[];
  commissions: AgentCommission[];
  totalCommission: number;
}
export interface CreateOrderInput {
  customerId: number;
  agentId?: number;
  items: Array<{ productId:number; quantity:number }>;
  deliveryAddress: string;
  paymentMethod: string;
  cashReceived?: number | null;
}
export interface ImportBatch {
  id: number;
  fileName: string;
  status: 'PROCESSING' | 'NEEDS_REVIEW' | 'CONFIRMED' | 'CANCELLED' | 'FAILED';
  totalRows: number;
  readyRows: number;
  attentionRows: number;
  createdAt: string;
  confirmedAt: string | null;
  liveCounts?: { READY: number; NEEDS_ATTENTION: number; SKIPPED: number };
}
export interface ImportRow {
  id: number;
  sheetName: string;
  section: 'STORE_SALES' | 'HOME_CREDIT' | 'CI_AGENT' | 'CI_PAYMENT';
  rowNumber: number;
  orderDate: string;
  rawCustomerName: string | null;
  rawProductName: string | null;
  rawAgentName: string | null;
  rawImei: string | null;
  rawNote: string | null;
  rawOrNo: string | null;
  unitPrice: number | null;
  cashReceived: number | null;
  paymentStatus: 'PAID' | 'PARTIALLY_PAID';
  paymentMethod: string;
  customerId: number | null;
  customerName: string | null;
  newCustomerName: string | null;
  productId: number | null;
  productName: string | null;
  newProductName: string | null;
  agentId: number;
  agentName: string | null;
  status: 'READY' | 'NEEDS_ATTENTION' | 'SKIPPED';
  issue: string | null;
  createdOrderId: number | null;
}
export interface ImportAgentOption { id: number; fullName: string; email: string }
export interface OrderStats {
  totalOrders: number;
  pendingOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  statusBreakdown: Array<{ status: string; count: number }>;
  monthlyTrend: Array<{ month: string; orders: number; revenue: number }>;
}
export interface ImportRowPatch {
  customerId?: number | null;
  newCustomerName?: string | null;
  productId?: number | null;
  newProductName?: string | null;
  agentId?: number;
  unitPrice?: number;
  cashReceived?: number | null;
  paymentStatus?: 'PAID' | 'PARTIALLY_PAID';
  paymentMethod?: string;
  orderDate?: string;
  skipped?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  login(email: string, password: string): Observable<ApiResponse<{ token: string; user: SessionUser }>> {
    return this.http.post<ApiResponse<{ token: string; user: SessionUser }>>(`${this.baseUrl}/auth/login`, { email, password });
  }

  getDashboard(): Observable<ApiResponse<DashboardSummary>> {
    return this.http.get<ApiResponse<DashboardSummary>>(`${this.baseUrl}/dashboard`);
  }

  getCustomers(options: { search?: string; page?: number; limit?: number; agentId?: number } = {}): Observable<ApiResponse<Customer[]>> {
    let params = new HttpParams();
    if (options.search) params = params.set('search', options.search);
    if (options.page) params = params.set('page', options.page);
    if (options.limit) params = params.set('limit', options.limit);
    if (options.agentId) params = params.set('agentId', options.agentId);
    return this.http.get<ApiResponse<Customer[]>>(`${this.baseUrl}/customers`, { params });
  }

  createCustomer(input: Omit<Customer, 'id' | 'assignedAgentName'>): Observable<ApiResponse<Customer>> {
    return this.http.post<ApiResponse<Customer>>(`${this.baseUrl}/customers`, input);
  }

  updateCustomer(id: number, input: Omit<Customer, 'id' | 'assignedAgentName'>): Observable<ApiResponse<Customer>> {
    return this.http.put<ApiResponse<Customer>>(`${this.baseUrl}/customers/${id}`, input);
  }

  deleteCustomer(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/customers/${id}`);
  }

  getProducts(options: { search?: string; page?: number; limit?: number; categoryId?: number } = {}): Observable<ApiResponse<Product[]>> {
    let params = new HttpParams();
    if (options.search) params = params.set('search', options.search);
    if (options.page) params = params.set('page', options.page);
    if (options.limit) params = params.set('limit', options.limit);
    if (options.categoryId) params = params.set('categoryId', options.categoryId);
    return this.http.get<ApiResponse<Product[]>>(`${this.baseUrl}/products`, { params });
  }

  getCategories(options: { search?: string; page?: number; limit?: number } = {}): Observable<ApiResponse<Category[]>> {
    let params = new HttpParams();
    if (options.search) params = params.set('search', options.search);
    if (options.page) params = params.set('page', options.page);
    if (options.limit) params = params.set('limit', options.limit);
    return this.http.get<ApiResponse<Category[]>>(`${this.baseUrl}/categories`, { params });
  }

  createCategory(input: { name: string; description: string | null }): Observable<ApiResponse<Category>> {
    return this.http.post<ApiResponse<Category>>(`${this.baseUrl}/categories`, input);
  }

  updateCategory(id: number, input: { name: string; description: string | null }): Observable<ApiResponse<Category>> {
    return this.http.put<ApiResponse<Category>>(`${this.baseUrl}/categories/${id}`, input);
  }

  deleteCategory(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/categories/${id}`);
  }

  createProduct(input: { categoryId: number; name: string; sku: string; price: number; description: string | null }): Observable<ApiResponse<Product>> {
    return this.http.post<ApiResponse<Product>>(`${this.baseUrl}/products`, input);
  }

  updateProduct(id: number, input: { categoryId: number; name: string; sku: string; price: number; description: string | null }): Observable<ApiResponse<Product>> {
    return this.http.put<ApiResponse<Product>>(`${this.baseUrl}/products/${id}`, input);
  }

  deleteProduct(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/products/${id}`);
  }

  adjustInventory(productId: number, type: 'ADD' | 'DEDUCT', quantity: number, note?: string): Observable<ApiResponse<{ productId: number; stockOnHand: number }>> {
    return this.http.post<ApiResponse<{ productId: number; stockOnHand: number }>>(
      `${this.baseUrl}/products/${productId}/inventory-adjustments`,
      { type, quantity, note }
    );
  }

  updateInventorySettings(productId: number, lowStockThreshold: number, reorderLevel: number): Observable<ApiResponse<unknown>> {
    return this.http.put<ApiResponse<unknown>>(`${this.baseUrl}/products/${productId}/inventory-settings`, { lowStockThreshold, reorderLevel });
  }

  getOrders(options: { page?: number; limit?: number; search?: string; status?: string } = {}): Observable<ApiResponse<Order[]>> {
    let params = new HttpParams();
    if (options.page) params = params.set('page', options.page);
    if (options.limit) params = params.set('limit', options.limit);
    if (options.search) params = params.set('search', options.search);
    if (options.status) params = params.set('status', options.status);
    return this.http.get<ApiResponse<Order[]>>(`${this.baseUrl}/orders`, { params });
  }

  getOrder(id: number): Observable<ApiResponse<OrderDetail>> {
    return this.http.get<ApiResponse<OrderDetail>>(`${this.baseUrl}/orders/${id}`);
  }

  createOrder(input: CreateOrderInput): Observable<ApiResponse<{ id: number; trackingNumber: string; orderStatus: string }>> {
    return this.http.post<ApiResponse<{ id: number; trackingNumber: string; orderStatus: string }>>(`${this.baseUrl}/orders`, input);
  }

  updateOrder(id: number, input: CreateOrderInput): Observable<ApiResponse<unknown>> {
    return this.http.put<ApiResponse<unknown>>(`${this.baseUrl}/orders/${id}`, input);
  }

  getOrderStats(): Observable<ApiResponse<OrderStats>> {
    return this.http.get<ApiResponse<OrderStats>>(`${this.baseUrl}/orders/stats`);
  }

  decideOrder(orderId: number, decision: 'APPROVE' | 'REJECT'): Observable<ApiResponse<{ id: number; orderStatus: string }>> {
    return this.http.post<ApiResponse<{ id: number; orderStatus: string }>>(`${this.baseUrl}/orders/${orderId}/decision`, { decision });
  }

  updatePaymentStatus(orderId: number, paymentStatus: 'UNPAID'|'PARTIALLY_PAID'|'PAID', paymentMethod: string, cashReceived: number | null): Observable<ApiResponse<unknown>> {
    return this.http.patch<ApiResponse<unknown>>(`${this.baseUrl}/orders/${orderId}/payment-status`, { paymentStatus, paymentMethod, cashReceived });
  }

  updateDeliveryStatus(orderId: number, deliveryStatus: 'PREPARING'|'DISPATCHED'|'IN_TRANSIT'|'OUT_FOR_DELIVERY'|'DELIVERED', notes?: string): Observable<ApiResponse<unknown>> {
    return this.http.patch<ApiResponse<unknown>>(`${this.baseUrl}/orders/${orderId}/delivery-status`, { deliveryStatus, notes });
  }

  deleteOrder(orderId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/orders/${orderId}`);
  }

  track(trackingNumber: string): Observable<ApiResponse<TrackingResult>> {
    return this.http.get<ApiResponse<TrackingResult>>(`${this.baseUrl}/tracking/${encodeURIComponent(trackingNumber)}`);
  }
  getLeads(options: { search?: string; source?: string } = {}): Observable<ApiResponse<Lead[]>> {
    let params = new HttpParams();
    if (options.search) params = params.set('search', options.search);
    if (options.source) params = params.set('source', options.source);
    return this.http.get<ApiResponse<Lead[]>>(`${this.baseUrl}/leads`, { params });
  }
  createLead(input: Omit<Lead,'id'|'assignedAgentName'>): Observable<ApiResponse<Lead>> { return this.http.post<ApiResponse<Lead>>(`${this.baseUrl}/leads`,input); }
  updateLead(id:number,input:Omit<Lead,'id'|'assignedAgentName'>): Observable<ApiResponse<Lead>> { return this.http.put<ApiResponse<Lead>>(`${this.baseUrl}/leads/${id}`,input); }
  convertLead(id:number): Observable<ApiResponse<unknown>> { return this.http.post<ApiResponse<unknown>>(`${this.baseUrl}/leads/${id}/convert`,{}); }
  deleteLead(id:number): Observable<void> { return this.http.delete<void>(`${this.baseUrl}/leads/${id}`); }
  getCampaigns(search = ''): Observable<ApiResponse<Campaign[]>> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);
    return this.http.get<ApiResponse<Campaign[]>>(`${this.baseUrl}/campaigns`, { params });
  }
  createCampaign(input:Omit<Campaign,'id'>): Observable<ApiResponse<Campaign>> { return this.http.post<ApiResponse<Campaign>>(`${this.baseUrl}/campaigns`,input); }
  updateCampaign(id:number,input:Omit<Campaign,'id'>): Observable<ApiResponse<Campaign>> { return this.http.put<ApiResponse<Campaign>>(`${this.baseUrl}/campaigns/${id}`,input); }
  sendCampaign(id:number): Observable<ApiResponse<{messageId:string;recipientCount:number}>> { return this.http.post<ApiResponse<{messageId:string;recipientCount:number}>>(`${this.baseUrl}/campaigns/${id}/send`,{}); }
  deleteCampaign(id:number): Observable<void> { return this.http.delete<void>(`${this.baseUrl}/campaigns/${id}`); }
  getAgents(options: { activeOnly?: boolean; search?: string } = {}): Observable<ApiResponse<Agent[]>> {
    let params = new HttpParams();
    if (options.activeOnly) params = params.set('activeOnly', 'true');
    if (options.search) params = params.set('search', options.search);
    return this.http.get<ApiResponse<Agent[]>>(`${this.baseUrl}/agents`, { params });
  }
  getAgent(id:number): Observable<ApiResponse<AgentDetail>> { return this.http.get<ApiResponse<AgentDetail>>(`${this.baseUrl}/agents/${id}`); }
  createAgent(input:{fullName:string;email:string;phone:string;password:string;commissionRate:number}):Observable<ApiResponse<Agent>>{return this.http.post<ApiResponse<Agent>>(`${this.baseUrl}/agents`,input);}
  updateAgent(id:number,input:{fullName:string;email:string;phone:string;password?:string;commissionRate:number}):Observable<ApiResponse<Agent>>{return this.http.put<ApiResponse<Agent>>(`${this.baseUrl}/agents/${id}`,input);}
  activateAgent(id:number):Observable<ApiResponse<{id:number;active:boolean}>>{return this.http.post<ApiResponse<{id:number;active:boolean}>>(`${this.baseUrl}/agents/${id}/activate`,{});}
  deleteAgent(id:number): Observable<void> { return this.http.delete<void>(`${this.baseUrl}/agents/${id}`); }
  getCommissions(options: { search?: string; from?: string; to?: string } = {}): Observable<ApiResponse<Commission[]>> {
    let params = new HttpParams();
    if (options.search) params = params.set('search', options.search);
    if (options.from) params = params.set('from', options.from);
    if (options.to) params = params.set('to', options.to);
    return this.http.get<ApiResponse<Commission[]>>(`${this.baseUrl}/commissions`, { params });
  }

  uploadSalesReport(file: File): Observable<ApiResponse<{ batchId: number; totalRows: number; readyRows: number; attentionRows: number; skippedSheets: string[] }>> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<ApiResponse<{ batchId: number; totalRows: number; readyRows: number; attentionRows: number; skippedSheets: string[] }>>(`${this.baseUrl}/imports/sales-report`, formData);
  }
  getImportBatches(): Observable<ApiResponse<ImportBatch[]>> { return this.http.get<ApiResponse<ImportBatch[]>>(`${this.baseUrl}/imports`); }
  getImportBatch(id: number): Observable<ApiResponse<ImportBatch>> { return this.http.get<ApiResponse<ImportBatch>>(`${this.baseUrl}/imports/${id}`); }
  getImportAgentOptions(): Observable<ApiResponse<ImportAgentOption[]>> { return this.http.get<ApiResponse<ImportAgentOption[]>>(`${this.baseUrl}/imports/meta/agents`); }
  getImportRows(batchId: number, options: { section?: string; status?: string; page?: number; limit?: number } = {}): Observable<ApiResponse<ImportRow[]>> {
    let params = new HttpParams();
    if (options.section) params = params.set('section', options.section);
    if (options.status) params = params.set('status', options.status);
    params = params.set('page', options.page ?? 1).set('limit', options.limit ?? 50);
    return this.http.get<ApiResponse<ImportRow[]>>(`${this.baseUrl}/imports/${batchId}/rows`, { params });
  }
  patchImportRow(batchId: number, rowId: number, patch: ImportRowPatch): Observable<ApiResponse<{ id: number; status: string; issue: string | null }>> {
    return this.http.patch<ApiResponse<{ id: number; status: string; issue: string | null }>>(`${this.baseUrl}/imports/${batchId}/rows/${rowId}`, patch);
  }
  cancelImportBatch(batchId: number): Observable<void> { return this.http.delete<void>(`${this.baseUrl}/imports/${batchId}`); }
  confirmImportBatch(batchId: number): Observable<ApiResponse<{ batchId: number; ordersCreated: number; newCustomers: number; newProducts: number }>> {
    return this.http.post<ApiResponse<{ batchId: number; ordersCreated: number; newCustomers: number; newProducts: number }>>(`${this.baseUrl}/imports/${batchId}/confirm`, {});
  }
}
