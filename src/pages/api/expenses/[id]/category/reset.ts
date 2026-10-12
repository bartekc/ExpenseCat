import type { APIRoute } from "astro";
import { handleCorrectionRequest } from "@/lib/expenses/corrections-api";

export const POST: APIRoute = (context) => handleCorrectionRequest(context, "reset");
