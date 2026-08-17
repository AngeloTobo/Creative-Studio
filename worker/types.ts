export interface Env {
  DB: D1Database;
  JOB_QUEUE?: Queue<JobMessage>;
  ARTIFACTS?: R2Bucket;
  ASSETS?: Fetcher;
  AFDFW?: Fetcher;
  BACKEND_MODE?: "development" | "afdfw";
  LOCAL_HARDWARE_ONLY?: "true" | "false";
  AFDFW_BASE_URL?: string;
  AFDFW_SERVICE_TOKEN?: string;
}

export type JobMessage = { jobId: string };

export type OwnerSession = {
  status: "development" | "approved";
  userId: string;
  displayName: string;
  setCookie?: string;
};
