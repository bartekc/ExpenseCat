import type { APIRoute } from "astro";
import { expenseJson as json, isUuid } from "@/lib/expenses/contracts";
import { isCategoryRule, readRuleBody, ruleDatabaseError } from "@/lib/expenses/rules";
import { createClient } from "@/lib/supabase";

export const PATCH: APIRoute = async (context) => {
  if (!context.locals.user) return json({ error: "Authentication required" }, 401);
  if (context.request.headers.get("Origin") !== context.url.origin)
    return json({ error: "Invalid request origin" }, 403);
  if (!isUuid(context.params.id)) return json({ error: "Invalid rule ID" }, 400);
  const body = await readRuleBody(context.request);
  if ("error" in body) return json({ error: body.error }, body.status);
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return json({ error: "Expense service is unavailable" }, 503);
  const { data, error } = await supabase
    .from("expense_category_rules")
    .update(body.input)
    .eq("id", context.params.id)
    .select("id,keyword,category_code")
    .maybeSingle();
  if (error) {
    const failure = ruleDatabaseError(error.code);
    return json({ error: failure.error }, failure.status);
  }
  if (data === null) return json({ error: "Category rule not found" }, 404);
  if (!isCategoryRule(data)) return json({ error: "Category rule could not be saved" }, 500);
  return json(data, 200);
};

export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) return json({ error: "Authentication required" }, 401);
  if (context.request.headers.get("Origin") !== context.url.origin)
    return json({ error: "Invalid request origin" }, 403);
  if (!isUuid(context.params.id)) return json({ error: "Invalid rule ID" }, 400);
  // DELETE has no payload. Inspect at most the first chunk; never parse or buffer an owner/replacement body.
  const reader = context.request.body?.getReader();
  if (reader) {
    let hasBody = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.byteLength > 0) {
          hasBody = true;
          break;
        }
      }
      await reader.cancel().catch(() => undefined);
    } catch {
      return json({ error: "Invalid request body" }, 400);
    } finally {
      reader.releaseLock();
    }
    if (hasBody) return json({ error: "DELETE does not accept a body" }, 400);
  }
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return json({ error: "Expense service is unavailable" }, 503);
  const { data, error } = await supabase
    .from("expense_category_rules")
    .delete()
    .eq("id", context.params.id)
    .select("id")
    .maybeSingle();
  if (error) return json({ error: "Category rule could not be deleted" }, 500);
  if (data === null) return json({ error: "Category rule not found" }, 404);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
};
