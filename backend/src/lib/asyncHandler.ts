import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Envolve um handler async e encaminha rejeições para o error handler do Express,
 * evitando try/catch repetido em cada rota.
 */
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => Promise.resolve(fn(req as Req, res, next)).catch(next);
}
