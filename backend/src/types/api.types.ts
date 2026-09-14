/**
 * API Request / Response utility types
 */

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  message?: string;
  timestamp: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}

export interface ApiError {
  code: string;
  message: string;
  errors?: ValidationError[];
}

// Express request augmentation
declare global {
  namespace Express {
    interface Request {
      user?: import('./auth.types').SessionPayload;
      requestId?: string;
    }
  }
}
