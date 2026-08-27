# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: organization-branding-theme.spec.ts >> saving a branding draft leaves the dashboard neutral until publication
- Location: e2e/organization-branding-theme.spec.ts:81:1

# Error details

```
Error: SUPABASE_SERVICE_ROLE_KEY is required for exact E2E cleanup
```

# Test source

```ts
  11  | const API_PREFIX = "/api/v1";
  12  | const API_ORIGIN = process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:3333";
  13  | const MAILPIT_ORIGIN =
  14  |   process.env.E2E_MAILPIT_ORIGIN ?? "http://127.0.0.1:54324";
  15  | const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
  16  | const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  17  | const PASSWORD = "Password123";
  18  | const PRODUCT_IMPORT_BUCKET = "product-imports";
  19  | const SECURITY_UPDATE_ARTIFACT_BUCKET = "security-update-artifacts";
  20  | 
  21  | const configuredRunId = process.env.E2E_RUN_ID;
  22  | if (configuredRunId && !/^[a-zA-Z0-9-]{8,80}$/.test(configuredRunId)) {
  23  |   throw new Error(
  24  |     "E2E_RUN_ID must contain only 8-80 letters, digits, or dashes",
  25  |   );
  26  | }
  27  | export const E2E_RUN_ID = configuredRunId ?? randomUUID().replaceAll("-", "");
  28  | 
  29  | export interface TestAccount {
  30  |   readonly email: string;
  31  |   readonly password: string;
  32  |   readonly publicUserId: string;
  33  |   readonly authUserId: string;
  34  | }
  35  | 
  36  | interface MailpitMessage {
  37  |   readonly ID?: string;
  38  |   readonly Id?: string;
  39  | }
  40  | 
  41  | interface MailpitMessageDetail {
  42  |   readonly To?: readonly Readonly<{ Address?: string }>[];
  43  |   readonly Text?: string;
  44  |   readonly HTML?: string;
  45  | }
  46  | 
  47  | interface SessionBody {
  48  |   readonly user: { readonly id: string; readonly email: string };
  49  | }
  50  | 
  51  | function safeLabel(value: string): string {
  52  |   return value
  53  |     .toLowerCase()
  54  |     .replace(/[^a-z0-9]+/g, "-")
  55  |     .replace(/^-|-$/g, "")
  56  |     .slice(0, 20);
  57  | }
  58  | 
  59  | async function responseBody(response: Response): Promise<unknown> {
  60  |   const text = await response.text();
  61  |   try {
  62  |     return JSON.parse(text) as unknown;
  63  |   } catch {
  64  |     return text;
  65  |   }
  66  | }
  67  | 
  68  | async function mailFor(
  69  |   email: string,
  70  |   pattern: RegExp,
  71  |   accepts: (value: string) => boolean = () => true,
  72  | ): Promise<string> {
  73  |   const deadline = Date.now() + 15_000;
  74  |   while (Date.now() < deadline) {
  75  |     const list = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages?limit=100`);
  76  |     if (list.ok) {
  77  |       const payload = (await list.json()) as { messages?: MailpitMessage[] };
  78  |       for (const candidate of payload.messages ?? []) {
  79  |         const id = candidate.ID ?? candidate.Id;
  80  |         if (!id) continue;
  81  |         const messageResponse = await fetch(
  82  |           `${MAILPIT_ORIGIN}/api/v1/message/${id}`,
  83  |         );
  84  |         if (!messageResponse.ok) continue;
  85  |         const message = (await messageResponse.json()) as MailpitMessageDetail;
  86  |         if (
  87  |           !message.To?.some(
  88  |             ({ Address }) => Address?.toLowerCase() === email.toLowerCase(),
  89  |           )
  90  |         )
  91  |           continue;
  92  |         const match = pattern.exec(
  93  |           `${message.Text ?? ""}\n${message.HTML ?? ""}`,
  94  |         );
  95  |         if (match?.[1]) {
  96  |           const value = decodeURIComponent(match[1]);
  97  |           if (accepts(value)) return value;
  98  |         }
  99  |       }
  100 |     }
  101 |     await new Promise((resolve) => setTimeout(resolve, 250));
  102 |   }
  103 |   throw new Error(`Timed out waiting for Mailpit message to ${email}`);
  104 | }
  105 | 
  106 | async function supabase(
  107 |   path: string,
  108 |   init: RequestInit = {},
  109 | ): Promise<Response> {
  110 |   if (!SERVICE_ROLE_KEY) {
> 111 |     throw new Error(
      |           ^ Error: SUPABASE_SERVICE_ROLE_KEY is required for exact E2E cleanup
  112 |       "SUPABASE_SERVICE_ROLE_KEY is required for exact E2E cleanup",
  113 |     );
  114 |   }
  115 |   return fetch(`${SUPABASE_URL}${path}`, {
  116 |     ...init,
  117 |     headers: {
  118 |       apikey: SERVICE_ROLE_KEY,
  119 |       authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  120 |       ...init.headers,
  121 |     },
  122 |   });
  123 | }
  124 | 
  125 | type StorageObject = Readonly<{ name?: string; id?: string | null }>;
  126 | 
  127 | async function listStorageObjects(
  128 |   bucket: string,
  129 |   prefix: string,
  130 | ): Promise<readonly string[]> {
  131 |   const objects: string[] = [];
  132 |   for (let offset = 0; ; offset += 1000) {
  133 |     const response = await supabase(`/storage/v1/object/list/${bucket}`, {
  134 |       method: "POST",
  135 |       headers: { "content-type": "application/json" },
  136 |       body: JSON.stringify({ prefix, limit: 1000, offset }),
  137 |     });
  138 |     const body = await responseBody(response);
  139 |     if (!response.ok || !Array.isArray(body)) {
  140 |       throw new Error(
  141 |         `Could not list scoped storage objects for ${bucket}/${prefix}: ${JSON.stringify(body)}`,
  142 |       );
  143 |     }
  144 |     for (const entry of body as StorageObject[]) {
  145 |       if (
  146 |         !entry.name ||
  147 |         entry.name.includes("..") ||
  148 |         entry.name.includes("\\")
  149 |       ) {
  150 |         throw new Error(`Unexpected scoped storage object name in ${bucket}`);
  151 |       }
  152 |       const path = `${prefix}${entry.name}`;
  153 |       if (entry.id === null) {
  154 |         objects.push(...(await listStorageObjects(bucket, `${path}/`)));
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
```