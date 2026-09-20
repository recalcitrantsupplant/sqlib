/**
 * The tool catalogue and the registry that runs it.
 *
 * Protocol-agnostic on purpose: MCP wraps this for door B, and the in-app
 * assistant drives it directly for door A.
 */
export { defineTool, tools, debugLog, VIEW_URI, type ToolDefinition, type ToolRequest, type ToolUiBinding } from './tools.js';
export { catalogueGuide, guideToolMentions } from './guide.js';
export {
  createToolRegistry,
  rewriteToolNames,
  compileToolValidators,
  formatValidationErrors,
  schemaFragmentForErrors,
  ToolValidationError,
  type AjvErrorObject,
  type ApiCaller,
  type CompiledValidator,
  type ListedTool,
  type ToolCallResult,
  type ToolRegistry,
  type ToolRegistryOptions,
  type ToolValidatorCompiler,
} from './registry.js';
