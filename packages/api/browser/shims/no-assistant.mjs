// The browser build has no assistant: it would need a model provider's key.
const unavailable = () => { throw new Error('The assistant is not available in the browser build'); };
export const splitInstructions = unavailable;
export const toSdkMessages = unavailable;
export const toSdkTools = unavailable;
export const createAiSdkClient = unavailable;
export const aiSdkModelClientFactory = unavailable;
