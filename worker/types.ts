export interface Env {
  DB: D1Database;
  JOB_QUEUE?: Queue<JobMessage>;
  ARTIFACTS?: R2Bucket;
  ASSETS?: Fetcher;
  AFDFW?: Fetcher;
  BACKEND_MODE?: "development" | "self-hosted" | "afdfw";
  LOCAL_HARDWARE_ONLY?: "true" | "false";
  SELF_HOSTED_OWNER_ID?: string;
  SELF_HOSTED_DISPLAY_NAME?: string;
  SELF_HOSTED_ACCESS_EMAIL?: string;
  SELF_HOSTED_INTERNAL_TOKEN?: string;
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
