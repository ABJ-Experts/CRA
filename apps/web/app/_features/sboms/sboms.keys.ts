const all = Object.freeze(["sboms"] as const);
const jobs = Object.freeze(["sboms", "jobs"] as const);
const job = Object.freeze((jobId: string) =>
  Object.freeze([...jobs, jobId] as const),
);
const ciCredentials = Object.freeze(["sboms", "ci-credentials"] as const);

export const sbomKeys = Object.freeze({ all, jobs, job, ciCredentials });
