import type { Response } from "express";

/** Formato padronizado de erro da API: { error: { code, message, details? } } */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
): Response<ApiErrorBody> {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}
