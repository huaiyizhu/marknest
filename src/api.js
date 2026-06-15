(function (global) {
  const DEV_IDENTITY_KEY = "marknest-dev-identity";

  function devIdentity() {
    try {
      return JSON.parse(localStorage.getItem(DEV_IDENTITY_KEY));
    } catch {
      return null;
    }
  }

  function authHeaders() {
    const identity = devIdentity();
    if (!identity || location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return {};
    return {
      "x-dev-user-id": identity.providerUserId,
      "x-dev-provider": identity.provider,
      "x-dev-user-name": identity.name,
      "x-dev-user-email": identity.email
    };
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30000);
    try {
      const response = await fetch(path, {
        ...options,
        cache: options.cache || "no-store",
        credentials: options.credentials || "same-origin",
        signal: options.signal || controller.signal,
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
          ...(options.headers || {})
        }
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      if (!response.ok) {
        const error = new Error(body?.error || `Request failed (${response.status})`);
        error.status = response.status;
        throw error;
      }
      return body;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("The server took too long to respond. Please try again.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function signIn(provider) {
    const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (!local) {
      location.assign(provider === "microsoft"
        ? "/.auth/login/aad?post_login_redirect_uri=/"
        : "/.auth/login/google?post_login_redirect_uri=/");
      return false;
    }
    const identity = provider === "microsoft"
      ? { provider: "microsoft", providerUserId: "demo-admin", name: "Ada Admin", email: "ada.admin@example.com" }
      : { provider: "google", providerUserId: "demo-writer", name: "Grace Writer", email: "grace.writer@example.com" };
    localStorage.setItem(DEV_IDENTITY_KEY, JSON.stringify(identity));
    return true;
  }

  function signOut() {
    const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (!local) {
      location.assign("/.auth/logout?post_logout_redirect_uri=/");
      return false;
    }
    localStorage.removeItem(DEV_IDENTITY_KEY);
    return true;
  }

  global.MarknestApi = { request, signIn, signOut };
})(window);
