import type { FastifyError, FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { AppError, type ErrorEnvelope } from "@tickzy/shared";

function envelope(code: ErrorEnvelope["error"]["code"], message: string, requestId: string, details?: ErrorEnvelope["error"]["details"]): ErrorEnvelope {
  return { error: { code, message, ...(details ? { details } : {}), request_id: requestId } };
}

/** Uniform error envelope for every failure path (api-spec.md conventions). */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    void reply.code(404).send(envelope("not_found", `Route ${req.method} ${req.url} not found`, req.id));
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send(envelope(err.code, err.message, req.id, err.details));
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const details = err.validation.map((v) => ({
        path: [err.validationContext, ...(v.instancePath || "").split("/").filter(Boolean)].filter(Boolean).join("."),
        issue: v.message ?? "invalid",
      }));
      return reply.code(422).send(envelope("validation_failed", "Request validation failed", req.id, details));
    }
    if (err.statusCode === 415 || err.statusCode === 400) {
      return reply.code(422).send(envelope("validation_failed", err.message, req.id));
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send(envelope("internal", "Internal server error", req.id));
  });
}
