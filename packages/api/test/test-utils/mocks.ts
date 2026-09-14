import { vi } from 'vitest'; // Use vi from vitest
import { SparqlQueryParser } from '../../src/lib/parser.js'; // Import the actual type

// --- Mock SparqlQueryParser (Instance) ---
// Create a simple mock object for the parser instance
// Note: We mock the *instance* methods, not the class constructor directly here
// If the routes expected `new SparqlQueryParser()`, we'd mock the class differently.
export const mockParser = {
    parseQuery: vi.fn(),
    detectInputs: vi.fn(),
    detectQueryOutputs: vi.fn(),
} as any; // More specific mock type

// Helper function to reset all mocks defined in this file
export function resetMocks() {
    mockParser.parseQuery.mockClear();
    mockParser.detectInputs.mockClear();
    mockParser.detectQueryOutputs.mockClear();

    // Reset any specific implementations if needed (e.g., default return values)
}
