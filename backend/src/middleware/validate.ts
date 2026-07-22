import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";
import { sendError } from "../lib/httpError";

type RequestPart = "body" | "query" | "params";

/**
 * Middleware de validação com Zod. Valida a parte indicada da request e,
 * em caso de sucesso, substitui pelo valor já parseado (com defaults/coerções).
 */
export function validate(schema: ZodType, part: RequestPart = "body") {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      return sendError(res, 400, "VALIDATION_ERROR", "Dados inválidos.", details);
    }

    // Express 4 permite reescrever body/query/params.
    (req as Record<RequestPart, unknown>)[part] = result.data;
    return next();
  };
}
