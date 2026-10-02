# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m11-integration-hub.spec.ts >> M11 owner manages write-only credentials, conflicts and safe connection lifecycle without crossing tenants
- Location: e2e/m11-integration-hub.spec.ts:215:1

# Error details

```
Error: Sign-up failed (503): {"statusCode":503,"message":"Something went wrong. Please try again."}
```

# Test source

```ts
  176 |   prefix: string,
  177 | ): Promise<void> {
  178 |   if (!/^[0-9a-f-]{36}\/$|^[0-9a-f-]{36}\/[0-9a-f-]{36}\/$/i.test(prefix)) {
  179 |     throw new Error(
  180 |       `Refusing to remove storage outside a scoped prefix in ${bucket}`,
  181 |     );
  182 |   }
  183 |   const objects = await listStorageObjects(bucket, prefix);
  184 |   if (objects.some((object) => !object.startsWith(prefix))) {
  185 |     throw new Error(`Refusing to remove storage outside ${bucket}/${prefix}`);
  186 |   }
  187 |   for (let index = 0; index < objects.length; index += 1000) {
  188 |     const prefixes = objects.slice(index, index + 1000);
  189 |     const response = await supabase(`/storage/v1/object/${bucket}`, {
  190 |       method: "DELETE",
  191 |       headers: { "content-type": "application/json" },
  192 |       body: JSON.stringify({ prefixes }),
  193 |     });
  194 |     if (!response.ok) {
  195 |       throw new Error(
  196 |         `Could not remove scoped storage objects for ${bucket}/${prefix}: ${JSON.stringify(await responseBody(response))}`,
  197 |       );
  198 |     }
  199 |   }
  200 |   const remaining = await listStorageObjects(bucket, prefix);
  201 |   if (remaining.length !== 0) {
  202 |     throw new Error(
  203 |       `Scoped storage cleanup assertion failed for ${bucket}/${prefix}`,
  204 |     );
  205 |   }
  206 | }
  207 | 
  208 | async function runScopedImportIds(
  209 |   organizationId: string,
  210 | ): Promise<readonly string[]> {
  211 |   const response = await supabase(
  212 |     `/rest/v1/product_import_jobs?select=id&organization_id=eq.${encodeURIComponent(organizationId)}`,
  213 |   );
  214 |   const body = await responseBody(response);
  215 |   if (!response.ok || !Array.isArray(body)) {
  216 |     throw new Error(
  217 |       `Could not resolve scoped import fixtures for ${organizationId}: ${JSON.stringify(body)}`,
  218 |     );
  219 |   }
  220 |   return body.flatMap((row: unknown) => {
  221 |     if (!row || typeof row !== "object" || !("id" in row)) return [];
  222 |     return typeof row.id === "string" ? [row.id] : [];
  223 |   });
  224 | }
  225 | 
  226 | export class RunScopedAccounts {
  227 |   private readonly accounts: TestAccount[] = [];
  228 |   private readonly invitationIds = new Set<string>();
  229 |   private readonly organizationIds = new Set<string>();
  230 |   private readonly m2V2OrganizationIds = new Set<string>();
  231 |   private readonly m3OrganizationIds = new Set<string>();
  232 |   private sequence = 0;
  233 | 
  234 |   constructor(private readonly testInfo: TestInfo) {}
  235 | 
  236 |   private identity(label: string) {
  237 |     this.sequence += 1;
  238 |     const digest = createHash("sha256")
  239 |       .update(
  240 |         `${E2E_RUN_ID}:${this.testInfo.workerIndex}:${this.testInfo.retry}:${label}:${this.sequence}`,
  241 |       )
  242 |       .digest("hex")
  243 |       .slice(0, 12);
  244 |     const stem = `e2e-${safeLabel(label)}-${digest}`;
  245 |     return { email: `${stem}@cra.test`, username: stem.slice(0, 32) };
  246 |   }
  247 | 
  248 |   async createVerified(
  249 |     context: BrowserContext,
  250 |     label: string,
  251 |   ): Promise<TestAccount> {
  252 |     const identity = this.identity(label);
  253 |     // The API throttles sign-up to five requests per minute. Consecutive
  254 |     // specs each create several run-scoped accounts, so a burst can land
  255 |     // inside one rolling window; wait it out instead of failing the run.
  256 |     let signUp = await context.request.post(
  257 |       `${API_ORIGIN}${API_PREFIX}/auth/sign-up`,
  258 |       {
  259 |         data: { ...identity, password: PASSWORD },
  260 |       },
  261 |     );
  262 |     for (
  263 |       let attempt = 1;
  264 |       signUp.status() === 429 && attempt <= 4;
  265 |       attempt += 1
  266 |     ) {
  267 |       await new Promise((resolve) => setTimeout(resolve, 15_000));
  268 |       signUp = await context.request.post(
  269 |         `${API_ORIGIN}${API_PREFIX}/auth/sign-up`,
  270 |         {
  271 |           data: { ...identity, password: PASSWORD },
  272 |         },
  273 |       );
  274 |     }
  275 |     if (signUp.status() !== 201) {
> 276 |       throw new Error(
      |             ^ Error: Sign-up failed (503): {"statusCode":503,"message":"Something went wrong. Please try again."}
  277 |         `Sign-up failed (${signUp.status()}): ${await signUp.text()}`,
  278 |       );
  279 |     }
  280 | 
  281 |     const code = await mailFor(identity.email, /(?:^|\D)(\d{6})(?:\D|$)/);
  282 |     const verify = await context.request.post(
  283 |       `${API_ORIGIN}${API_PREFIX}/auth/verify-email`,
  284 |       {
  285 |         data: { code },
  286 |       },
  287 |     );
  288 |     if (verify.status() !== 200) {
  289 |       throw new Error(
  290 |         `Email verification failed (${verify.status()}): ${await verify.text()}`,
  291 |       );
  292 |     }
  293 | 
  294 |     const session = await context.request.get(
  295 |       `${API_ORIGIN}${API_PREFIX}/auth/session`,
  296 |     );
  297 |     if (session.status() !== 200) {
  298 |       throw new Error(
  299 |         `Session lookup failed (${session.status()}): ${await session.text()}`,
  300 |       );
  301 |     }
  302 |     const body = (await session.json()) as SessionBody;
  303 |     const profile = await supabase(
  304 |       `/rest/v1/users?select=auth_user_id&id=eq.${encodeURIComponent(body.user.id)}`,
  305 |     );
  306 |     const rows = (await profile.json()) as { auth_user_id: string }[];
  307 |     if (!profile.ok || rows.length !== 1 || !rows[0]?.auth_user_id) {
  308 |       throw new Error(
  309 |         `Could not resolve exact auth user for ${identity.email}`,
  310 |       );
  311 |     }
  312 |     const account = {
  313 |       email: identity.email,
  314 |       password: PASSWORD,
  315 |       publicUserId: body.user.id,
  316 |       authUserId: rows[0].auth_user_id,
  317 |     };
  318 |     this.accounts.push(account);
  319 |     return account;
  320 |   }
  321 | 
  322 |   trackInvitation(id: string): void {
  323 |     this.invitationIds.add(id);
  324 |   }
  325 | 
  326 |   /**
  327 |    * M1 profiles retain creation and update actors, so their user must be
  328 |    * deleted only after the organization cascade has removed those references.
  329 |    */
  330 |   trackOrganization(id: string): void {
  331 |     this.organizationIds.add(id);
  332 |   }
  333 | 
  334 |   /**
  335 |    * M2 V2 assessment and artifact rows deliberately restrict product deletion.
  336 |    * This opts a run-scoped organization into the existing exact tenant cascade
  337 |    * cleanup after its private artifact prefix has been removed.
  338 |    */
  339 |   trackM2V2Organization(id: string): void {
  340 |     this.trackOrganization(id);
  341 |     this.m2V2OrganizationIds.add(id);
  342 |   }
  343 | 
  344 |   /** SBOM evidence is removed only with this generated tenant and its private bucket prefix. */
  345 |   trackM3Organization(id: string): void {
  346 |     this.trackM2V2Organization(id);
  347 |     this.m3OrganizationIds.add(id);
  348 |   }
  349 | 
  350 |   async invitationToken(email: string): Promise<string> {
  351 |     const response = await supabase(
  352 |       `/rest/v1/invitations?select=token_hash&email=eq.${encodeURIComponent(email)}&status=eq.pending`,
  353 |     );
  354 |     const body = await responseBody(response);
  355 |     if (!response.ok || !Array.isArray(body)) {
  356 |       throw new Error(`Could not resolve pending invitation for ${email}`);
  357 |     }
  358 |     const hashes = new Set(
  359 |       body.flatMap((row: unknown) => {
  360 |         if (!row || typeof row !== "object" || !("token_hash" in row)) {
  361 |           return [];
  362 |         }
  363 |         const tokenHash = (row as { token_hash?: unknown }).token_hash;
  364 |         return typeof tokenHash === "string" ? [tokenHash] : [];
  365 |       }),
  366 |     );
  367 |     return mailFor(email, /accept-invitation\?token=([a-f0-9]{64})/, (token) =>
  368 |       hashes.has(createHash("sha256").update(token).digest("hex")),
  369 |     );
  370 |   }
  371 | 
  372 |   async expireInvitation(id: string): Promise<void> {
  373 |     this.trackInvitation(id);
  374 |     const response = await supabase(
  375 |       `/rest/v1/invitations?id=eq.${encodeURIComponent(id)}`,
  376 |       {
```