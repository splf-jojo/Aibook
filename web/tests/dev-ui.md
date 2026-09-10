# Dev UI browser fixture

Run `node scripts/dev-ui-preview.mjs` from `web`, then open
`http://127.0.0.1:4318/dev`. Restart the script after source changes.

The fixture renders the actual Dev components with a small browser router.
Dataset, review, experiment and publication requests use in-memory synthetic
data; reloading the page resets it. It never approves or publishes user data.
Authentication, importing files and the analysis worker must be checked separately
against the local Docker stack. This fixture is not an API integration test.

Browser checks:

- Review: accept a sample, undo, edit its label, attempt navigation, cancel the
  edit, then use each decision. Verify the context image remains available.
- All samples: search and filter, open a sample, return to the gallery, visit
  Writing and return. Verify selection, filter and scroll position survive.
- Symbols: open a symbol, change a point, wait for autosave, generate variants,
  switch symbols and return. Check source sample links and the alignment switch.
- Writing: enter distinct Text and LaTeX drafts, switch modes, navigate away
  and back. Open Spacing, Display and Inspect; close Inspect to hide overlays.
  Export PNG and confirm it contains only the rendered output.
- On a real authenticated Dev session, inspect existing datasets without
  changing decisions or publishing. Check old route redirects and browser errors.
