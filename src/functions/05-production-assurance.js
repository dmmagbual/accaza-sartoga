const WriteSafety = require("./lib/write-safety");

function operationCorrelationId(request, operation) {
  const rawTrace = String(request && request.rawRequest && request.rawRequest.headers && request.rawRequest.headers["x-cloud-trace-context"] || "").split("/")[0];
  const trace = rawTrace.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return trace || `${String(operation || "operation").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20)}_${crypto.randomBytes(8).toString("hex")}`;
}

function safeErrorCode(error) { return String(error && (error.code || error.name) || "unknown").replace(/[^A-Za-z0-9_/-]/g, "").slice(0, 80); }

async function observeFinancialOperation(request, operation, handler) {
  const correlationId = operationCorrelationId(request, operation), startedAt = Date.now();
  logger.info("Financial operation started", {operation, correlationId, authenticated:!!(request && request.auth && request.auth.uid)});
  try {
    const result = await handler({correlationId});
    logger.info("Financial operation completed", {operation, correlationId, durationMs:Date.now()-startedAt, duplicate:!!(result && result.duplicate)});
    return result && typeof result === "object" && !Array.isArray(result) ? Object.assign({}, result, {correlationId}) : result;
  } catch (error) {
    logger.error("Financial operation failed", {operation, correlationId, durationMs:Date.now()-startedAt, code:safeErrorCode(error), expected:error instanceof HttpsError});
    if (error instanceof HttpsError) {
      const details = error.details && typeof error.details === "object" ? Object.assign({}, error.details, {correlationId}) : {correlationId};
      throw new HttpsError(error.code, error.message, details);
    }
    throw new HttpsError("internal", `The financial operation could not be completed. Nothing was posted. Reference: ${correlationId}.`, {correlationId});
  }
}

async function safeFinancialUpdate(db, writes, context) {
  try { return await WriteSafety.safeAtomicUpdate(db, writes); }
  catch (error) {
    if (!(error instanceof WriteSafety.UnsafeAtomicUpdateError)) throw error;
    logger.error("Unsafe atomic update blocked", {context:financeText(context || "financial", 80), code:error.code, details:error.details || {}});
    throw new HttpsError("internal", `The ${context || "financial"} update could not be prepared safely. Nothing was posted.`);
  }
}
