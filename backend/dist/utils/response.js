"use strict";
/**
 * Standard API response helpers
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSuccess = sendSuccess;
exports.sendError = sendError;
exports.sendValidationError = sendValidationError;
function sendSuccess(res, data, statusCode = 200, message) {
    const response = {
        success: true,
        data,
        message,
        timestamp: new Date().toISOString(),
    };
    res.status(statusCode).json(response);
}
function sendError(res, message, statusCode = 500, code) {
    const response = {
        success: false,
        error: message,
        code,
        timestamp: new Date().toISOString(),
    };
    res.status(statusCode).json(response);
}
function sendValidationError(res, errors) {
    res.status(422).json({
        success: false,
        error: 'Validation failed',
        errors,
        timestamp: new Date().toISOString(),
    });
}
//# sourceMappingURL=response.js.map