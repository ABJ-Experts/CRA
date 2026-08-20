# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: connector-success-preserve.spec.ts >> manual review connector sync
- Location: e2e/connector-success-preserve.spec.ts:19:1

# Error details

```
Error: apiRequestContext.post: connect ECONNREFUSED 127.0.0.1:3333
Call log:
  - → POST http://127.0.0.1:3333/api/v1/auth/sign-up
    - user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.34 Safari/537.36
    - accept: */*
    - accept-encoding: gzip,deflate,br
    - content-type: application/json
    - content-length: 128

```

# Test source

```ts
  155 |       } else {
  156 |         objects.push(path);
  157 |       }
  158 |     }
  159 |     if (body.length < 1000) return objects;
  160 |   }
  161 | }
  162 | 
  163 | async function removeImportStorageObjects(
  164 |   bucket: string,
  165 |   organizationId: string,
  166 |   importIds: readonly string[],
  167 | ): Promise<void> {
  168 |   for (const importId of importIds) {
  169 |     const prefix = `${organizationId}/${importId}/`;
  170 |     await removeStoragePrefix(bucket, prefix);
  171 |   }
  172 | }
  173 | 
  174 | async function removeStoragePrefix(
  175 |   bucket: string,
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
  231 |   private sequence = 0;
  232 | 
  233 |   constructor(private readonly testInfo: TestInfo) {}
  234 | 
  235 |   private identity(label: string) {
  236 |     this.sequence += 1;
  237 |     const digest = createHash("sha256")
  238 |       .update(
  239 |         `${E2E_RUN_ID}:${this.testInfo.workerIndex}:${this.testInfo.retry}:${label}:${this.sequence}`,
  240 |       )
  241 |       .digest("hex")
  242 |       .slice(0, 12);
  243 |     const stem = `e2e-${safeLabel(label)}-${digest}`;
  244 |     return { email: `${stem}@cra.test`, username: stem.slice(0, 32) };
  245 |   }
  246 | 
  247 |   async createVerified(
  248 |     context: BrowserContext,
  249 |     label: string,
  250 |   ): Promise<TestAccount> {
  251 |     const identity = this.identity(label);
  252 |     // The API throttles sign-up to five requests per minute. Consecutive
  253 |     // specs each create several run-scoped accounts, so a burst can land
  254 |     // inside one rolling window; wait it out instead of failing the run.
> 255 |     let signUp = await context.request.post(
      |                                        ^ Error: apiRequestContext.post: connect ECONNREFUSED 127.0.0.1:3333
  256 |       `${API_ORIGIN}${API_PREFIX}/auth/sign-up`,
  257 |       {
  258 |         data: { ...identity, password: PASSWORD },
  259 |       },
  260 |     );
  261 |     for (
  262 |       let attempt = 1;
  263 |       signUp.status() === 429 && attempt <= 4;
  264 |       attempt += 1
  265 |     ) {
  266 |       await new Promise((resolve) => setTimeout(resolve, 15_000));
  267 |       signUp = await context.request.post(
  268 |         `${API_ORIGIN}${API_PREFIX}/auth/sign-up`,
  269 |         {
  270 |           data: { ...identity, password: PASSWORD },
  271 |         },
  272 |       );
  273 |     }
  274 |     if (signUp.status() !== 201) {
  275 |       throw new Error(
  276 |         `Sign-up failed (${signUp.status()}): ${await signUp.text()}`,
  277 |       );
  278 |     }
  279 | 
  280 |     const code = await mailFor(identity.email, /(?:^|\D)(\d{6})(?:\D|$)/);
  281 |     const verify = await context.request.post(
  282 |       `${API_ORIGIN}${API_PREFIX}/auth/verify-email`,
  283 |       {
  284 |         data: { code },
  285 |       },
  286 |     );
  287 |     if (verify.status() !== 200) {
  288 |       throw new Error(
  289 |         `Email verification failed (${verify.status()}): ${await verify.text()}`,
  290 |       );
  291 |     }
  292 | 
  293 |     const session = await context.request.get(
  294 |       `${API_ORIGIN}${API_PREFIX}/auth/session`,
  295 |     );
  296 |     if (session.status() !== 200) {
  297 |       throw new Error(
  298 |         `Session lookup failed (${session.status()}): ${await session.text()}`,
  299 |       );
  300 |     }
  301 |     const body = (await session.json()) as SessionBody;
  302 |     const profile = await supabase(
  303 |       `/rest/v1/users?select=auth_user_id&id=eq.${encodeURIComponent(body.user.id)}`,
  304 |     );
  305 |     const rows = (await profile.json()) as { auth_user_id: string }[];
  306 |     if (!profile.ok || rows.length !== 1 || !rows[0]?.auth_user_id) {
  307 |       throw new Error(
  308 |         `Could not resolve exact auth user for ${identity.email}`,
  309 |       );
  310 |     }
  311 |     const account = {
  312 |       email: identity.email,
  313 |       password: PASSWORD,
  314 |       publicUserId: body.user.id,
  315 |       authUserId: rows[0].auth_user_id,
  316 |     };
  317 |     this.accounts.push(account);
  318 |     return account;
  319 |   }
  320 | 
  321 |   trackInvitation(id: string): void {
  322 |     this.invitationIds.add(id);
  323 |   }
  324 | 
  325 |   /**
  326 |    * M1 profiles retain creation and update actors, so their user must be
  327 |    * deleted only after the organization cascade has removed those references.
  328 |    */
  329 |   trackOrganization(id: string): void {
  330 |     this.organizationIds.add(id);
  331 |   }
  332 | 
  333 |   /**
  334 |    * M2 V2 assessment and artifact rows deliberately restrict product deletion.
  335 |    * This opts a run-scoped organization into the existing exact tenant cascade
  336 |    * cleanup after its private artifact prefix has been removed.
  337 |    */
  338 |   trackM2V2Organization(id: string): void {
  339 |     this.trackOrganization(id);
  340 |     this.m2V2OrganizationIds.add(id);
  341 |   }
  342 | 
  343 |   async invitationToken(email: string): Promise<string> {
  344 |     const response = await supabase(
  345 |       `/rest/v1/invitations?select=token_hash&email=eq.${encodeURIComponent(email)}&status=eq.pending`,
  346 |     );
  347 |     const body = await responseBody(response);
  348 |     if (!response.ok || !Array.isArray(body)) {
  349 |       throw new Error(`Could not resolve pending invitation for ${email}`);
  350 |     }
  351 |     const hashes = new Set(
  352 |       body.flatMap((row: unknown) => {
  353 |         if (!row || typeof row !== "object" || !("token_hash" in row)) {
  354 |           return [];
  355 |         }
```