export type PasswordFillResult = {
  ok: boolean;
  usernameFilled: boolean;
  passwordFilled: boolean;
  reason?: string;
};

/**
 * Builds a one-shot, main-frame-only fill. The exact origin is checked again
 * inside the page immediately before touching any field, and the form is never submitted.
 */
export function buildPasswordFillScript(
  expectedOrigin: string,
  username: string,
  password: string,
): string {
  const payload = JSON.stringify({ expectedOrigin, username, password });
  return `(() => {
    const credential = ${payload};
    if (location.origin !== credential.expectedOrigin) {
      return { ok: false, usernameFilled: false, passwordFilled: false, reason: "origin-changed" };
    }
    const visible = (input) => {
      const style = getComputedStyle(input);
      const rect = input.getBoundingClientRect();
      return !input.disabled && !input.readOnly && style.display !== "none" &&
        style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const passwordInput = [...document.querySelectorAll('input[type="password"]')].find(visible);
    if (!passwordInput) {
      return { ok: false, usernameFilled: false, passwordFilled: false, reason: "password-field-missing" };
    }
    const scope = passwordInput.form || document;
    const usernameInput = [
      ...scope.querySelectorAll(
        'input[autocomplete="username"], input[type="email"], input[name*="email" i], input[name*="user" i], input[type="text"]'
      )
    ].find((input) => input !== passwordInput && visible(input));
    const setValue = (input, value) => {
      const prototype = input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (!setter) return false;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    };
    const usernameFilled = usernameInput ? setValue(usernameInput, credential.username) : false;
    const passwordFilled = setValue(passwordInput, credential.password);
    passwordInput.focus();
    return { ok: passwordFilled, usernameFilled, passwordFilled };
  })()`;
}
