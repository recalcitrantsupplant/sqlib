import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { HttpSparqlExecutor } from '../../src/server/HttpSparqlExecutor.js';
import { Dispatcher } from 'undici';

// Mock undici to control HTTP responses
vi.mock('undici', () => {
    const mockRequest = vi.fn();
    const mockAgentRequest = vi.fn();

    return {
        request: mockRequest,
        Agent: vi.fn(function () {
            return {
                request: mockAgentRequest,
            };
        }),
    };
});

// Import the mocked undici to access its mock functions
import * as undici from 'undici';

const mockUndiciRequest = undici.request as any;
// Correctly type mockUndiciAgentRequest to accept RequestOptions and return a Promise of Dispatcher.ResponseData
const mockUndiciAgentRequest: any = (undici.Agent as any).mock.results[0]?.value.request;


describe('HttpSparqlExecutor', () => {
    const defaultQueryUrl = 'http://localhost:8080/sparql';
    const defaultUpdateUrl = 'http://localhost:8080/update';

    beforeAll(() => {
        process.env.ENABLE_TIMING_LOGS = 'true';
    });

    beforeEach(() => {
        // Reset mocks before each test
        mockUndiciRequest.mockReset();
        mockUndiciAgentRequest.mockReset();
        // Set a default successful mock response for mockUndiciAgentRequest
        mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, {}));
    });

    // Helper to create a mock response object
    const createMockResponse = (statusCode: number, body: string | object, headers: Record<string, string> = {}): Dispatcher.ResponseData => {
        const responseBody = {
            json: vi.fn().mockImplementation(() => {
                if (typeof body === 'object') {
                    return Promise.resolve(body);
                }
                // Simulate JSON parsing error for non-JSON strings
                try {
                    return Promise.resolve(JSON.parse(body as string));
                } catch (e) {
                    return Promise.reject(new Error('Invalid JSON'));
                }
            }),
            text: vi.fn(() => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body))),
        } as any;

        return {
            statusCode,
            headers,
            body: responseBody,
            opaque: null,
            context: {},
            trailers: {},
        };
    };

    const createMockResponseWithFailingBody = (statusCode: number): Dispatcher.ResponseData => {
        return {
            statusCode,
            headers: {},
            body: {
                json: vi.fn(() => Promise.reject(new Error('Failed to read body'))),
                text: vi.fn(() => Promise.reject(new Error('Failed to read body'))),
            } as any,
            opaque: null,
            context: {},
            trailers: {},
        };
    };

    describe('constructor', () => {
        it('should initialize with a valid queryUrl', () => {
            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            expect(executor).toBeInstanceOf(HttpSparqlExecutor);
        });

        it('should throw an error if queryUrl is missing', () => {
            // @ts-ignore - testing invalid input
            expect(() => new HttpSparqlExecutor({})).toThrow('Cannot initialize HttpSparqlExecutor: queryUrl is required in configuration.');
            // @ts-ignore - testing invalid input
            expect(() => new HttpSparqlExecutor({ queryUrl: '' })).toThrow('Cannot initialize HttpSparqlExecutor: queryUrl is required in configuration.');
        });

        it('should set updateUrl to queryUrl if not provided', () => {
            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            // Access private property for testing purposes
            expect((executor as any).executorConfig.updateUrl).toBe(defaultQueryUrl);
        });

        it('should use provided updateUrl if available', () => {
            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl, updateUrl: defaultUpdateUrl });
            // Access private property for testing purposes
            expect((executor as any).executorConfig.updateUrl).toBe(defaultUpdateUrl);
        });

        it('should default an empty updateUrl to the queryUrl', () => {
            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl, updateUrl: '' });
            expect((executor as any).executorConfig.updateUrl).toBe(defaultQueryUrl);
        });
    });

    describe('selectQueryParsed', () => {
        it('should execute a SELECT query and parse JSON results', async () => {
            const mockResponseData = {
                head: { vars: ['s', 'p', 'o'] },
                results: { bindings: [{ s: { value: 'a' } }] }
            };
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, mockResponseData, { 'content-type': 'application/sparql-results+json' }));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            const result = await executor.selectQueryParsed('SELECT * WHERE {?s ?p ?o}');

            expect(mockUndiciAgentRequest).toHaveBeenCalledTimes(1);
            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
                origin: 'http://localhost:8080',
                method: 'POST',
                path: '/sparql',
                headers: expect.objectContaining({
                    'Accept': 'application/sparql-results+json',
                    'Content-Type': 'application/x-www-form-urlencoded',
                }),
                body: 'query=SELECT%20*%20WHERE%20%7B%3Fs%20%3Fp%20%3Fo%7D',
            }));
            expect(result.result).toEqual(mockResponseData);
            expect(result.duration).toBeGreaterThan(0);
        });

        it('should return Content-Type header from backend response', async () => {
            const mockResponseData = {
                head: { vars: ['s', 'p', 'o'] },
                results: { bindings: [{ s: { value: 'a' } }] }
            };
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, mockResponseData, { 'content-type': 'application/sparql-results+json; charset=utf-8' }));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            const result = await executor.selectQueryParsed('SELECT * WHERE {?s ?p ?o}');

            expect(result.contentType).toBe('application/sparql-results+json; charset=utf-8');
        });

        it('should throw an error on non-2xx HTTP status', async () => {
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(404, 'Not Found'));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await expect(executor.selectQueryParsed('SELECT * WHERE {?s ?p ?o}'))
                .rejects.toThrow('HTTP SPARQL query failed with status 404: Not Found');
        });

        it('should throw an error on invalid JSON response', async () => {
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, 'This is not JSON', { 'content-type': 'application/sparql-results+json' }));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await expect(executor.selectQueryParsed('SELECT * WHERE {?s ?p ?o}'))
                .rejects.toThrow('Failed to parse SPARQL JSON output: Invalid JSON');
        });

        it('should throw an error on malformed SPARQL JSON (missing results)', async () => {
            const malformedResponse = { head: { vars: ['s'] } }; // Missing 'results'
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, malformedResponse, { 'content-type': 'application/sparql-results+json' }));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await expect(executor.selectQueryParsed('SELECT * WHERE {?s ?p ?o}'))
                .rejects.toThrow('Failed to parse SPARQL JSON output: Invalid SPARQL JSON output format received.');
        });

        it('should throw an error on network failure', async () => {
            mockUndiciAgentRequest.mockRejectedValue(new Error('Network error'));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await expect(executor.selectQueryParsed('SELECT * WHERE {?s ?p ?o}'))
                .rejects.toThrow('Network error');
        });

        it('should use custom acceptHeader if provided', async () => {
            const mockResponseData = { head: {}, results: { bindings: [] } };
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, mockResponseData));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await executor.selectQueryParsed('SELECT * WHERE {?s ?p ?o}', { acceptHeader: 'application/json' });

            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    'Accept': 'application/json',
                }),
            }));
        });
    });

    describe('constructQueryParsed', () => {
        it('should execute a CONSTRUCT query and return N-Quads string', async () => {
            const mockNQuads = '<http://example.org/s> <http://example.org/p> <http://example.org/o> .';
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, mockNQuads));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            const result = await executor.constructQueryParsed('CONSTRUCT {?s ?p ?o} WHERE {?s ?p ?o}');

            expect(mockUndiciAgentRequest).toHaveBeenCalledTimes(1);
            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
                origin: 'http://localhost:8080',
                method: 'POST',
                path: '/sparql',
                headers: expect.objectContaining({
                    'Accept': 'application/n-quads',
                }),
                body: 'query=CONSTRUCT%20%7B%3Fs%20%3Fp%20%3Fo%7D%20WHERE%20%7B%3Fs%20%3Fp%20%3Fo%7D',
            }));
            expect(result.result).toBe(mockNQuads);
            expect(result.duration).toBeGreaterThan(0);
        });

        it('should return Content-Type header from backend response for CONSTRUCT', async () => {
            const mockTurtle = '@prefix ex: <http://example.org/> . ex:s ex:p ex:o .';
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, mockTurtle, { 'content-type': 'text/turtle' }));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            const result = await executor.constructQueryParsed('CONSTRUCT {?s ?p ?o} WHERE {?s ?p ?o}', { acceptHeader: 'text/turtle' });

            expect(result.contentType).toBe('text/turtle');
            expect(result.result).toBe(mockTurtle);
        });

        it('should throw an error on non-2xx HTTP status', async () => {
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(500, 'Internal Server Error'));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await expect(executor.constructQueryParsed('CONSTRUCT {?s ?p ?o} WHERE {?s ?p ?o}'))
                .rejects.toThrow('HTTP SPARQL query failed with status 500: Internal Server Error');
        });

        it('should throw an error if reading the response body fails', async () => {
            const mockResponse = createMockResponse(200, '');
            (mockResponse.body.text as any).mockRejectedValue(new Error('Read failed'));
            mockUndiciAgentRequest.mockResolvedValue(mockResponse);

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await expect(executor.constructQueryParsed('query'))
                .rejects.toThrow('Failed to read N-Quads response body: Read failed');
        });

        it('should use custom acceptHeader if provided', async () => {
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, ''));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await executor.constructQueryParsed('CONSTRUCT {?s ?p ?o} WHERE {?s ?p ?o}', { acceptHeader: 'text/turtle' });

            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    'Accept': 'text/turtle',
                }),
            }));
        });
    });

    describe('update', () => {
        it('should execute an UPDATE query successfully', async () => {
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(204, '')); // 204 No Content is common for successful updates

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl, updateUrl: defaultUpdateUrl });
            const result = await executor.update('INSERT DATA {<urn:s> <urn:p> <urn:o>}');
            expect(result.result).toBeUndefined();
            expect(result.duration).toBeGreaterThan(0);

            expect(mockUndiciAgentRequest).toHaveBeenCalledTimes(1);
            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
                origin: 'http://localhost:8080',
                method: 'POST',
                path: '/update', // Should use updateUrl path
                headers: expect.objectContaining({
                    'Accept': '*/*',
                    'Content-Type': 'application/x-www-form-urlencoded',
                }),
                body: 'update=INSERT%20DATA%20%7B%3Curn%3As%3E%20%3Curn%3Ap%3E%20%3Curn%3Ao%3E%7D',
            }));
        });

        it('should use queryUrl for update if updateUrl is not explicitly provided', async () => {
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(204, ''));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl }); // No updateUrl provided
            await executor.update('INSERT DATA {<urn:s> <urn:p> <urn:o>}');

            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
                origin: 'http://localhost:8080',
                path: '/sparql', // Should use queryUrl path
            }));
        });

        it('should throw an error on non-2xx HTTP status', async () => {
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(400, 'Bad Update Request'));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl, updateUrl: defaultUpdateUrl });
            await expect(executor.update('INVALID UPDATE QUERY'))
                .rejects.toThrow('HTTP SPARQL query failed with status 400: Bad Update Request');
        });
    });

    describe('askQuery', () => {
        it('should execute an ASK query and return true', async () => {
            const mockResponseData = { head: {}, boolean: true };
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, mockResponseData, { 'content-type': 'application/sparql-results+json' }));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            const result = await executor.askQuery('ASK {?s ?p ?o}');

            expect(mockUndiciAgentRequest).toHaveBeenCalledTimes(1);
            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
                origin: 'http://localhost:8080',
                method: 'POST',
                path: '/sparql',
                headers: expect.objectContaining({
                    'Accept': 'application/sparql-results+json',
                }),
                body: 'query=ASK%20%7B%3Fs%20%3Fp%20%3Fo%7D',
            }));
            expect(result.result).toBe(true);
            expect(result.duration).toBeGreaterThan(0);
        });

        it('should return Content-Type header from backend response for ASK', async () => {
            const mockResponseData = { head: {}, boolean: false };
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, mockResponseData, { 'content-type': 'application/sparql-results+json; charset=utf-8' }));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            const result = await executor.askQuery('ASK {?s ?p ?o}');

            expect(result.contentType).toBe('application/sparql-results+json; charset=utf-8');
            expect(result.result).toBe(false);
        });

        it('should execute an ASK query and return false', async () => {
            const mockResponseData = { head: {}, boolean: false };
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, mockResponseData, { 'content-type': 'application/sparql-results+json' }));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            const result = await executor.askQuery('ASK {?s ?p ?o}');

            expect(result.result).toBe(false);
            expect(result.duration).toBeGreaterThan(0);
        });

        it('should throw an error on non-2xx HTTP status', async () => {
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(403, 'Forbidden'));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await expect(executor.askQuery('ASK {?s ?p ?o}'))
                .rejects.toThrow('HTTP SPARQL query failed with status 403: Forbidden');
        });

        it('should throw an error on invalid ASK JSON response (missing boolean)', async () => {
            const mockResponseData = { head: {}, results: {} }; // Missing 'boolean' field
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, mockResponseData, { 'content-type': 'application/sparql-results+json' }));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await expect(executor.askQuery('ASK {?s ?p ?o}'))
                .rejects.toThrow('Invalid SPARQL ASK JSON output format received: "boolean" field missing or not a boolean.');
        });

        it('should throw an error on invalid ASK JSON response (boolean is not a boolean)', async () => {
            const mockResponseData = { head: {}, boolean: 'true' }; // 'boolean' is a string
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, mockResponseData, { 'content-type': 'application/sparql-results+json' }));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await expect(executor.askQuery('ASK {?s ?p ?o}'))
                .rejects.toThrow('Invalid SPARQL ASK JSON output format received: "boolean" field missing or not a boolean.');
        });

        it('should throw an error on parsing failure', async () => {
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, 'not json', { 'content-type': 'application/sparql-results+json' }));
            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await expect(executor.askQuery('ASK {}')).rejects.toThrow('Failed to parse SPARQL ASK JSON output: Invalid JSON');
        });

        it('should use custom acceptHeader if provided', async () => {
            const mockResponseData = { head: {}, boolean: true };
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, mockResponseData));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await executor.askQuery('ASK {?s ?p ?o}', { acceptHeader: 'application/json' });

            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    'Accept': 'application/json',
                }),
            }));
        });
    });

    describe('selectQueryStream', () => {
        it('should return the raw undici response object for SELECT', async () => {
            const mockResponse = createMockResponse(200, { head: {}, results: { bindings: [] } });
            mockUndiciAgentRequest.mockResolvedValue(mockResponse);

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            const result = await executor.selectQueryStream('SELECT * WHERE {?s ?p ?o}');

            expect(mockUndiciAgentRequest).toHaveBeenCalledTimes(1);
            expect(result).toBe(mockResponse);
            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    'Accept': 'application/sparql-results+json',
                }),
            }));
        });

        it('should throw an error on non-2xx HTTP status for SELECT stream', async () => {
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(401, 'Unauthorized'));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await expect(executor.selectQueryStream('SELECT * WHERE {?s ?p ?o}'))
                .rejects.toThrow('HTTP SPARQL query failed with status 401: Unauthorized');
        });

        it('should throw an error on network failure for SELECT stream', async () => {
            mockUndiciAgentRequest.mockRejectedValue(new Error('Network error'));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await expect(executor.selectQueryStream('SELECT * WHERE {?s ?p ?o}'))
                .rejects.toThrow('Network error');
        });

        it('should use custom acceptHeader if provided', async () => {
            const mockResponse = createMockResponse(200, { head: {}, results: { bindings: [] } });
            mockUndiciAgentRequest.mockResolvedValue(mockResponse);

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await executor.selectQueryStream('SELECT * WHERE {?s ?p ?o}', { acceptHeader: 'application/json' });

            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    'Accept': 'application/json',
                }),
            }));
        });
    });

    describe('constructQueryStream', () => {
        it('should return the raw undici response object for CONSTRUCT', async () => {
            const mockResponse = createMockResponse(200, '<http://example.org/s> <http://example.org/p> <http://example.org/o> .');
            mockUndiciAgentRequest.mockResolvedValue(mockResponse);

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            const result = await executor.constructQueryStream('CONSTRUCT {?s ?p ?o} WHERE {?s ?p ?o}');

            expect(mockUndiciAgentRequest).toHaveBeenCalledTimes(1);
            expect(result).toBe(mockResponse);
            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    'Accept': 'application/n-triples', // Default for constructQueryStream
                }),
            }));
        });

        it('should throw an error on non-2xx HTTP status for CONSTRUCT stream', async () => {
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(503, 'Service Unavailable'));

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await expect(executor.constructQueryStream('CONSTRUCT {?s ?p ?o} WHERE {?s ?p ?o}'))
                .rejects.toThrow('HTTP SPARQL query failed with status 503: Service Unavailable');
        });

        it('should use custom acceptHeader if provided', async () => {
            const mockResponse = createMockResponse(200, '');
            mockUndiciAgentRequest.mockResolvedValue(mockResponse);

            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await executor.constructQueryStream('CONSTRUCT {?s ?p ?o} WHERE {?s ?p ?o}', { acceptHeader: 'text/plain' });

            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    'Accept': 'text/plain',
                }),
            }));
        });
    });

    describe('Authentication', () => {
        it('should include Authorization header if username and password are provided', async () => {
            const mockResponseData = { head: {}, results: { bindings: [] } };
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, mockResponseData, { 'content-type': 'application/sparql-results+json' }));

            const executor = new HttpSparqlExecutor({
                queryUrl: defaultQueryUrl,
                username: 'user',
                password: 'pass'
            });
            await executor.selectQueryParsed('SELECT * WHERE {?s ?p ?o}');

            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    'Authorization': 'Basic dXNlcjpwYXNz', // base64 of 'user:pass'
                }),
            }));
        });

        it('should include Authorization header if authHeader is provided', async () => {
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, { head: {}, results: {} }, { 'content-type': 'application/sparql-results+json' }));
            const executor = new HttpSparqlExecutor({
                queryUrl: defaultQueryUrl,
                authHeader: 'Bearer my-token'
            });
            await executor.selectQueryParsed('SELECT *');
            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({ 'Authorization': 'Bearer my-token' }),
            }));
        });

        it('should prioritize basic auth over authHeader', async () => {
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, { head: {}, results: {} }, { 'content-type': 'application/sparql-results+json' }));
            const executor = new HttpSparqlExecutor({
                queryUrl: defaultQueryUrl,
                username: 'user',
                password: 'pass',
                authHeader: 'Bearer my-token'
            });
            await executor.selectQueryParsed('SELECT *');
            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({ 'Authorization': 'Basic dXNlcjpwYXNz' }),
            }));
        });

        it('should not include Authorization header if username or password is missing', async () => {
            const mockResponseData = { head: {}, results: { bindings: [] } };

            // Only username
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, mockResponseData, { 'content-type': 'application/sparql-results+json' }));
            let executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl, username: 'user' });
            await executor.selectQueryParsed('SELECT * WHERE {?s ?p ?o}');
            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.not.objectContaining({
                    'Authorization': expect.any(String),
                }),
            }));
            mockUndiciAgentRequest.mockClear();

            // Only password
            mockUndiciAgentRequest.mockResolvedValue(createMockResponse(200, mockResponseData, { 'content-type': 'application/sparql-results+json' }));
            executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl, password: 'pass' });
            await executor.selectQueryParsed('SELECT * WHERE {?s ?p ?o}');
            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.not.objectContaining({
                    'Authorization': expect.any(String),
                }),
            }));
        });
    });

    describe('Error Handling Helpers', () => {
        it('checkHttpResponseStatus should throw error with body text on non-2xx status', async () => {
            const mockResponse = createMockResponse(400, 'Bad Request');
            mockUndiciAgentRequest.mockResolvedValue(mockResponse);
            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            // We need to test the internal helper, so we call a public method that uses it.
            await expect(executor.selectQueryParsed('query')).rejects.toThrow('HTTP SPARQL query failed with status 400: Bad Request');
        });

        it('checkHttpResponseStatus should handle failures in reading the response body', async () => {
            const mockResponse = createMockResponseWithFailingBody(500);
            mockUndiciAgentRequest.mockResolvedValue(mockResponse);
            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            await expect(executor.selectQueryParsed('query')).rejects.toThrow('HTTP SPARQL query failed with status 500: (Failed to read response body)');
        });
    });

    describe('GET Request Support', () => {
        const mockSelectResult = {
            head: { vars: ['s', 'p', 'o'] },
            results: { bindings: [] }
        };

        it('should use POST method by default', async () => {
            const executor = new HttpSparqlExecutor({ queryUrl: defaultQueryUrl });
            const mockResponse = createMockResponse(200, mockSelectResult, { 'content-type': 'application/sparql-results+json' });
            mockUndiciAgentRequest.mockResolvedValue(mockResponse);

            await executor.selectQueryParsed('SELECT * WHERE { ?s ?p ?o }');

            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'POST'
                })
            );
        });

        it('should use POST method when queryMethod is "post"', async () => {
            const executor = new HttpSparqlExecutor({
                queryUrl: defaultQueryUrl,
                queryMethod: 'post'
            });
            const mockResponse = createMockResponse(200, mockSelectResult, { 'content-type': 'application/sparql-results+json' });
            mockUndiciAgentRequest.mockResolvedValue(mockResponse);

            await executor.selectQueryParsed('SELECT * WHERE { ?s ?p ?o }');

            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'POST'
                })
            );
        });

        it('should use GET method when queryMethod is "get"', async () => {
            const executor = new HttpSparqlExecutor({
                queryUrl: defaultQueryUrl,
                queryMethod: 'get'
            });
            const mockResponse = createMockResponse(200, mockSelectResult, { 'content-type': 'application/sparql-results+json' });
            mockUndiciAgentRequest.mockResolvedValue(mockResponse);

            await executor.selectQueryParsed('SELECT * WHERE { ?s ?p ?o }');

            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'GET',
                    path: expect.stringContaining('query=')
                })
            );
        });

        it('should include auth header in GET requests', async () => {
            const executor = new HttpSparqlExecutor({
                queryUrl: defaultQueryUrl,
                queryMethod: 'get',
                username: 'user',
                password: 'pass'
            });
            const mockResponse = createMockResponse(200, mockSelectResult, { 'content-type': 'application/sparql-results+json' });
            mockUndiciAgentRequest.mockResolvedValue(mockResponse);

            await executor.selectQueryParsed('SELECT * WHERE { ?s ?p ?o }');

            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'GET',
                    headers: expect.objectContaining({
                        'Authorization': expect.stringContaining('Basic')
                    })
                })
            );
        });

        it('should always use POST for UPDATE queries regardless of queryMethod', async () => {
            const executor = new HttpSparqlExecutor({
                queryUrl: defaultQueryUrl,
                queryMethod: 'get'  // Even with GET preference
            });
            const mockResponse = createMockResponse(200, '', { 'content-type': 'text/plain' });
            mockUndiciAgentRequest.mockResolvedValue(mockResponse);

            await executor.update('INSERT DATA { <s> <p> <o> }');

            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'POST'  // Must be POST for updates
                })
            );
        });

        it('should work with GET for CONSTRUCT queries', async () => {
            const executor = new HttpSparqlExecutor({
                queryUrl: defaultQueryUrl,
                queryMethod: 'get'
            });
            const mockResponse = createMockResponse(200, '<s> <p> <o> .', { 'content-type': 'application/n-quads' });
            mockUndiciAgentRequest.mockResolvedValue(mockResponse);

            await executor.constructQueryParsed('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }');

            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'GET'
                })
            );
        });

        it('should work with GET for ASK queries', async () => {
            const executor = new HttpSparqlExecutor({
                queryUrl: defaultQueryUrl,
                queryMethod: 'get'
            });
            const mockResponse = createMockResponse(200, { head: {}, boolean: true }, { 'content-type': 'application/sparql-results+json' });
            mockUndiciAgentRequest.mockResolvedValue(mockResponse);

            await executor.askQuery('ASK { ?s ?p ?o }');

            expect(mockUndiciAgentRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'GET'
                })
            );
        });
    });
});
