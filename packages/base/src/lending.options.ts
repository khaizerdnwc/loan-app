/** What the composition root tells the lending module about where it runs. */
export interface LendingModuleOptions {
  jwtSecret: string;
  /** Send the session cookie only over HTTPS (true outside local development and tests). */
  cookieSecure: boolean;
}

export const LENDING_OPTIONS = "LENDING_MODULE_OPTIONS";
