import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  EXPENSE_PAGE_SIZE as PAGE_SIZE,
  expenseJson as json,
  isExpense,
  isSafeCount,
  parsePage,
} from "@/lib/expenses/contracts";

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) return json({ error: "Authentication required" }, 401);

  const pagination = parsePage(context.url.searchParams.get("page"));
  if (!pagination) return json({ error: "Page must be a positive integer in range" }, 400);
  const { page, offset } = pagination;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return json({ error: "Expense service is unavailable" }, 503);

  const { count, error: countError } = await supabase
    .from("expense_review")
    .select("id", { count: "exact", head: true });
  if (countError || !isSafeCount(count)) return json({ error: "Expenses could not be loaded" }, 500);
  if (offset >= count) {
    return json(
      { expenses: [], page, pageSize: PAGE_SIZE, total: count, totalPages: Math.ceil(count / PAGE_SIZE) },
      200,
    );
  }

  const { data, error } = await supabase
    .from("expense_review")
    .select("id,transaction_date,amount,title,currency,category_code,needs_review,review_reason")
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error || !Array.isArray(data) || !data.every(isExpense))
    return json({ error: "Expenses could not be loaded" }, 500);

  return json(
    { expenses: data, page, pageSize: PAGE_SIZE, total: count, totalPages: Math.ceil(count / PAGE_SIZE) },
    200,
  );
};
