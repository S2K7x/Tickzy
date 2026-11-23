/** Role → permission matrix lives in @tickzy/shared/permissions (shared with the web); re-exported for server code. */
export { can, PERMISSIONS, TOKEN_SCOPES, type Permission, type Role, type TokenScope } from "@tickzy/shared/permissions";
