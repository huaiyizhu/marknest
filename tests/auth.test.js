const assert = require("node:assert/strict");
const {
  authenticationDiagnostics,
  decodeEasyAuthPrincipal,
  easyAuthHeaderPrincipal,
  resolvePrincipal
} = require("../server/auth");

const encodedPrincipal = Buffer.from(JSON.stringify({
  auth_typ: "aad",
  user_id: "microsoft-user-id",
  user_details: "person@example.com",
  claims: [
    { typ: "name", val: "Example Person" },
    { typ: "preferred_username", val: "person@example.com" }
  ]
})).toString("base64");

assert.deepEqual(decodeEasyAuthPrincipal(encodedPrincipal), {
  provider: "aad",
  providerUserId: "microsoft-user-id",
  name: "person@example.com",
  email: "person@example.com"
});

assert.deepEqual(easyAuthHeaderPrincipal({
  "x-ms-client-principal-id": "fallback-user-id",
  "x-ms-client-principal-idp": "aad",
  "x-ms-client-principal-name": "fallback@example.com"
}), {
  provider: "aad",
  providerUserId: "fallback-user-id",
  name: "fallback@example.com",
  email: "fallback@example.com"
});

assert.equal(easyAuthHeaderPrincipal({}), null);

assert.equal(resolvePrincipal({
  headers: {
    "x-ms-client-principal": encodedPrincipal,
    "x-ms-client-principal-id": "ignored-fallback-id"
  }
}).providerUserId, "microsoft-user-id");

assert.deepEqual(authenticationDiagnostics({
  headers: {
    cookie: "AppServiceAuthSession=secret; ARRAffinity=route",
    "user-agent": "test-browser",
    "x-ms-client-principal-id": "diagnostic-user",
    "x-ms-client-principal-idp": "aad",
    "x-ms-client-principal-name": "diagnostic@example.com"
  }
}), {
  authenticated: true,
  cookieNames: ["AppServiceAuthSession", "ARRAffinity"],
  identityHeaders: [
    "x-ms-client-principal-id",
    "x-ms-client-principal-idp",
    "x-ms-client-principal-name"
  ],
  principal: {
    provider: "aad",
    providerUserId: "diagnostic-user",
    name: "diagnostic@example.com",
    email: "diagnostic@example.com"
  },
  userAgent: "test-browser"
});

console.log("Auth tests passed");
