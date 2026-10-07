import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../../core/api.service';
export interface Coordinate {
  latitude: number;
  longitude: number;
}
export interface DeliverySla {
  state: 'NOT_SET' | 'ON_TRACK' | 'OVERDUE' | 'MET' | 'BREACHED';
  dueAt: string | null;
  minutes: number | null;
  policy?: {
    region: 'BICOL' | 'LUZON' | 'VISAYAS' | 'MINDANAO' | null;
    remoteDays: number;
    preparedAt: string | null;
    dispatchedAt: string | null;
    fromAt: string | null;
    toAt: string | null;
    projected: boolean;
    completed: boolean;
    stages: Array<DeliverySla & { name: string; rule: string; completedAt: string | null }>;
  };
}
export interface DeliveryTracking {
  sla: DeliverySla;
  state: 'LIVE' | 'STALE' | 'UNAVAILABLE' | 'STOPPED';
  serverTime: string;
  employeeName: string | null;
  deliveryStatus: string | null;
  estimatedDeliveryAt: string | null;
  destination: Coordinate | null;
  position: (Coordinate & { accuracy: number; observedAt: string; receivedAt: string }) | null;
}
export interface DeliveryEmployee {
  id: number;
  fullName: string;
  email: string;
  phone: string;
  active: boolean;
}
export interface DeliveryJob {
  sla: DeliverySla;
  id: number;
  trackingNumber: string;
  address: string;
  deliveryStatus: string;
  estimatedDeliveryAt: string | null;
  assignmentVersion: number;
  employeeId: number | null;
  employeeName: string | null;
  recipientName: string;
  recipientPhone: string;
  attemptId: string | null;
  issueCount: number;
  latitude: number | null;
  longitude: number | null;
  tracking?: DeliveryTracking;
}
export interface DeliveryDetail extends DeliveryJob {
  orderStatus: string;
  items: Array<{ name: string; quantity: number }>;
  packages: Array<{
    name: string;
    quantity: number;
    components: Array<{ productId: number; productName: string; quantity: number }>;
  }>;
  history: Array<{ status: string; occurredAt: string }>;
  issues: Array<{
    id: number;
    explanation: string;
    createdAt: string;
    resolvedAt: string | null;
    resolution: string | null;
  }>;
  completion: {
    recipientName: string;
    employeeName: string;
    completedAt: string;
    photoState: 'AVAILABLE' | 'EXPIRED' | 'EXCEPTION';
    exceptionReason?: string;
  } | null;
  tracking: DeliveryTracking;
}
@Injectable({ providedIn: 'root' })
export class DeliveryApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;
  get<T>(path: string) {
    return this.http.get<ApiResponse<T>>(`${this.base}/${path}`);
  }
  post<T = any>(path: string, body: object = {}) {
    return this.http.post<ApiResponse<T>>(`${this.base}/${path}`, body);
  }
  patch<T = any>(path: string, body: object) {
    return this.http.patch<ApiResponse<T>>(`${this.base}/${path}`, body);
  }
  put<T = any>(path: string, body: object) {
    return this.http.put<ApiResponse<T>>(`${this.base}/${path}`, body);
  }
  photo(path: string) {
    return this.http.get(`${this.base}/${path}`, { responseType: 'blob' });
  }
  upload(id: number, file: File, assignmentVersion: number, attemptId?: string | null) {
    const data = new FormData();
    data.append('photo', file);
    data.append('assignmentVersion', String(assignmentVersion));
    if (attemptId) data.append('attemptId', attemptId);
    return this.post<{ id: string }>(`delivery/orders/${id}/proof-photo`, data);
  }
}
