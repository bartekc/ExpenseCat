import type { APIRoute } from "astro";
import { importExpenses } from "@/lib/expenses/import";
import { ExpenseCsvFileError, MAX_CSV_BYTES, parseExpenseCsv } from "@/lib/expenses/parse-csv";
import { createClient } from "@/lib/supabase";

const MAX_MULTIPART_BYTES = MAX_CSV_BYTES + 16 * 1024;

const json = (body: object, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function readBoundedMultipart(request: Request): Promise<Blob | null> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing multipart body");

  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > MAX_MULTIPART_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      size += value.byteLength;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return new Blob(chunks);
}

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) return json({ error: "Authentication required" }, 401);

  const origin = context.request.headers.get("Origin");
  if (origin !== context.url.origin) return json({ error: "Invalid request origin" }, 403);
  const contentType = context.request.headers.get("Content-Type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) {
    return json({ error: "Expected multipart form data" }, 400);
  }

  let form: FormData;
  try {
    const body = await readBoundedMultipart(context.request);
    if (body === null) return json({ error: "CSV upload exceeds allowed size" }, 413);
    form = await new Request(context.request.url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    }).formData();
  } catch {
    return json({ error: "Invalid multipart form data" }, 400);
  }

  const entries = [...form.entries()];
  if (entries.length !== 1 || entries[0][0] !== "file" || !(entries[0][1] instanceof File)) {
    return json({ error: "Provide one CSV file" }, 400);
  }

  const file = entries[0][1];
  if (file.size === 0) return json({ error: "CSV file is empty" }, 400);
  if (file.size > MAX_CSV_BYTES) return json({ error: "CSV file exceeds 2 MiB" }, 413);

  let parsed;
  try {
    parsed = parseExpenseCsv(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof ExpenseCsvFileError) return json({ error: error.message }, 400);
    return json({ error: "CSV file could not be processed" }, 500);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return json({ error: "Expense service is unavailable" }, 503);

  try {
    return json(await importExpenses(supabase, context.locals.user.id, parsed), 200);
  } catch {
    return json({ error: "Expense import could not be saved" }, 500);
  }
};
