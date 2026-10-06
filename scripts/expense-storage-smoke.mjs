import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { performance } from "node:perf_hooks";
import { URL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const benchmark = process.argv.includes("--benchmark");
const benchmarkContainer = process.env.STORAGE_SMOKE_DB_CONTAINER;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_KEY are required");
  process.exit(1);
}

if (benchmark && !benchmarkContainer) {
  console.error("--benchmark requires STORAGE_SMOKE_DB_CONTAINER for the local authenticated EXPLAIN query");
  process.exit(1);
}

if (benchmark && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(SUPABASE_URL).hostname)) {
  console.error("--benchmark is restricted to local Supabase");
  process.exit(1);
}

// Node 22.22.3 can load this dependency-free catalogue without changing npm scripts
// or requiring experimental CLI flags. Compare its actual exports to persisted rows.
const categorySource = await readFile(new URL("../src/lib/expenses/categories.ts", import.meta.url), "utf8");
const { EXPENSE_CATEGORIES } = await import(
  `data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(categorySource))}`
);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function fail(message) {
  throw new Error(message);
}

async function parseResponse(response) {
  const body = await response.text();
  return {
    status: response.status,
    body: body ? JSON.parse(body) : null,
  };
}

async function signUp(label) {
  const email = `storage-${label}-${suffix}@example.com`;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: "Storage-Smoke-Passw0rd!" }),
  });
  const { status, body } = await parseResponse(response);

  if (status !== 200 || !body?.access_token || !body?.user?.id) {
    fail(`sign up for ${label} failed: ${status} ${JSON.stringify(body)}`);
  }

  return { id: body.user.id, accessToken: body.access_token };
}

async function storageRequest(user, resource, path = "", options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      ...(user ? { Authorization: `Bearer ${user.accessToken}` } : {}),
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...options.headers,
    },
  });
  return parseResponse(response);
}

const expensesRequest = (user, path = "", options = {}) => storageRequest(user, "expenses", path, options);
const rulesRequest = (user, path = "", options = {}) => storageRequest(user, "expense_category_rules", path, options);
const reviewRequest = (user, path = "", options = {}) => storageRequest(user, "expense_review", path, options);
const totalsRequest = (user, start = "2040-02-01", end = "2040-03-01", extra = {}) =>
  storageRequest(user, "rpc/get_expense_category_totals", "", {
    method: "POST",
    body: JSON.stringify({ p_start_date: start, p_end_date: end, ...extra }),
  });

function expectStatus(result, expected, label) {
  if (result.status !== expected) {
    fail(`${label}: expected ${expected}, got ${result.status} ${JSON.stringify(result.body)}`);
  }
}

function expectEmpty(result, label) {
  if (!Array.isArray(result.body) || result.body.length !== 0) {
    fail(`${label}: expected no rows, got ${JSON.stringify(result.body)}`);
  }
}

async function verifyExpenseStorage(owner, other) {
  const ownerInsert = await expensesRequest(owner, "", { method: "POST", body: JSON.stringify([{}]) });
  expectStatus(ownerInsert, 201, "owner insert");
  const ownerExpense = ownerInsert.body?.[0];
  if (!ownerExpense?.id || ownerExpense.owner_id !== owner.id) {
    fail(`owner insert returned an invalid record: ${JSON.stringify(ownerInsert.body)}`);
  }
  if (
    ownerExpense.transaction_date !== null ||
    ownerExpense.amount !== null ||
    ownerExpense.title !== null ||
    ownerExpense.currency !== "PLN"
  ) {
    fail("legacy empty owner row did not preserve nullable transaction fields and PLN default");
  }

  const otherInsert = await expensesRequest(other, "", { method: "POST", body: JSON.stringify([{}]) });
  expectStatus(otherInsert, 201, "other insert");
  const otherExpense = otherInsert.body?.[0];
  if (!otherExpense?.id || otherExpense.owner_id !== other.id) {
    fail(`other insert returned an invalid record: ${JSON.stringify(otherInsert.body)}`);
  }

  const ownerRead = await expensesRequest(owner, "?select=id,owner_id");
  expectStatus(ownerRead, 200, "owner read");
  if (!ownerRead.body?.some((expense) => expense.id === ownerExpense.id)) {
    fail(`owner cannot read its record: ${JSON.stringify(ownerRead.body)}`);
  }

  const crossRead = await expensesRequest(other, `?id=eq.${ownerExpense.id}&select=id`);
  expectStatus(crossRead, 200, "cross-owner read");
  expectEmpty(crossRead, "cross-owner read");

  const foreignInsert = await expensesRequest(other, "", {
    method: "POST",
    body: JSON.stringify([{ owner_id: owner.id }]),
    headers: { Prefer: "return=minimal" },
  });
  if (foreignInsert.status < 400) {
    fail(`cross-owner insert was allowed: ${foreignInsert.status} ${JSON.stringify(foreignInsert.body)}`);
  }

  const ownerRecordsAfterForeignInsert = await expensesRequest(owner, "?select=id,owner_id");
  expectStatus(ownerRecordsAfterForeignInsert, 200, "owner read after cross-owner insert");
  if (ownerRecordsAfterForeignInsert.body?.length !== 1) {
    fail(`cross-owner insert created a foreign-owned record: ${JSON.stringify(ownerRecordsAfterForeignInsert.body)}`);
  }

  const crossUpdate = await expensesRequest(other, `?id=eq.${ownerExpense.id}`, {
    method: "PATCH",
    body: JSON.stringify({ owner_id: other.id }),
  });
  expectStatus(crossUpdate, 200, "cross-owner update");
  expectEmpty(crossUpdate, "cross-owner update");

  const crossDelete = await expensesRequest(other, `?id=eq.${ownerExpense.id}`, { method: "DELETE" });
  expectStatus(crossDelete, 200, "cross-owner delete");
  expectEmpty(crossDelete, "cross-owner delete");

  const ownerStillExists = await expensesRequest(owner, `?id=eq.${ownerExpense.id}&select=id,owner_id`);
  expectStatus(ownerStillExists, 200, "owner record after cross-owner attempts");
  if (ownerStillExists.body?.length !== 1 || ownerStillExists.body[0].owner_id !== owner.id) {
    fail(`cross-owner attempt changed owner record: ${JSON.stringify(ownerStillExists.body)}`);
  }

  const ownerUpdate = await expensesRequest(owner, `?id=eq.${ownerExpense.id}`, {
    method: "PATCH",
    body: JSON.stringify({ owner_id: owner.id }),
  });
  expectStatus(ownerUpdate, 200, "owner update");
  if (ownerUpdate.body?.length !== 1) {
    fail(`owner update did not affect its record: ${JSON.stringify(ownerUpdate.body)}`);
  }

  const transaction = { transaction_date: "2026-09-28", amount: "-123456789.12", title: "Synthetic payment" };
  const transactionInsert = await expensesRequest(owner, "", {
    method: "POST",
    body: JSON.stringify([transaction]),
  });
  expectStatus(transactionInsert, 201, "owner transaction insert");
  const savedTransaction = transactionInsert.body?.[0];
  if (
    !savedTransaction?.id ||
    savedTransaction.owner_id !== owner.id ||
    savedTransaction.transaction_date !== transaction.transaction_date ||
    Number(savedTransaction.amount) !== Number(transaction.amount) ||
    savedTransaction.title !== transaction.title ||
    savedTransaction.currency !== "PLN"
  ) {
    fail(`transaction fields or types were not preserved: ${JSON.stringify(transactionInsert.body)}`);
  }
  await expectReview(owner, savedTransaction, "other", "unmatched");

  const duplicate = await expensesRequest(owner, "", {
    method: "POST",
    body: JSON.stringify([transaction]),
  });
  expectStatus(duplicate, 409, "same-owner duplicate transaction");

  const otherOwnerSameTransaction = await expensesRequest(other, "", {
    method: "POST",
    body: JSON.stringify([transaction]),
  });
  expectStatus(otherOwnerSameTransaction, 201, "other owner may use same transaction key");
  const otherTransaction = otherOwnerSameTransaction.body?.[0];

  const maxTitleTransaction = { ...transaction, amount: "-1.00", title: "A".repeat(1024) };
  const maxTitleInsert = await expensesRequest(owner, "", {
    method: "POST",
    body: JSON.stringify([maxTitleTransaction]),
  });
  expectStatus(maxTitleInsert, 201, "1024-byte title insert");
  const maxTitleExpense = maxTitleInsert.body?.[0];
  if (!maxTitleExpense?.id || maxTitleExpense.title !== maxTitleTransaction.title) {
    fail("1024-byte title was not stored intact");
  }

  const overlongTitleInsert = await expensesRequest(owner, "", {
    method: "POST",
    body: JSON.stringify([{ ...transaction, amount: "-2.00", title: "A".repeat(1025) }]),
  });
  if (
    overlongTitleInsert.status !== 400 ||
    overlongTitleInsert.body?.code !== "23514" ||
    !overlongTitleInsert.body?.message?.includes("expenses_title_max_bytes")
  ) {
    fail(`1025-byte title did not violate the title constraint: ${JSON.stringify(overlongTitleInsert)}`);
  }

  for (const [label, invalid] of [
    ["positive amount", { ...transaction, amount: "1.00", title: "Positive amount" }],
    ["zero amount", { ...transaction, amount: "0.00", title: "Zero amount" }],
    ["blank title", { ...transaction, title: "   " }],
    ["non-PLN currency", { ...transaction, currency: "EUR", title: "Other currency" }],
    ["amount precision", { ...transaction, amount: "-10000000000.00", title: "Excess amount" }],
    ["invalid date", { ...transaction, transaction_date: "2026-02-30", title: "Bad date" }],
  ]) {
    const rejected = await expensesRequest(owner, "", {
      method: "POST",
      body: JSON.stringify([invalid]),
    });
    if (rejected.status < 400) fail(`${label} was accepted by the database`);
  }

  for (const [label, title] of [
    ["tab and newline title", "\t\n\r"],
    ["non-breaking space and BOM title", "\u00a0\ufeff"],
  ]) {
    const rejected = await expensesRequest(owner, "", {
      method: "POST",
      body: JSON.stringify([{ ...transaction, amount: "-3.00", title }]),
    });
    if (
      rejected.status !== 400 ||
      rejected.body?.code !== "23514" ||
      !rejected.body?.message?.includes("expenses_title_has_content")
    ) {
      fail(`${label} did not violate the title content constraint: ${JSON.stringify(rejected)}`);
    }
  }

  const ownerTransactions = await expensesRequest(owner, "?select=id,transaction_date,amount,title,currency");
  expectStatus(ownerTransactions, 200, "owner transaction read");
  if (ownerTransactions.body?.length !== 3) fail("duplicate or invalid insert changed owner row count");

  const otherCannotSeeTransaction = await expensesRequest(other, `?id=eq.${savedTransaction.id}&select=id`);
  expectStatus(otherCannotSeeTransaction, 200, "cross-owner transaction read");
  expectEmpty(otherCannotSeeTransaction, "cross-owner transaction read");

  const transactionDelete = await expensesRequest(owner, `?id=eq.${savedTransaction.id}`, { method: "DELETE" });
  expectStatus(transactionDelete, 200, "owner transaction cleanup");
  if (transactionDelete.body?.length !== 1) fail("owner transaction cleanup did not delete its record");

  const maxTitleDelete = await expensesRequest(owner, `?id=eq.${maxTitleExpense.id}`, { method: "DELETE" });
  expectStatus(maxTitleDelete, 200, "1024-byte title cleanup");
  if (maxTitleDelete.body?.length !== 1) fail("1024-byte title cleanup did not delete its record");

  const otherTransactionDelete = await expensesRequest(other, `?id=eq.${otherTransaction.id}`, { method: "DELETE" });
  expectStatus(otherTransactionDelete, 200, "other transaction cleanup");
  if (otherTransactionDelete.body?.length !== 1) fail("other transaction cleanup did not delete its record");

  const otherDelete = await expensesRequest(other, `?id=eq.${otherExpense.id}`, { method: "DELETE" });
  expectStatus(otherDelete, 200, "other owner delete");
  if (otherDelete.body?.length !== 1) {
    fail(`other owner could not delete its record: ${JSON.stringify(otherDelete.body)}`);
  }

  const ownerDelete = await expensesRequest(owner, `?id=eq.${ownerExpense.id}`, { method: "DELETE" });
  expectStatus(ownerDelete, 200, "owner cleanup");
  if (ownerDelete.body?.length !== 1) {
    fail(`owner cleanup did not delete its record: ${JSON.stringify(ownerDelete.body)}`);
  }

  console.log("PASS  expense storage enforces schema, uniqueness, and owner-only CRUD");
}

function expectEqual(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function expectDenied(result, label) {
  if (result.status < 400 || result.body?.code !== "42501") {
    fail(`${label}: expected a privilege/RLS denial, got ${JSON.stringify(result)}`);
  }
}

async function insertRule(user, keyword, categoryCode) {
  const result = await rulesRequest(user, "", {
    method: "POST",
    body: JSON.stringify([{ keyword, category_code: categoryCode }]),
  });
  expectStatus(result, 201, "rule insert");
  const rule = result.body?.[0];
  if (!rule?.id || rule.owner_id !== user.id || !rule.created_at || rule.keyword !== keyword) {
    fail(`rule insert did not preserve the keyword or session ownership: ${JSON.stringify(result)}`);
  }
  return rule;
}

async function deleteRule(user, rule) {
  const result = await rulesRequest(user, `?id=eq.${rule.id}`, { method: "DELETE" });
  expectStatus(result, 200, "owner rule delete");
  expectEqual(result.body?.length, 1, "owner rule delete count");
}

async function insertExpenseBatch(user, rows) {
  for (let offset = 0; offset < rows.length; offset += 500) {
    const result = await expensesRequest(user, "", {
      method: "POST",
      body: JSON.stringify(
        rows.slice(offset, offset + 500).map((row) => ({
          transaction_date: null,
          amount: null,
          title: null,
          ...row,
        })),
      ),
      headers: { Prefer: "return=minimal" },
    });
    expectStatus(result, 201, "expense batch insert");
  }
}

async function expectReview(user, expense, categoryCode, reason = null) {
  const result = await reviewRequest(user, `?id=eq.${expense.id}`);
  expectStatus(result, 200, "classified expense read");
  expectEqual(result.body?.length, 1, "classified expense count");
  const reviewed = result.body[0];
  expectEqual(
    {
      category_code: reviewed.category_code,
      needs_review: reviewed.needs_review,
      review_reason: reviewed.review_reason,
    },
    { category_code: categoryCode, needs_review: reason !== null, review_reason: reason },
    "classified expense state",
  );
  for (const field of ["id", "owner_id", "created_at", "transaction_date", "amount", "title", "currency"]) {
    expectEqual(reviewed[field], expense[field], `review preserves ${field}`);
  }
}

function emptyTotals() {
  return EXPENSE_CATEGORIES.map(({ code }) => ({
    category_code: code,
    total_cents: "0",
    expense_count: 0,
    needs_review_count: 0,
  }));
}

function expectedTotals(fixtures) {
  const totals = emptyTotals();
  for (const fixture of fixtures) {
    const total = totals.find((category) => category.category_code === fixture.category);
    // Fixture amounts have exactly two decimal places; use integer arithmetic in assertions too.
    total.total_cents = (BigInt(total.total_cents) + BigInt(fixture.amount.slice(1).replace(".", ""))).toString();
    total.expense_count += 1;
    total.needs_review_count += fixture.reason ? 1 : 0;
  }
  return totals;
}

async function verifyCategoryStorage(owner, other) {
  const catalogue = EXPENSE_CATEGORIES.map((category, index) => ({ ...category, sort_order: index + 1 }));
  for (const user of [owner, other]) {
    const result = await storageRequest(
      user,
      "expense_categories",
      "?select=code,label,sort_order&order=sort_order.asc",
    );
    expectStatus(result, 200, "authenticated catalogue read");
    expectEqual(result.body, catalogue, "persisted catalogue parity with TypeScript");
  }
  expectDenied(await storageRequest(null, "expense_categories"), "anonymous catalogue read");
  for (const [method, path, payload] of [
    ["POST", "", [catalogue[0]]],
    ["PATCH", "?code=eq.groceries", { label: "Groceries" }],
    ["DELETE", "?code=eq.storage_smoke_missing", undefined],
  ]) {
    expectDenied(
      await storageRequest(owner, "expense_categories", path, {
        method,
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      }),
      `authenticated catalogue ${method}`,
    );
  }

  for (const resource of ["expense_category_rules", "expense_review"]) {
    expectDenied(await storageRequest(null, resource), `anonymous ${resource} read`);
  }
  expectDenied(await totalsRequest(null), "anonymous category totals execution");
  expectDenied(
    await rulesRequest(null, "", {
      method: "POST",
      body: JSON.stringify([{ keyword: "anonymous", category_code: "other" }]),
    }),
    "anonymous rule insert",
  );

  const whitespace = String.fromCodePoint(
    9,
    10,
    11,
    12,
    13,
    32,
    0x85,
    0xa0,
    0x1680,
    0x2000,
    0x2001,
    0x2002,
    0x2003,
    0x2004,
    0x2005,
    0x2006,
    0x2007,
    0x2008,
    0x2009,
    0x200a,
    0x2028,
    0x2029,
    0x202f,
    0x205f,
    0x3000,
    0xfeff,
  );
  for (const space of whitespace) {
    const normalized = await storageRequest(owner, "rpc/normalize_expense_match_text", "", {
      method: "POST",
      body: JSON.stringify({ p_text: `${space}ŁÓDŹ${space}${space}CAFE\u0301${space}` }),
    });
    expectStatus(normalized, 200, "Unicode whitespace normalization");
    expectEqual(normalized.body, "łódź café", "NFC, Polish case and explicit whitespace normalization");
  }

  const longRule = await insertRule(owner, "\ufeff LEROY\t\tMERLIN\u00a0", "household");
  expectEqual(longRule.normalized_keyword, "leroy merlin", "database-generated normalized keyword");
  const otherRule = await insertRule(other, "leroy merlin", "shopping");

  const duplicate = await rulesRequest(owner, "", {
    method: "POST",
    body: JSON.stringify([{ keyword: "\u2003leroy\nmerlin\u3000", category_code: "health" }]),
  });
  expectStatus(duplicate, 409, "same-owner normalized duplicate rule");
  expectEqual(duplicate.body?.code, "23505", "duplicate rule unique constraint");

  expectDenied(
    await rulesRequest(other, "", {
      method: "POST",
      body: JSON.stringify([{ owner_id: owner.id, keyword: "foreign rule", category_code: "health" }]),
    }),
    "cross-owner rule insert",
  );
  expectDenied(
    await rulesRequest(owner, `?id=eq.${longRule.id}`, {
      method: "PATCH",
      body: JSON.stringify({ owner_id: other.id }),
    }),
    "rule ownership transfer",
  );
  for (const [method, body] of [
    ["GET", undefined],
    ["PATCH", { keyword: "foreign edit", category_code: "health" }],
    ["DELETE", undefined],
  ]) {
    const result = await rulesRequest(other, `?id=eq.${longRule.id}`, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    expectStatus(result, 200, `cross-owner rule ${method}`);
    expectEmpty(result, `cross-owner rule ${method}`);
  }
  const unchangedRule = await rulesRequest(owner, `?id=eq.${longRule.id}`);
  expectStatus(unchangedRule, 200, "owner rule after foreign attempts");
  expectEqual(unchangedRule.body, [longRule], "foreign attempts preserve owner rule");

  for (const method of ["PATCH", "DELETE"]) {
    expectDenied(
      await rulesRequest(null, `?id=eq.${longRule.id}`, {
        method,
        ...(method === "PATCH" ? { body: JSON.stringify({ keyword: longRule.keyword }) } : {}),
      }),
      `anonymous rule ${method}`,
    );
  }

  for (const [label, keyword] of [
    ["empty keyword", ""],
    ["Unicode whitespace-only keyword", whitespace],
    ["1025-byte keyword", "x".repeat(1025)],
    ["multibyte oversized keyword", "ł".repeat(513)],
    // U+023A lowercases to U+2C65: raw text fits, but its normalized UTF-8 key does not.
    ["normalized oversized keyword", "\u023a".repeat(512)],
    ["NUL keyword", "before\u0000after"],
  ]) {
    const result = await rulesRequest(owner, "", {
      method: "POST",
      body: JSON.stringify([{ keyword, category_code: "other" }]),
    });
    if (result.status < 400) fail(`${label} was accepted by the database`);
  }
  for (const keyword of ["x".repeat(1024), "ł".repeat(512)]) {
    const boundaryRule = await insertRule(owner, keyword, "other");
    expectEqual(boundaryRule.normalized_keyword, keyword, "1024 UTF-8 byte keyword retained");
    await deleteRule(owner, boundaryRule);
  }
  const generatedKey = await rulesRequest(owner, "", {
    method: "POST",
    body: JSON.stringify([{ keyword: "valid", normalized_keyword: "spoofed", category_code: "other" }]),
  });
  if (generatedKey.status < 400) fail("client-authored normalized keyword was accepted");
  const invalidCategory = await rulesRequest(owner, "", {
    method: "POST",
    body: JSON.stringify([{ keyword: "unknown category", category_code: "custom" }]),
  });
  expectStatus(invalidCategory, 409, "unknown category foreign key");
  expectEqual(invalidCategory.body?.code, "23503", "category foreign key enforcement");

  const concurrent = await Promise.all(
    [" Concurrent\tPhrase ", "concurrent phrase"].map((keyword) =>
      rulesRequest(owner, "", {
        method: "POST",
        body: JSON.stringify([{ keyword, category_code: "other" }]),
      }),
    ),
  );
  expectEqual(concurrent.map((result) => result.status).sort(), [201, 409], "concurrent normalized duplicate race");
  expectEqual(concurrent.find((result) => result.status === 409)?.body?.code, "23505", "concurrent unique constraint");

  const fixtures = [
    { title: "Unknown merchant", category: "other", reason: "unmatched" },
    { title: "PALIWA purchase", category: "transport" },
    { title: "ŁÓDŹ merchant", category: "leisure" },
    { title: "  LEROY\t\u00a0\u2009MERLIN receipt  ", category: "household" },
    { title: "CAFE\u0301 PAYMENT", category: "eating_out" },
    { title: "100% reward", category: "clothing" },
    { title: "100X reward", category: "other", reason: "unmatched" },
    { title: "a_b payment", category: "housing_bills" },
    { title: "axb payment", category: "other", reason: "unmatched" },
    { title: "path\\store payment", category: "household" },
    { title: "pathXstore payment", category: "other", reason: "unmatched" },
    { title: "STACJA KRAKOW", category: "other", reason: "ambiguous" },
    { title: "ALPHA OMEGA", category: "groceries" },
    { title: "DELIBERATE other", category: "other" },
    { title: "😀😀 abc", category: "health" },
    { title: "privatebank", category: "other", reason: "unmatched" },
    { title: "exact cents ten", category: "groceries", amount: "-0.10" },
    { title: "exact cents twenty", category: "groceries", amount: "-0.20" },
  ].map((fixture) => ({ amount: "-1.00", transaction_date: "2040-02-14", ...fixture }));
  const inserted = await expensesRequest(owner, "", {
    method: "POST",
    body: JSON.stringify(fixtures.map(({ title, amount, transaction_date }) => ({ title, amount, transaction_date }))),
  });
  expectStatus(inserted, 201, "classification expense fixtures");
  expectEqual(inserted.body?.length, fixtures.length, "classification fixture count");
  const saved = inserted.body;
  const byTitle = (title) => saved.find((expense) => expense.title === title);

  await expectReview(owner, byTitle("PALIWA purchase"), "other", "unmatched");
  await expectReview(owner, byTitle("DELIBERATE other"), "other", "unmatched");
  const shorterRule = await insertRule(owner, "MERLIN", "shopping");
  await insertRule(owner, "lodz", "health");
  await expectReview(owner, byTitle("ŁÓDŹ merchant"), "other", "unmatched");
  for (const [keyword, categoryCode] of [
    ["paliw", "transport"],
    ["łódź", "leisure"],
    ["café", "eating_out"],
    ["100%", "clothing"],
    ["a_b", "housing_bills"],
    ["path\\store", "household"],
    ["ALPHA", "groceries"],
    ["OMEGA", "groceries"],
    ["deliberate", "other"],
    ["😀😀", "shopping"],
    ["abc", "health"],
    ["exact cents", "groceries"],
  ]) {
    await insertRule(owner, keyword, categoryCode);
  }
  const canonicalDuplicate = await rulesRequest(owner, "", {
    method: "POST",
    body: JSON.stringify([{ keyword: "CAFE\u0301", category_code: "health" }]),
  });
  expectStatus(canonicalDuplicate, 409, "canonically equivalent duplicate rule");
  const stationRule = await insertRule(owner, "STACJA", "transport");
  const cityRule = await insertRule(owner, "KRAKOW", "shopping");
  await insertRule(other, "privatebank", "health");
  const otherExpenses = await expensesRequest(other, "", {
    method: "POST",
    body: JSON.stringify([
      { transaction_date: "2040-02-14", amount: "-90.00", title: "LEROY MERLIN receipt" },
      { transaction_date: "2040-02-14", amount: "-0.10", title: "privatebank" },
    ]),
  });
  expectStatus(otherExpenses, 201, "foreign owner classification fixtures");
  await expectReview(other, otherExpenses.body[0], "shopping");

  for (const fixture of fixtures) {
    await expectReview(owner, byTitle(fixture.title), fixture.category, fixture.reason ?? null);
  }
  const initialTotals = await totalsRequest(owner);
  expectStatus(initialTotals, 200, "initial classified totals");
  expectEqual(initialTotals.body, expectedTotals(fixtures), "view and totals share classifications");
  const foreignReview = await reviewRequest(other, `?id=eq.${saved[0].id}`);
  expectStatus(foreignReview, 200, "foreign expense review read");
  expectEmpty(foreignReview, "foreign expense review read");

  const edited = await rulesRequest(owner, `?id=eq.${longRule.id}`, {
    method: "PATCH",
    body: JSON.stringify({ category_code: "housing_bills" }),
  });
  expectStatus(edited, 200, "owner category edit");
  await expectReview(owner, byTitle(fixtures[3].title), "housing_bills");
  const editedTotals = await totalsRequest(owner);
  expectStatus(editedTotals, 200, "totals after category edit");
  expectEqual(
    editedTotals.body,
    expectedTotals(
      fixtures.map((fixture, index) => (index === 3 ? { ...fixture, category: "housing_bills" } : fixture)),
    ),
    "rule edits immediately recalculate aggregate categories",
  );
  const renamed = await rulesRequest(owner, `?id=eq.${longRule.id}`, {
    method: "PATCH",
    body: JSON.stringify({ keyword: " no longer matches " }),
  });
  expectStatus(renamed, 200, "owner keyword edit");
  expectEqual(renamed.body?.[0]?.normalized_keyword, "no longer matches", "edited generated keyword");
  await expectReview(owner, byTitle(fixtures[3].title), "shopping");
  await deleteRule(owner, longRule);
  await expectReview(owner, byTitle(fixtures[3].title), "shopping");
  await deleteRule(owner, shorterRule);
  await expectReview(owner, byTitle(fixtures[3].title), "other", "unmatched");
  const deletedTotals = await totalsRequest(owner);
  expectStatus(deletedTotals, 200, "totals after rule deletion");
  expectEqual(
    deletedTotals.body,
    expectedTotals(
      fixtures.map((fixture, index) =>
        index === 3 ? { ...fixture, category: "other", reason: "unmatched" } : fixture,
      ),
    ),
    "rule deletion immediately recalculates aggregate review counts",
  );
  await insertRule(owner, "MERLIN", "shopping");
  await insertRule(owner, "LEROY MERLIN", "household");
  await expectReview(owner, byTitle(fixtures[3].title), "household");
  await expectReview(other, otherExpenses.body[0], "shopping");
  const otherUnchangedRule = await rulesRequest(other, `?id=eq.${otherRule.id}`);
  expectStatus(otherUnchangedRule, 200, "independent other-owner keyword");
  expectEqual(otherUnchangedRule.body, [otherRule], "same keyword stays independent across owners");

  await deleteRule(owner, stationRule);
  await deleteRule(owner, cityRule);
  await insertRule(owner, "KRAKOW", "shopping");
  await insertRule(owner, "STACJA", "transport");
  await expectReview(owner, byTitle("STACJA KRAKOW"), "other", "ambiguous");

  const storedAfterRuleChanges = await expensesRequest(owner, "?select=*&order=id.asc");
  expectStatus(storedAfterRuleChanges, 200, "stored transactions after rule changes");
  expectEqual(
    storedAfterRuleChanges.body,
    [...saved].sort((first, second) => first.id.localeCompare(second.id)),
    "rule changes never rewrite transaction fields or timestamps",
  );
  const reviewMutation = await reviewRequest(owner, `?id=eq.${saved[0].id}`, {
    method: "PATCH",
    body: JSON.stringify({ title: saved[0].title }),
  });
  if (reviewMutation.status < 400) fail("review view accepted a mutation");

  await insertExpenseBatch(owner, [
    {},
    { transaction_date: "2040-02-14", amount: "-1.00" },
    { transaction_date: "2040-02-14", title: "Legacy missing amount" },
    { amount: "-1.00", title: "Legacy missing date" },
    { transaction_date: "2040-01-31", amount: "-99.00", title: "Previous period" },
    { transaction_date: "2040-03-01", amount: "-99.00", title: "Exclusive end" },
  ]);
  const incompleteReview = await reviewRequest(owner, "?or=(transaction_date.is.null,amount.is.null,title.is.null)");
  expectStatus(incompleteReview, 200, "incomplete legacy review");
  expectEmpty(incompleteReview, "incomplete legacy review");

  const batch = Array.from({ length: 1001 }, (_, index) => ({
    transaction_date: index === 0 ? "2040-02-01" : index === 1000 ? "2040-02-29" : "2040-02-14",
    amount: "-0.01",
    title: `Batch uncategorized ${index}`,
  }));
  await insertExpenseBatch(owner, batch);
  const cappedRead = await reviewRequest(
    owner,
    "?transaction_date=gte.2040-02-01&transaction_date=lt.2040-03-01&select=id",
  );
  expectStatus(cappedRead, 200, "capped Data API review read");
  expectEqual(cappedRead.body?.length, 1000, "Data API row cap fixture");
  const expected = expectedTotals([
    ...fixtures,
    ...batch.map((expense) => ({ ...expense, category: "other", reason: "unmatched" })),
  ]);
  const totals = await totalsRequest(owner);
  expectStatus(totals, 200, "complete period category totals");
  expectEqual(totals.body, expected, "uncapped exact integer-cent totals, boundaries and owner isolation");
  const foreignTotals = await totalsRequest(other);
  expectStatus(foreignTotals, 200, "other owner totals");
  expectEqual(
    foreignTotals.body,
    expectedTotals([
      { amount: "-90.00", category: "shopping" },
      { amount: "-0.10", category: "health" },
    ]),
    "other owner's totals contain only their expenses",
  );
  const empty = await totalsRequest(owner, "2050-01-01", "2050-02-01");
  expectStatus(empty, 200, "empty period totals");
  expectEqual(empty.body, emptyTotals(), "empty period has all ten zero rows");
  for (const [start, end] of [
    [null, "2040-03-01"],
    ["2040-02-01", null],
    ["2040-02-01", "2040-02-01"],
    ["2040-03-01", "2040-02-01"],
  ]) {
    const invalid = await totalsRequest(owner, start, end);
    expectStatus(invalid, 400, "invalid period bounds");
    expectEqual(invalid.body?.code, "22023", "invalid bounds SQL error");
  }
  const ownerArgument = await totalsRequest(owner, "2040-02-01", "2040-03-01", { p_owner_id: other.id });
  if (ownerArgument.status < 400) fail("totals accepted a caller-supplied owner argument");

  console.log(
    "PASS  persisted catalogue, rule privacy/uniqueness, Unicode/literal matching, recalculation and uncapped totals",
  );
}

async function clearFixtures(user) {
  const results = await Promise.allSettled(
    ["expense_category_rules", "expenses"].map((resource) =>
      storageRequest(user, resource, `?owner_id=eq.${user.id}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      }),
    ),
  );
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
    expectStatus(result.value, 204, "fixture-owned cleanup");
  }
}

async function inspectBenchmark(owner) {
  await clearFixtures(owner);
  const rules = Array.from({ length: 100 }, (_, index) => ({
    keyword: `benchmark merchant ${String(index).padStart(3, "0")}`,
    category_code: EXPENSE_CATEGORIES[index % EXPENSE_CATEGORIES.length].code,
  }));
  const insertedRules = await rulesRequest(owner, "", {
    method: "POST",
    body: JSON.stringify(rules),
    headers: { Prefer: "return=minimal" },
  });
  expectStatus(insertedRules, 201, "benchmark 100 rule insert");
  await insertExpenseBatch(
    owner,
    Array.from({ length: 10_000 }, (_, index) => ({
      transaction_date: "2041-07-15",
      amount: "-9999999999.99",
      title: `BENCHMARK MERCHANT ${String(index % 100).padStart(3, "0")} payment ${index}`,
    })),
  );
  const started = performance.now();
  const result = await totalsRequest(owner, "2041-07-01", "2041-08-01");
  const elapsed = performance.now() - started;
  expectStatus(result, 200, "benchmark totals");
  expectEqual(
    result.body,
    EXPENSE_CATEGORIES.map(({ code }) => ({
      category_code: code,
      total_cents: "999999999999000",
      expense_count: 1000,
      needs_review_count: 0,
    })),
    "10,000 expenses / 100 rules exact benchmark totals",
  );
  const totalCents = result.body.reduce((total, category) => total + BigInt(category.total_cents), 0n);
  expectEqual(totalCents.toString(), "9999999999990000", "benchmark aggregate above MAX_SAFE_INTEGER");

  // Explicit optional local mode: inspect the RPC's SELECT body so EXPLAIN exposes
  // matcher work (EXPLAIN of the PL/pgSQL call alone would show only Function Scan).
  if (!/^[0-9a-f-]{36}$/i.test(owner.id)) fail("benchmark owner is not a UUID");
  const query = `
    begin read only;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"${owner.id}","role":"authenticated"}';
    explain (analyze, buffers, format json)
    select category.code, trunc(coalesce(totals.cents, 0))::text,
      coalesce(totals.expense_count, 0), coalesce(totals.needs_review_count, 0)
    from public.expense_categories as category
    left join (
      select review.category_code, sum(-review.amount * 100) as cents,
        count(*) as expense_count,
        count(*) filter (where review.needs_review) as needs_review_count
      from public.expense_review as review
      where review.transaction_date >= date '2041-07-01'
        and review.transaction_date < date '2041-08-01'
      group by review.category_code
    ) as totals on totals.category_code = category.code
    order by category.sort_order;
    rollback;
  `;
  const explained = spawnSync(
    "docker",
    [
      "exec",
      "--interactive",
      benchmarkContainer,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: 60_000 },
  );
  if (explained.error || explained.status !== 0) {
    fail(`benchmark EXPLAIN failed: ${explained.error?.message ?? explained.stderr}`);
  }
  const plan = JSON.parse(explained.stdout);
  console.log(
    `BENCHMARK  10000 expenses / 100 rules: RPC ${elapsed.toFixed(1)} ms, SQL ${plan[0]["Execution Time"]} ms, 10 rows, 10000 expenses, ${totalCents} cents`,
  );
  console.log(JSON.stringify(plan, null, 2));
}

async function run() {
  const users = [];
  let cleanupFailure;
  try {
    const owner = await signUp("owner");
    users.push(owner);
    const other = await signUp("other");
    users.push(other);
    await verifyExpenseStorage(owner, other);
    await verifyCategoryStorage(owner, other);
    if (benchmark) await inspectBenchmark(owner);
  } finally {
    const cleanup = await Promise.allSettled(users.map(clearFixtures));
    cleanupFailure = cleanup.find((result) => result.status === "rejected");
  }
  if (cleanupFailure) throw cleanupFailure.reason;
}

run().catch((error) => {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
});
