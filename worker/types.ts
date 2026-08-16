export interface Env {
  DB: D1Database;
  ARTIFACTS?: R2Bucket;
  ASSETS?: Fetcher;
  AFDFW?: Fetcher;
  BACKEND_MODE?: "development" | "afdfw";
  AFDFW_BASE_URL?: string;
  AFDFW_SERVICE_TOKEN?: string;
}

export type OwnerSession = {
  status: "development" | "approved";
  userId: string;
  displayName: string;
  setCookie?: string;
};
