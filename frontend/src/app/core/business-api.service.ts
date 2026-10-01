import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { ApiResponse, SessionUser } from './api.service';
export interface CatalogOffer {
  id: number;
  revision: string;
  kind: 'PRODUCT' | 'PACKAGE';
  name: string;
  description: string;
  price: number;
  available: boolean;
  categoryId?: number;
  category?: string;
  components?: Array<{ productId: number; productName: string; quantity: number }>;
}
export interface SalesPackage {
  id: number;
  name: string;
  description: string;
  sellingPrice: number;
  commissionType: 'FIXED' | 'PERCENTAGE';
  commissionValue: number;
  active: boolean;
  available: number;
  components: Array<{ productId: number; productName?: string; quantity: number }>;
}
@Injectable({ providedIn: 'root' })
export class BusinessApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;
  get<T = any>(path: string, query: Record<string, string | number> = {}) {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) params = params.set(key, String(value));
    return this.http.get<ApiResponse<T>>(`${this.base}/${path}`, { params });
  }
  post<T = any>(path: string, body: object = {}) {
    return this.http.post<ApiResponse<T>>(`${this.base}/${path}`, body);
  }
  put<T = any>(path: string, body: object) {
    return this.http.put<ApiResponse<T>>(`${this.base}/${path}`, body);
  }
  patch<T = any>(path: string, body: object) {
    return this.http.patch<ApiResponse<T>>(`${this.base}/${path}`, body);
  }
  delete(path: string) {
    return this.http.delete<void>(`${this.base}/${path}`);
  }
  customerLogin(email: string, password: string) {
    return this.post<{ token: string; user: SessionUser }>('customer-auth/login', {
      email,
      password,
    });
  }
}
