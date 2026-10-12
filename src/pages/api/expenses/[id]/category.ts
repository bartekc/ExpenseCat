import type { APIRoute } from "astro";
import { handleCorrectionRequest } from "@/lib/expenses/corrections-api";

export const GET: APIRoute = (context) => handleCorrectionRequest(context, "get");
export const PATCH: APIRoute = (context) => handleCorrectionRequest(context, "correct");
