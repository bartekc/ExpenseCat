import type { APIRoute } from "astro";
import { EXPENSE_CATEGORIES } from "@/lib/expenses/categories";
import { EXPENSE_PAGE_SIZE as PAGE_SIZE, expenseJson as json, isSafeCount, parsePage } from "@/lib/expenses/contracts";
import { isCategoryRule, readRuleBody, ruleDatabaseError } from "@/lib/expenses/rules";
import { createClient } from "@/lib/supabase";

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) return json({ error: "Authentication required" }, 401);
  const pagination = parsePage(context.url.searchParams.get("page"));
  if (!pagination) return json({ error: "Page must be a positive integer in range" }, 400);
  const { page, offset } = pagination;
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return json({ error: "Expense service is unavailable" }, 503);
  const { count, error: countError } = await supabase
    .from("expense_category_rules")
    .select("id", { count: "exact", head: true });
  if (countError || !isSafeCount(count)) return json({ error: "Category rules could not be loaded" }, 500);
  const envelope = {
    categories: EXPENSE_CATEGORIES,
    page,
    pageSize: PAGE_SIZE,
    total: count,
    totalPages: Math.ceil(count / PAGE_SIZE),
  };
  if (offset >= count) return json({ rules: [], ...envelope }, 200);
  const { data, error } = await supabase
    .from("expense_category_rules")
    .select("id,keyword,category_code")
    .order("normalized_keyword", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);
  if (error || !Array.isArray(data) || !data.every(isCategoryRule))
    return json({ error: "Category rules could not be loaded" }, 500);
  return json({ rules: data, ...envelope }, 200);
};

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) return json({ error: "Authentication required" }, 401);
  if (context.request.headers.get("Origin") !== context.url.origin)
    return json({ error: "Invalid request origin" }, 403);
  const body = await readRuleBody(context.request);
  if ("error" in body) return json({ error: body.error }, body.status);
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return json({ error: "Expense service is unavailable" }, 503);
  const { data, error } = await supabase
    .from("expense_category_rules")
    .insert(body.input)
    .select("id,keyword,category_code")
    .single();
  if (error) {
    const failure = ruleDatabaseError(error.code);
    return json({ error: failure.error }, failure.status);
  }
  if (!isCategoryRule(data)) return json({ error: "Category rule could not be saved" }, 500);
  return json(data, 201);
};
