/**
 * Rendering SPARQL results, shared by the bench and the result View.
 *
 * Everything here builds DOM nodes rather than HTML strings: a result cell can
 * hold any literal a backend cares to return, and a View that concatenated it
 * into `innerHTML` would be one hostile literal away from being the security
 * hole the sandbox exists to prevent.
 */
(function initResults(global) {
  var document = global.document;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /** `http://example.org/Perth` → `:Perth`, when a prefix is obvious. */
  function shortenUri(value) {
    var match = /^(.*[/#])([^/#]+)$/.exec(value);
    if (!match || !match[2]) return { short: value, full: value };
    return { short: ':' + match[2], full: value };
  }

  function termCell(term) {
    var cell = el('td');
    if (!term || typeof term !== 'object') {
      cell.appendChild(el('span', 'term-suffix', '—'));
      return cell;
    }
    if (term.type === 'uri') {
      var shortened = shortenUri(String(term.value));
      var uri = el('span', 'term-uri', shortened.short);
      uri.title = shortened.full;
      cell.appendChild(uri);
      return cell;
    }
    if (term.type === 'bnode') {
      cell.appendChild(el('span', 'term-bnode', '_:' + term.value));
      return cell;
    }
    var typed = term.datatype || term['xml:lang'];
    cell.appendChild(el('span', typed ? 'term-typed' : 'term-literal', term.value));
    if (term['xml:lang']) cell.appendChild(el('span', 'term-suffix', '@' + term['xml:lang']));
    else if (term.datatype) {
      var datatype = el('span', 'term-suffix', '^^' + shortenUri(String(term.datatype)).short);
      datatype.title = String(term.datatype);
      cell.appendChild(datatype);
    }
    return cell;
  }

  /**
   * Render whatever `/execute` or `/sparql` returned into `container`.
   *
   * SELECT gives SPARQL Results JSON, ASK a boolean, CONSTRUCT a serialisation;
   * all three arrive through the same door, so all three are handled here
   * rather than by each caller guessing.
   */
  function renderResults(container, payload, options) {
    var limit = (options && options.rowLimit) || 500;
    container.textContent = '';

    if (payload === null || payload === undefined) {
      container.appendChild(el('div', 'empty', 'No result'));
      return { kind: 'empty', rowCount: 0, columns: [] };
    }

    if (typeof payload === 'string') {
      // SPARQL results arrive as `application/sparql-results+json`, which is
      // JSON but not `application/json`, so the tool registry leaves the body
      // as text. Parsing here rather than teaching the registry about SPARQL
      // media types keeps that decision where the shapes are already known —
      // and a CONSTRUCT really does return text, which is the branch below.
      var parsed = null;
      try {
        parsed = JSON.parse(payload);
      } catch (err) {
        parsed = null;
      }
      if (parsed && typeof parsed === 'object') return renderResults(container, parsed, options);

      var pre = el('pre', 'mono small');
      pre.textContent = payload;
      container.appendChild(pre);
      return { kind: 'text', rowCount: 0, columns: [] };
    }

    if (typeof payload.boolean === 'boolean') {
      container.appendChild(el('div', 'empty mono', payload.boolean ? 'true' : 'false'));
      return { kind: 'boolean', rowCount: 1, columns: [], boolean: payload.boolean };
    }

    var head = payload.head || {};
    var columns = Array.isArray(head.vars) ? head.vars : [];
    var bindings = (payload.results && payload.results.bindings) || [];

    if (!columns.length && !bindings.length) {
      var pretty = el('pre', 'mono small');
      pretty.textContent = JSON.stringify(payload, null, 2).slice(0, 4000);
      container.appendChild(pretty);
      return { kind: 'other', rowCount: 0, columns: [] };
    }

    var scroll = el('div', 'scroll');
    var table = el('table');
    var thead = el('thead');
    var headRow = el('tr');
    columns.forEach(function (name) {
      headRow.appendChild(el('th', null, '?' + name));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = el('tbody');
    bindings.slice(0, limit).forEach(function (binding) {
      var row = el('tr');
      columns.forEach(function (name) {
        row.appendChild(termCell(binding[name]));
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    container.appendChild(scroll);

    if (bindings.length > limit) {
      container.appendChild(
        el('div', 'status small', 'Showing ' + limit + ' of ' + bindings.length + ' rows')
      );
    }

    return { kind: 'bindings', rowCount: bindings.length, columns: columns };
  }

  /** The one-line summary the model is told about a run. */
  function summariseResults(shape) {
    if (!shape) return 'no result';
    if (shape.kind === 'boolean') return 'ASK → ' + shape.boolean;
    if (shape.kind === 'bindings') {
      var columns = shape.columns.length ? ' (' + shape.columns.map(function (c) { return '?' + c; }).join(' ') + ')' : '';
      return shape.rowCount + (shape.rowCount === 1 ? ' row' : ' rows') + columns;
    }
    if (shape.kind === 'text') return 'a serialised graph';
    return 'no rows';
  }

  global.sqlibResults = {
    el: el,
    renderResults: renderResults,
    summariseResults: summariseResults,
    termCell: termCell,
  };
})(window);
