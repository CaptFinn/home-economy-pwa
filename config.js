// Public configuration. The OAuth client id is public by definition, and the
// API URL is a capability rather than a secret: the token check in Api.gs is
// what protects the books. Nothing here identifies the spreadsheet.
export const API_URL = 'PASTE_THE_API_DEPLOYMENT_URL';
export const CLIENT_ID = 'PASTE_THE_OAUTH_CLIENT_ID';
