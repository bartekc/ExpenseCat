import type { APIContext } from "astro";
import { createClient } from "@/lib/supabase";
import { expenseJson as json, isUuid } from "./contracts";
import {
  correctionDatabaseError,
  isCheckCorrectionInput,
  isCorrectionInput,
  isCorrectionState,
  isResetCorrectionInput,
  readCorrectionBody,
  type CorrectionState,
} from "./corrections";

type Operation = "get" | "correct" | "reset" | "check";

// Keep session/server dependencies out of the shared browser-facing contracts.
export async function handleCorrectionRequest(context: APIContext, operation: Operation): Promise<Response> {
  if (!context.locals.user) return json({ error: "Authentication required" }, 401);
  if (operation !== "get" && context.request.headers.get("Origin") !== context.url.origin) {
    return json({ error: "Invalid request origin" }, 403);
  }
  const id = context.params.id;
  if (!isUuid(id) || id.length !== 36) return json({ error: "Invalid expense ID" }, 400);
  try {
    const supabase = createClient(context.request.headers, context.cookies);
    if (!supabase) return json({ error: "Expense service is unavailable" }, 503);

    const respond = (
      result: { data: unknown; error: { code: string; message: string; details: string } | null },
      validate: (state: CorrectionState) => boolean,
    ): Response => {
      if (result.error) {
        const failure = correctionDatabaseError(result.error);
        return json(failure.body, failure.status);
      }
      if (
        !isCorrectionState(result.data) ||
        result.data.expense.id.toLowerCase() !== id.toLowerCase() ||
        !validate(result.data)
      ) {
        return json({ error: "Expense category request failed" }, 500);
      }
      return json(result.data, 200);
    };

    if (operation === "get") {
      return respond(
        await supabase.rpc("get_expense_correction_state", { p_expense_id: id, p_keyword: null }),
        (state) => state.rule === null,
      );
    }
    if (operation === "correct") {
      const body = await readCorrectionBody(context.request, isCorrectionInput);
      if ("error" in body) return json({ error: body.error }, body.status);
      const input = body.input;
      return respond(
        await supabase.rpc("correct_expense_category", {
          p_expense_id: id,
          p_expected_revision: input.expected_revision,
          p_category_code: input.category_code,
          p_learn_rule: input.learn_rule,
          p_keyword: input.keyword ?? null,
          p_confirm_rule_id: input.rule_confirmation?.id ?? null,
          p_confirm_rule_revision: input.rule_confirmation?.revision ?? null,
        }),
        (state) =>
          state.expense.manual_category_code === input.category_code &&
          state.expense.correction_revision !== input.expected_revision &&
          (input.learn_rule
            ? state.rule !== null &&
              state.rule.category_code === input.category_code &&
              (!input.rule_confirmation || state.rule.id.toLowerCase() === input.rule_confirmation.id.toLowerCase())
            : state.rule === null),
      );
    }
    if (operation === "reset") {
      const body = await readCorrectionBody(context.request, isResetCorrectionInput);
      if ("error" in body) return json({ error: body.error }, body.status);
      return respond(
        await supabase.rpc("reset_expense_category", {
          p_expense_id: id,
          p_expected_revision: body.input.expected_revision,
        }),
        (state) =>
          state.expense.manual_category_code === null &&
          state.expense.correction_revision !== "0" &&
          state.expense.correction_revision !== body.input.expected_revision &&
          state.rule === null,
      );
    }
    const body = await readCorrectionBody(context.request, isCheckCorrectionInput);
    if ("error" in body) return json({ error: body.error }, body.status);
    return respond(
      await supabase.rpc("get_expense_correction_state", {
        p_expense_id: id,
        p_keyword: body.input.keyword ?? null,
      }),
      (state) => body.input.keyword !== undefined || state.rule === null,
    );
  } catch {
    return json({ error: "Expense category request failed" }, 500);
  }
}
