import { FastifyReply } from 'fastify';

export interface ErrorResponse {
    statusCode: number;
    error: string;
}

/**
 * Centralized error handling for SPARQL execution errors.
 * Converts technical errors into user-friendly HTTP responses.
 */
export function handleSparqlExecutionError(errorInput: unknown, backendId: string): ErrorResponse {
    const error = errorInput as {
        code?: string;
        message?: string;
        name?: string;
        errors?: Array<{ code?: string }>;
    };
    // Network timeout errors
    if (error.code === 'ETIMEDOUT' || error.message?.includes('ETIMEDOUT')) {
        return {
            statusCode: 504,
            error: `Connection timeout when connecting to backend ${backendId}. The SPARQL endpoint may be unavailable or slow to respond.`
        };
    }

    // Connection refused errors
    if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
        return {
            statusCode: 502,
            error: `Connection refused by backend ${backendId}. The SPARQL endpoint may be down or unreachable.`
        };
    }

    // Network unreachable errors
    if (error.code === 'ENETUNREACH' || error.message?.includes('ENETUNREACH')) {
        return {
            statusCode: 502,
            error: `Network unreachable for backend ${backendId}. Check your network connection or the endpoint URL.`
        };
    }

    // Handle AggregateError (which can contain multiple network errors)
    if (error.name === 'AggregateError' && error.errors) {
        const timeoutErrors = error.errors.filter((e) => e.code === 'ETIMEDOUT');
        const connectionErrors = error.errors.filter((e) => e.code === 'ECONNREFUSED');
        const networkErrors = error.errors.filter((e) => e.code === 'ENETUNREACH');

        if (timeoutErrors.length > 0) {
            return {
                statusCode: 504,
                error: `Connection timeout when connecting to backend ${backendId}. The SPARQL endpoint may be unavailable or slow to respond.`
            };
        }

        if (connectionErrors.length > 0) {
            return {
                statusCode: 502,
                error: `Connection refused by backend ${backendId}. The SPARQL endpoint may be down or unreachable.`
            };
        }

        if (networkErrors.length > 0) {
            return {
                statusCode: 502,
                error: `Network unreachable for backend ${backendId}. Check your network connection or the endpoint URL.`
            };
        }
    }

    // General network/fetch errors
    if (error.message?.includes('fetch') || error.message?.includes('HTTP')) {
        return {
            statusCode: 502,
            error: `Failed to connect to backend ${backendId}: ${error.message}`
        };
    }

    // Handle HTTP status errors from the SPARQL endpoint
    if (error.message?.includes('HTTP SPARQL query failed with status')) {
        const statusMatch = error.message.match(/status (\d+)/);
        const status = statusMatch ? parseInt(statusMatch[1]) : 502;
        return {
            statusCode: status >= 400 && status < 600 ? status : 502,
            error: `SPARQL endpoint error: ${error.message}`
        };
    }

    // Default fallback
    return {
        statusCode: 500,
        error: `Internal server error during execution: ${error.message}`
    };
}

/**
 * Helper function to send error response using Fastify reply
 */
export function sendErrorResponse(reply: FastifyReply, errorResponse: ErrorResponse): void {
    reply.code(errorResponse.statusCode).send({ error: errorResponse.error });
}