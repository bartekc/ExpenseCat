import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

const PAGE_SIZE = 50;
const json = (body: object, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) return json({ error: "Authentication required" }, 401);

  const pageText = context.url.searchParams.get("page") ?? "1";
  if (!/^[1-9]\d*$/.test(pageText)) return json({ error: "Page must be a positive integer" }, 400);
  const page = Number(pageText);
  const offset = (page - 1) * PAGE_SIZE;
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(offset) || offset > 2_147_483_647 - PAGE_SIZE) {
    return json({ error: "Page is out of range" }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return json({ error: "Expense service is unavailable" }, 503);

  const { count, error: countError } = await supabase
    .from("expenses")
    .select("id", { count: "exact", head: true })
    .not("transaction_date", "is", null)
    .not("amount", "is", null)
    .not("title", "is", null);
  if (countError || count === null) return json({ error: "Expenses could not be loaded" }, 500);
  if (offset >= count) {
    return json(
      { expenses: [], page, pageSize: PAGE_SIZE, total: count, totalPages: Math.ceil(count / PAGE_SIZE) },
      200,
    );
  }

  const { data, error } = await supabase
    .from("expenses")
    .select("id,transaction_date,amount,title,currency")
    .not("transaction_date", "is", null)
    .not("amount", "is", null)
    .not("title", "is", null)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) return json({ error: "Expenses could not be loaded" }, 500);

  return json(
    { expenses: data, page, pageSize: PAGE_SIZE, total: count, totalPages: Math.ceil(count / PAGE_SIZE) },
    200,
  );
};
