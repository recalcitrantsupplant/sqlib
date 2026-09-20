/**
 * The View half of the MCP Apps bridge: JSON-RPC 2.0 over `postMessage`.
 *
 * A View is an MCP client that happens to be an iframe. It cannot fetch — its
 * declared CSP gives it no `connect-src` — so this is the only way it reads or
 * writes anything, and every call it makes is a message the host can see,
 * refuse or log. That is the property the whole design rests on; do not add a
 * `fetch` here to "just get the backends list".
 *
 * Small and dependency-free on purpose: it is inlined into every View, and a
 * View is re-sent on every `resources/read`.
 */
(function initBridge(global) {
  var pending = new Map();
  var listeners = Object.create(null);
  var nextId = 1;

  function post(message) {
    // The host frame is a different origin and, under a sandbox without
    // `allow-same-origin`, this frame's own origin is opaque. `*` is what the
    // specification's transport uses; the host validates the source frame.
    global.parent.postMessage(message, '*');
  }

  function request(method, params) {
    var id = 'view-' + nextId++;
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
      post({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
    });
  }

  function notify(method, params) {
    post({ jsonrpc: '2.0', method: method, params: params || {} });
  }

  global.addEventListener('message', function onMessage(event) {
    var message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;

    var isResponse = message.id !== undefined && (message.result !== undefined || message.error !== undefined);
    if (isResponse) {
      var waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message || 'request failed'));
      else waiter.resolve(message.result);
      return;
    }

    if (!message.method) return;
    var handlers = listeners[message.method] || [];
    for (var i = 0; i < handlers.length; i += 1) {
      try {
        handlers[i](message.params || {});
      } catch (err) {
        // A View that throws in one handler still has to answer the host.
        if (global.console) global.console.error(message.method, err);
      }
    }
    // Host→View *requests* carry an id and must be answered, even when the
    // View has nothing to say (`ui/resource-teardown` is the one that matters).
    if (message.id !== undefined) post({ jsonrpc: '2.0', id: message.id, result: {} });
  });

  /**
   * MCP clients sanitise tool names to `^[a-zA-Z0-9_-]+$`, so the catalogue's
   * `queries.createVersion` is published as `queries_createVersion`. A View
   * only ever runs behind such a client, so it asks for the sanitised name —
   * the same rewrite `sanitizeToolName` applies in `packages/mcp-server`.
   */
  function toolName(catalogueName) {
    return String(catalogueName).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  var app = {
    /** Register a handler for a host notification (`ui/notifications/*`). */
    on: function (method, handler) {
      (listeners[method] || (listeners[method] = [])).push(handler);
      return app;
    },

    /** The MCP-like handshake. Resolves with the host's `hostContext`. */
    initialize: async function (appCapabilities) {
      var result = await request('ui/initialize', {
        appCapabilities: appCapabilities || {},
      });
      notify('ui/notifications/initialized', {});
      return result || {};
    },

    /**
     * Call a server tool by its catalogue name. Returns the sqlib envelope
     * (`{ statusCode, headers, body }`) the MCP server puts in
     * `structuredContent`, so a View reads `.body` rather than re-parsing text.
     */
    callTool: async function (catalogueName, args) {
      var result = await request('tools/call', {
        name: toolName(catalogueName),
        arguments: args || {},
      });
      var structured = result && result.structuredContent;
      if (structured && typeof structured === 'object') return structured;
      var text = result && result.content && result.content[0] && result.content[0].text;
      return { statusCode: result && result.isError ? 500 : 200, headers: {}, body: text };
    },

    readResource: function (uri) {
      return request('resources/read', { uri: uri });
    },

    /**
     * Tell the model what just happened, in one line.
     *
     * This is the *only* path from the View into the conversation's context,
     * and it is deliberately narrow: a bounded string, never a result set. A
     * run that returned 4 000 rows says "4000 rows"; the rows stay here.
     */
    updateModelContext: function (text) {
      var bounded = String(text == null ? '' : text);
      if (bounded.length > 600) bounded = bounded.slice(0, 597) + '…';
      return request('ui/update-model-context', { content: bounded }).catch(function () {
        // A host that does not implement it must not break the bench.
      });
    },

    /** Put a message in the chat as if the user had typed it. */
    sendMessage: function (text) {
      return request('ui/message', { content: String(text || '') }).catch(function () {});
    },

    openLink: function (url) {
      return request('ui/open-link', { url: String(url) }).catch(function () {});
    },

    requestDisplayMode: function (mode) {
      return request('ui/request-display-mode', { mode: mode }).catch(function () {});
    },

    /**
     * Report our own height so a flexible container can follow it.
     *
     * Twice: once now, and once after a frame. A View calls this the moment it
     * has appended a results table, and `scrollHeight` read in that same tick
     * is the height *before* the browser has laid the table out — which is how
     * a result ends up clipped inside an iframe that was told the old height.
     */
    reportSize: function () {
      var send = function () {
        notify('ui/notifications/size-changed', {
          height: Math.ceil(global.document.documentElement.scrollHeight),
        });
      };
      send();
      if (global.requestAnimationFrame) global.requestAnimationFrame(send);
      else global.setTimeout(send, 50);
    },

    toolName: toolName,
  };

  /**
   * Paint with the host's own colours where it offers them.
   *
   * `hostContext.styles` carries the host's CSS variables and fonts. Anything
   * it does not define keeps sqlib's value from `tokens.css`, which is why the
   * RDF term colours survive in a host that has never heard of an IRI.
   */
  app.applyHostStyles = function (hostContext) {
    var context = hostContext || {};
    var root = global.document.documentElement;
    var styles = context.styles || {};
    var variables = styles.variables || styles.cssVariables || {};
    Object.keys(variables).forEach(function (key) {
      var name = key.indexOf('--') === 0 ? key : '--' + key;
      try {
        root.style.setProperty(name, String(variables[key]));
      } catch (err) {
        /* a host variable we cannot set is not worth failing over */
      }
    });
    if (context.theme) root.setAttribute('data-theme', String(context.theme));
    if (styles.fontFamily) root.style.setProperty('--font-sans', String(styles.fontFamily));
    if (styles.fontFamilyMono) root.style.setProperty('--font-mono', String(styles.fontFamilyMono));
  };

  global.sqlibApp = app;
})(window);
