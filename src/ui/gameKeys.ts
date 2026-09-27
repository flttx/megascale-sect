/** Native controls keep their own Space, Tab and letter-key behaviour. */
export function isUiInput(event: KeyboardEvent) {
  return event.target instanceof Element && !!event.target.closest('.interface button, .interface input, .interface select, .interface textarea, [contenteditable="true"], [role="dialog"]')
}
