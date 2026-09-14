/**
 * Standard API response helpers
 */

import { Response } from 'express';
import { ApiResponse } from '../types/api.types';

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  message?: string
): void {
  const response: ApiResponse<T> = {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
  res.status(statusCode).json(response);
}

export function sendError(
  res: Response,
  message: string,
  statusCode = 500,
  code?: string
): void {
  const response: ApiResponse = {
    success: false,
    error: message,
    code,
    timestamp: new Date().toISOString(),
  };
  res.status(statusCode).json(response);
}

export function sendValidationError(
  res: Response,
  errors: Array<{ field: string; message: string }>
): void {
  res.status(422).json({
    success: false,
    error: 'Validation failed',
    errors,
    timestamp: new Date().toISOString(),
  });
}
