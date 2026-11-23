// Dev/E2E only: runs the mock OpenID provider as a process and prints its issuer URL.
// Usage: node scripts/mock-oidc.ts <client-id> <client-secret>
import { startMockOidcProvider } from "../src/test-oidc-provider.ts";

const [clientId = "e2e-client", clientSecret = "e2e-secret"] = process.argv.slice(2);
const idp = await startMockOidcProvider(clientId, clientSecret);
console.log(idp.issuer);
