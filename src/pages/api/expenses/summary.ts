import type { APIRoute } from "astro";
import { expenseJson as json } from "@/lib/expenses/contracts";
import { currentWarsawPeriod, summaryFromDatabase } from "@/lib/expenses/monthly";
import { createClient } from "@/lib/supabase";

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) return json({ error: "Authentication required" }, 401);
  if ([...context.url.searchParams.keys()].length > 0) return json({ error: "Summary does not accept filters" }, 400);
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return json({ error: "Expense service is unavailable" }, 503);
  const period = currentWarsawPeriod(new Date());
  const result = await supabase.rpc("get_expense_category_totals", {
    p_start_date: period.startDate,
    p_end_date: period.endDateExclusive,
  });
  const data: unknown = result.data;
  const summary = result.error ? null : summaryFromDatabase(period, data);
  if (!summary) return json({ error: "Monthly summary could not be loaded" }, 500);
  return json(summary, 200);
};
