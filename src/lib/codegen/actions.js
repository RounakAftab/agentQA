// Locator actions shared by the parser and the emitter. Kept apart from parse.js so the editor
// can build code in the browser without loading the JavaScript parser.

export const ACTIONS = new Set([
  'click', 'dblclick', 'tap', 'hover', 'focus', 'blur', 'clear', 'fill', 'type', 'press', 'pressSequentially',
  'check', 'uncheck', 'setChecked', 'selectOption', 'setInputFiles', 'dragTo',
]);
// Actions whose first argument is data the test enters. They become method parameters.
export const VALUE_ACTIONS = new Set(['fill', 'type', 'pressSequentially', 'selectOption', 'setInputFiles']);
export const TYPED_ACTIONS = new Set(['fill', 'type', 'pressSequentially']);
