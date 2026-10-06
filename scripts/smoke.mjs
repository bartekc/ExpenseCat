// Smoke test: exercise the built Cloudflare app against Supabase with synthetic data only.
const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const ORIGIN = new globalThis.URL(BASE_URL).origin;
const expectUnconfigured = process.env.EXPECT_UNCONFIGURED === "true";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const password = "Smoke-Test-Passw0rd!";

function createSession() {
  const jar = new Map();
  return {
    cookies: () => [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; "),
    store(response) {
      for (const raw of response.headers.getSetCookie()) {
        const [pair, ...attrs] = raw.split(";");
        const [name, ...rest] = pair.split("=");
        if (attrs.some((attr) => /max-age=0/i.test(attr.trim()))) jar.delete(name.trim());
        else jar.set(name.trim(), rest.join("="));
      }
    },
  };
}

const owner = createSession();
const other = createSession();
const anonymous = createSession();

async function request(
  session,
  path,
  { method = "GET", form, file, json, raw, contentType = "application/json", origin = ORIGIN } = {},
) {
  const headers = { Cookie: session.cookies() };
  if (origin !== null) headers.Origin = origin;
  let body;
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form).toString();
  }
  if (file !== undefined) {
    body = new globalThis.FormData();
    body.set("file", new globalThis.Blob([file], { type: "text/csv" }), "synthetic.csv");
  }
  if (json !== undefined || raw !== undefined) {
    headers["Content-Type"] = contentType;
    body = raw !== undefined ? raw : JSON.stringify(json);
  }

  const response = await fetch(BASE_URL + path, { method, redirect: "manual", headers, body });
  session.store(response);
  const isJson = response.headers.get("content-type")?.includes("application/json");
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    location: response.headers.get("location") ?? "",
    data: isJson ? await response.json() : null,
    html: isJson ? "" : await response.text(),
  };
}

function check(name, actual, expected) {
  const ok =
    actual.status === expected.status &&
    (expected.location === undefined || actual.location.startsWith(expected.location));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${actual.location}`);
  if (!ok) throw new Error(`${name}: expected ${expected.status} ${expected.location ?? ""}`);
  return actual;
}

function assert(name, condition) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) throw new Error(name);
}

const csvFile = (rows) => `Data_operacji;Kwota;Tytul\n${rows.join("\n")}`;
const rows = Array.from({ length: 52 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 8, 28 - index)).toISOString().slice(0, 10);
  return `${date};-${(index + 1).toFixed(2)};Synthetic item ${index + 1}`;
});
const mixedFile = csvFile([
  ...rows.slice().reverse(),
  "2026-09-28;4.00;Synthetic refund",
  "2026-02-30;-1.00;Synthetic bad date",
  rows[0],
]);

async function signUpAndSignIn(session, label) {
  const email =
    label === "owner" && process.env.SMOKE_EMAIL ? process.env.SMOKE_EMAIL : `smoke-${label}-${suffix}@example.com`;
  check(
    `${label} signup creates account`,
    await request(session, "/api/auth/signup", {
      method: "POST",
      form: { email, password },
    }),
    { status: 302, location: "/auth/confirm-email" },
  );
  if (label === "owner") {
    check(
      "signin rejects wrong password",
      await request(session, "/api/auth/signin", {
        method: "POST",
        form: { email, password: "wrong" },
      }),
      { status: 302, location: "/auth/signin?error=" },
    );
  }
  check(
    `${label} signin accepts correct password`,
    await request(session, "/api/auth/signin", {
      method: "POST",
      form: { email, password },
    }),
    { status: 302, location: "/" },
  );
  return email;
}

async function runMonthlyScenarios() {
  const monthlyOwner = createSession();
  const monthlyOther = createSession();
  const email = await signUpAndSignIn(monthlyOwner, "monthly");
  await signUpAndSignIn(monthlyOther, "monthly-other");
  const categories = [
    ["groceries", "Groceries"],
    ["eating_out", "Eating out"],
    ["transport", "Transport"],
    ["housing_bills", "Housing & bills"],
    ["household", "Household"],
    ["health", "Health"],
    ["clothing", "Clothing"],
    ["shopping", "Shopping"],
    ["leisure", "Leisure"],
    ["other", "Other"],
  ];
  const summary = async (session = monthlyOwner) => {
    const result = check("monthly summary loads", await request(session, "/api/expenses/summary"), { status: 200 });
    assert(
      "summary is uncached, private and has exact ordered catalogue totals",
      result.cacheControl === "no-store" &&
        result.data.currency === "PLN" &&
        result.data.period?.timeZone === "Europe/Warsaw" &&
        /^\d{4}-\d{2}$/.test(result.data.period.month) &&
        result.data.period.startDate === `${result.data.period.month}-01` &&
        result.data.categories.length === 10 &&
        result.data.categories.every(
          (category, index) =>
            category.code === categories[index][0] &&
            category.label === categories[index][1] &&
            /^(0|[1-9]\d*)$/.test(category.totalCents) &&
            Number.isSafeInteger(category.expenseCount) &&
            Number.isSafeInteger(category.needsReviewCount) &&
            category.needsReviewCount <= category.expenseCount,
        ) &&
        result.data.categories.reduce((sum, category) => sum + BigInt(category.totalCents), 0n).toString() ===
          result.data.totalCents &&
        result.data.categories.reduce((sum, category) => sum + category.expenseCount, 0) === result.data.expenseCount &&
        result.data.categories.reduce((sum, category) => sum + category.needsReviewCount, 0) ===
          result.data.needsReviewCount &&
        !JSON.stringify(result.data).includes("owner_id"),
    );
    return result.data;
  };
  const list = async (session = monthlyOwner, page = 1) => {
    const result = check(
      "private category rule page loads",
      await request(session, `/api/category-rules?page=${page}`),
      { status: 200 },
    );
    assert(
      "rule page exposes only public fields and all ten categories",
      result.cacheControl === "no-store" &&
        result.data.pageSize === 50 &&
        result.data.categories.length === 10 &&
        result.data.rules.every((rule) => Object.keys(rule).sort().join(",") === "category_code,id,keyword"),
    );
    return result.data;
  };
  const add = async (keyword, category_code, session = monthlyOwner) => {
    const result = check(
      "category rule created",
      await request(session, "/api/category-rules", {
        method: "POST",
        json: { keyword, category_code },
      }),
      { status: 201 },
    );
    assert(
      "rule mutation is no-store and keeps raw keyword",
      result.cacheControl === "no-store" && result.data.keyword === keyword,
    );
    return result.data;
  };
  const change = async (rule, keyword, category_code) =>
    check(
      "category rule updated",
      await request(monthlyOwner, `/api/category-rules/${rule.id}`, {
        method: "PATCH",
        json: { keyword, category_code },
      }),
      { status: 200 },
    ).data;
  const remove = async (rule) => {
    const result = check(
      "category rule deleted",
      await request(monthlyOwner, `/api/category-rules/${rule.id}`, { method: "DELETE" }),
      { status: 204 },
    );
    assert("delete is uncached with no response body", result.cacheControl === "no-store" && result.html === "");
  };

  const zero = await summary();
  assert(
    "empty current month has ten zero rows",
    zero.totalCents === "0" &&
      zero.expenseCount === 0 &&
      zero.needsReviewCount === 0 &&
      zero.categories.every((category) => category.totalCents === "0" && category.expenseCount === 0),
  );
  assert("new owner has no pre-seeded rules", (await list()).total === 0);
  const start = zero.period.startDate;
  const last = new Date(new Date(`${zero.period.endDateExclusive}T12:00:00Z`).getTime() - 86400000)
    .toISOString()
    .slice(0, 10);
  const prior = new Date(new Date(`${start}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
  const currentRows = Array.from(
    { length: 60 },
    (_, index) => `${index === 0 ? start : last};-1.00;Synthetic STACJA KRAKOW ${index}`,
  );
  const currentFile = csvFile([
    ...currentRows,
    `${start};-2.00;Synthetic EXPLICIT`,
    `${last};-3.00;Synthetic unmatched`,
    `${prior};-4.00;Synthetic STACJA KRAKOW prior`,
    `${zero.period.endDateExclusive};-5.00;Synthetic STACJA KRAKOW future`,
  ]);
  const imported = check(
    "dynamic current/prior/next-month CSV imports",
    await request(monthlyOwner, "/api/expenses/import", { method: "POST", file: currentFile }),
    { status: 200 },
  );
  assert("all-date synthetic fixtures saved", imported.data.imported === 64);
  const allOther = await summary();
  assert(
    "full current month exceeds a review page and excludes adjacent months",
    allOther.totalCents === "6500" &&
      allOther.expenseCount === 62 &&
      allOther.needsReviewCount === 62 &&
      allOther.categories[9].totalCents === "6500",
  );
  const review = check("categorized all-date review loads", await request(monthlyOwner, "/api/expenses?page=1"), {
    status: 200,
  });
  assert(
    "review keeps all dates and new classification fields private",
    review.data.total === 64 &&
      review.data.expenses.length === 50 &&
      review.data.expenses.every(
        (row) =>
          row.category_code === "other" &&
          row.needs_review &&
          row.review_reason === "unmatched" &&
          !Object.hasOwn(row, "owner_id"),
      ),
  );
  assert(
    "all-date next page remains reachable",
    check("categorized review page two loads", await request(monthlyOwner, "/api/expenses?page=2"), { status: 200 })
      .data.expenses.length === 14,
  );

  const stacja = await add("STACJA", "transport");
  const transport = await summary();
  assert(
    "rule creation recalculates old imported rows",
    transport.categories[2].totalCents === "6000" && transport.needsReviewCount === 2,
  );
  const duplicate = check(
    "normalized duplicate rejected",
    await request(monthlyOwner, "/api/category-rules", {
      method: "POST",
      json: { keyword: " \tstacja\u00a0", category_code: "shopping" },
    }),
    { status: 409 },
  );
  assert("duplicate directs editing the existing rule", duplicate.data.error.includes("Edit the existing rule"));
  const krakow = await add("KRAKOW", "shopping");
  const ambiguous = await summary();
  assert(
    "cross-category longest ties become Other needing review",
    ambiguous.categories[9].totalCents === "6500" && ambiguous.needsReviewCount === 62,
  );
  const conflictedReview = check(
    "ambiguous categorized review loads",
    await request(monthlyOwner, "/api/expenses?page=1"),
    { status: 200 },
  );
  assert(
    "ambiguity reason is public",
    conflictedReview.data.expenses.some((row) => row.review_reason === "ambiguous"),
  );
  await change(krakow, "KRAKOW", "transport");
  assert("same-category longest ties resolve", (await summary()).categories[2].totalCents === "6000");
  const longest = await add("STACJA KRAKOW", "household");
  assert("longer matching phrase wins on existing data", (await summary()).categories[4].totalCents === "6000");
  const explicit = await add("EXPLICIT", "other");
  const explicitSummary = await summary();
  assert(
    "deliberate Other differs from unmatched Other",
    explicitSummary.categories[9].totalCents === "500" && explicitSummary.needsReviewCount === 1,
  );
  const explicitPage = check("explicit Other review page loads", await request(monthlyOwner, "/api/expenses?page=2"), {
    status: 200,
  });
  assert(
    "explicit Other has no review flag",
    explicitPage.data.expenses.some(
      (row) =>
        row.title === "Synthetic EXPLICIT" &&
        row.category_code === "other" &&
        !row.needs_review &&
        row.review_reason === null,
    ),
  );
  const repeated = check(
    "re-import with rules still skips duplicates",
    await request(monthlyOwner, "/api/expenses/import", { method: "POST", file: currentFile }),
    { status: 200 },
  );
  assert(
    "re-import never rewrites transactions or classification rules",
    repeated.data.imported === 0 &&
      repeated.data.duplicates === 64 &&
      (await list()).total === 4 &&
      (await summary()).totalCents === "6500",
  );

  check(
    "foreign rule PATCH is indistinguishable from missing",
    await request(monthlyOther, `/api/category-rules/${stacja.id}`, {
      method: "PATCH",
      json: { keyword: "STACJA", category_code: "shopping" },
    }),
    { status: 404 },
  );
  check(
    "foreign rule DELETE is indistinguishable from missing",
    await request(monthlyOther, `/api/category-rules/${stacja.id}`, { method: "DELETE" }),
    { status: 404 },
  );
  check(
    "missing rule DELETE returns 404",
    await request(monthlyOwner, "/api/category-rules/00000000-0000-0000-0000-000000000001", { method: "DELETE" }),
    { status: 404 },
  );
  assert(
    "other owner cannot see private rules or totals",
    (await list(monthlyOther)).total === 0 && (await summary(monthlyOther)).expenseCount === 0,
  );
  await add("STACJA", "shopping", monthlyOther);
  assert("same keyword is independent for another owner", (await summary()).categories[4].totalCents === "6000");

  for (const method of ["POST", "PATCH", "DELETE"]) {
    const path = method === "POST" ? "/api/category-rules" : `/api/category-rules/${stacja.id}`;
    const body = method === "DELETE" ? {} : { json: { keyword: "STACJA", category_code: "transport" } };
    check(`anonymous rule ${method} denied`, await request(anonymous, path, { method, ...body }), { status: 401 });
    check(
      `cross-origin rule ${method} denied`,
      await request(monthlyOwner, path, { method, origin: "https://other.example", ...body }),
      { status: 403 },
    );
    check(
      `missing-Origin rule ${method} denied`,
      await request(monthlyOwner, path, { method, origin: null, ...body }),
      { status: 403 },
    );
  }
  check(
    "malformed rule ID rejected",
    await request(monthlyOwner, "/api/category-rules/not-a-uuid", {
      method: "PATCH",
      json: { keyword: "x", category_code: "other" },
    }),
    { status: 400 },
  );
  check(
    "DELETE payload rejected",
    await request(monthlyOwner, `/api/category-rules/${stacja.id}`, { method: "DELETE", json: { owner_id: "x" } }),
    { status: 400 },
  );
  for (const method of ["POST", "PATCH"]) {
    const path = method === "POST" ? "/api/category-rules" : `/api/category-rules/${stacja.id}`;
    for (const json of [
      { keyword: " ", category_code: "other" },
      { keyword: "x", category_code: "custom" },
      { keyword: "x", category_code: "other", owner_id: "x" },
      { keyword: "ż".repeat(513), category_code: "other" },
      { keyword: "Ⱥ".repeat(512), category_code: "other" },
      { keyword: "x\u0000", category_code: "other" },
    ]) {
      check(`invalid ${method} rule input rejected`, await request(monthlyOwner, path, { method, json }), {
        status: 400,
      });
    }
    check(`malformed ${method} JSON rejected`, await request(monthlyOwner, path, { method, raw: "{" }), {
      status: 400,
    });
    check(
      `non-JSON ${method} body rejected`,
      await request(monthlyOwner, path, { method, raw: "{}", contentType: "text/plain" }),
      { status: 400 },
    );
    check(
      `oversized ${method} rule body rejected`,
      await request(monthlyOwner, path, { method, raw: "x".repeat(16385) }),
      { status: 413 },
    );
  }
  check("summary filters rejected", await request(monthlyOwner, "/api/expenses/summary?month=2020-01"), {
    status: 400,
  });
  for (const page of ["0", "01", "42949673", "9007199254740992"]) {
    check("invalid rule page rejected", await request(monthlyOwner, `/api/category-rules?page=${page}`), {
      status: 400,
    });
    check("invalid expense page rejected", await request(monthlyOwner, `/api/expenses?page=${page}`), { status: 400 });
  }

  const races = await Promise.all(
    ["RACE", " \trace\u00a0"].map((keyword) =>
      request(monthlyOwner, "/api/category-rules", { method: "POST", json: { keyword, category_code: "other" } }),
    ),
  );
  assert(
    "concurrent normalized duplicate has exactly one winner",
    races
      .map((result) => result.status)
      .sort()
      .join(",") === "201,409",
  );
  await remove(races.find((result) => result.status === 201).data);
  await remove(longest);
  assert("deleting longest rule falls back to shorter rules", (await summary()).categories[2].totalCents === "6000");
  await remove(krakow);
  await remove(stacja);
  assert("deleting matching rules recalculates all records", (await summary()).needsReviewCount === 61);

  for (let index = 0; index < 51; index++) await add(`ZZZ page ${String(index).padStart(2, "0")}`, "other");
  const rulePageOne = await list();
  const rulePageTwo = await list(monthlyOwner, 2);
  const allRules = [...rulePageOne.rules, ...rulePageTwo.rules];
  assert(
    "rule pagination reaches every saved rule in normalized order",
    rulePageOne.total === 52 &&
      rulePageOne.totalPages === 2 &&
      rulePageOne.rules.length === 50 &&
      rulePageTwo.rules.length === 2 &&
      allRules[0].id === explicit.id &&
      allRules.slice(1).every((rule, index) => rule.keyword === `ZZZ page ${String(index).padStart(2, "0")}`),
  );
  assert("out-of-range rule page is an empty page", (await list(monthlyOwner, 3)).rules.length === 0);
  check("monthly owner signs out", await request(monthlyOwner, "/api/auth/signout", { method: "POST" }), {
    status: 302,
    location: "/",
  });
  check("summary denied after signout", await request(monthlyOwner, "/api/expenses/summary"), { status: 401 });
  check(
    "monthly owner signs back in",
    await request(monthlyOwner, "/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/" },
  );
  assert(
    "private rules and live classification persist across sessions",
    (await list()).total === 52 && (await summary()).needsReviewCount === 61,
  );
}

async function run() {
  check("home renders", await request(anonymous, "/"), { status: 200 });
  check("dashboard redirects anonymous user", await request(anonymous, "/dashboard"), {
    status: 302,
    location: "/auth/signin",
  });
  check(
    "anonymous import denied",
    await request(anonymous, "/api/expenses/import", {
      method: "POST",
      file: mixedFile,
    }),
    { status: 401 },
  );
  check("anonymous review denied", await request(anonymous, "/api/expenses?page=1"), { status: 401 });
  check("anonymous rules denied", await request(anonymous, "/api/category-rules"), { status: 401 });
  check("anonymous monthly summary denied", await request(anonymous, "/api/expenses/summary"), { status: 401 });

  if (expectUnconfigured) {
    check(
      "signup reports missing Supabase runtime secrets",
      await request(anonymous, "/api/auth/signup", {
        method: "POST",
        form: { email: `smoke-${suffix}@example.com`, password },
      }),
      { status: 302, location: "/auth/signup?error=Supabase%20is%20not%20configured" },
    );
    return;
  }

  const ownerEmail = await signUpAndSignIn(owner, "owner");
  const dashboard = check("dashboard renders for signed-in user", await request(owner, "/dashboard"), {
    status: 200,
  });
  assert(
    "dashboard exposes labeled CSV import, review state, and account controls",
    dashboard.html.includes(ownerEmail) &&
      dashboard.html.includes('id="expense-csv"') &&
      dashboard.html.includes('type="file"') &&
      dashboard.html.includes("Import expenses") &&
      dashboard.html.includes("Saved expenses") &&
      dashboard.html.includes("Loading expenses") &&
      dashboard.html.includes("Sign out"),
  );
  assert(
    "dashboard exposes rule and summary landmarks with independent SSR loading states",
    dashboard.html.includes('aria-labelledby="category-rules-heading"') &&
      dashboard.html.includes('id="rule-keyword"') &&
      dashboard.html.includes('id="rule-category"') &&
      dashboard.html.includes("Loading category rules") &&
      dashboard.html.includes('aria-labelledby="monthly-summary-heading"') &&
      dashboard.html.includes("Loading monthly summary") &&
      dashboard.html.includes("Europe/Warsaw") &&
      dashboard.html.includes("All dates"),
  );
  const initiallyEmpty = check("new account review loads empty", await request(owner, "/api/expenses?page=1"), {
    status: 200,
  });
  assert(
    "new account has an empty review page",
    initiallyEmpty.data?.total === 0 &&
      initiallyEmpty.data.expenses?.length === 0 &&
      initiallyEmpty.data.totalPages === 0,
  );

  const oversizedFile = check(
    "oversized CSV file rejected",
    await request(owner, "/api/expenses/import", {
      method: "POST",
      file: "x".repeat(2 * 1024 * 1024 + 1),
    }),
    { status: 413 },
  );
  assert("oversized file has a clear error", oversizedFile.data?.error === "CSV file exceeds 2 MiB");

  let chunksSent = 0;
  const oversizedStreamResponse = await fetch(BASE_URL + "/api/expenses/import", {
    method: "POST",
    redirect: "manual",
    headers: {
      Cookie: owner.cookies(),
      Origin: ORIGIN,
      "Content-Type": "multipart/form-data; boundary=synthetic",
    },
    body: new globalThis.ReadableStream({
      pull(controller) {
        if (chunksSent++ < 33) controller.enqueue(new Uint8Array(64 * 1024));
        else controller.close();
      },
    }),
    duplex: "half",
  });
  check(
    "oversized streamed multipart body rejected",
    { status: oversizedStreamResponse.status, location: oversizedStreamResponse.headers.get("location") ?? "" },
    { status: 413 },
  );
  assert(
    "streamed upload has a clear error",
    (await oversizedStreamResponse.json()).error === "CSV upload exceeds allowed size",
  );
  const afterOversized = check("review after oversized uploads loads", await request(owner, "/api/expenses?page=1"), {
    status: 200,
  });
  assert("oversized uploads made no writes", afterOversized.data?.total === 0);

  check(
    "cross-origin import denied",
    await request(owner, "/api/expenses/import", {
      method: "POST",
      file: mixedFile,
      origin: "https://other.example",
    }),
    { status: 403 },
  );

  const first = check(
    "mixed CSV imports",
    await request(owner, "/api/expenses/import", {
      method: "POST",
      file: mixedFile,
    }),
    { status: 200 },
  );
  assert(
    "mixed CSV reports all result types",
    first.data?.imported === 52 &&
      first.data.duplicates === 1 &&
      first.data.nonExpense === 1 &&
      first.data.invalid === 1 &&
      first.data.invalidRows?.[0]?.row === 55 &&
      first.data.invalidRows?.[0]?.reason === "Invalid transaction date" &&
      first.data.detailsTruncated === false,
  );

  const repeat = check(
    "repeat import succeeds",
    await request(owner, "/api/expenses/import", {
      method: "POST",
      file: mixedFile,
    }),
    { status: 200 },
  );
  assert("repeat import counts existing rows", repeat.data?.imported === 0 && repeat.data.duplicates === 53);

  const firstPage = check("review page one loads", await request(owner, "/api/expenses?page=1"), { status: 200 });
  assert(
    "review page one is complete and newest first",
    firstPage.data?.page === 1 &&
      firstPage.data.pageSize === 50 &&
      firstPage.data.total === 52 &&
      firstPage.data.totalPages === 2 &&
      firstPage.data.expenses?.length === 50 &&
      firstPage.data.expenses[0]?.transaction_date === "2026-09-28" &&
      firstPage.data.expenses.every(
        (row, index, all) =>
          row.id &&
          row.transaction_date &&
          row.amount &&
          row.title &&
          row.currency === "PLN" &&
          (index === 0 || all[index - 1].transaction_date >= row.transaction_date),
      ),
  );
  const secondPage = check("review page two loads", await request(owner, "/api/expenses?page=2"), { status: 200 });
  assert("review reaches remaining records", secondPage.data?.expenses?.length === 2);

  const wrongHeader = check(
    "wrong-header CSV rejected",
    await request(owner, "/api/expenses/import", {
      method: "POST",
      file: "Wrong;Kwota;Tytul\n2026-09-29;-1.00;Synthetic invalid file",
    }),
    { status: 400 },
  );
  assert(
    "file-level error is separate from row skips",
    wrongHeader.data?.error === "CSV header must be Data_operacji;Kwota;Tytul" &&
      wrongHeader.data?.invalidRows === undefined,
  );
  const afterInvalid = check("review after invalid file loads", await request(owner, "/api/expenses?page=1"), {
    status: 200,
  });
  assert("invalid file made no writes", afterInvalid.data?.total === firstPage.data.total);

  const tie = check(
    "later same-date import succeeds",
    await request(owner, "/api/expenses/import", {
      method: "POST",
      file: csvFile(["2026-09-28;-99.00;Synthetic later item"]),
    }),
    { status: 200 },
  );
  assert("same-date item is new", tie.data?.imported === 1);
  const sorted = check("tie-break review loads", await request(owner, "/api/expenses?page=1"), { status: 200 });
  assert("later same-date item appears first", sorted.data?.expenses?.[0]?.title === "Synthetic later item");

  await signUpAndSignIn(other, "other");
  const empty = check("other user review loads", await request(other, "/api/expenses?page=1"), { status: 200 });
  assert("other user cannot see owner rows", empty.data?.total === 0 && empty.data.expenses?.length === 0);
  const otherImport = check(
    "other user imports same CSV",
    await request(other, "/api/expenses/import", {
      method: "POST",
      file: mixedFile,
    }),
    { status: 200 },
  );
  assert("duplicate keys are owner-scoped", otherImport.data?.imported === 52 && otherImport.data.duplicates === 1);
  const ownerRead = check("owner review remains isolated", await request(owner, "/api/expenses?page=1"), {
    status: 200,
  });
  assert("other import did not change owner count", ownerRead.data?.total === 53);

  const titleLimitImport = check(
    "CSV with overlong and valid titles imports",
    await request(owner, "/api/expenses/import", {
      method: "POST",
      file: csvFile([`2026-10-01;-1.00;${"ż".repeat(513)}`, "2026-10-02;-2.00;Synthetic title limit survivor"]),
    }),
    { status: 200 },
  );
  assert(
    "overlong title is skipped while valid row imports",
    titleLimitImport.data?.imported === 1 &&
      titleLimitImport.data.invalid === 1 &&
      titleLimitImport.data.invalidRows?.[0]?.row === 2 &&
      titleLimitImport.data.invalidRows?.[0]?.reason === "Title exceeds 1024 UTF-8 bytes",
  );
  const afterTitleLimit = check("review after title limit import loads", await request(owner, "/api/expenses?page=1"), {
    status: 200,
  });
  assert(
    "valid title was saved and overlong title made no write",
    afterTitleLimit.data?.total === 54 &&
      afterTitleLimit.data.expenses?.[0]?.title === "Synthetic title limit survivor",
  );

  await runMonthlyScenarios();

  check("signout clears session", await request(owner, "/api/auth/signout", { method: "POST" }), {
    status: 302,
    location: "/",
  });
  check("dashboard redirects after signout", await request(owner, "/dashboard"), {
    status: 302,
    location: "/auth/signin",
  });
}

run()
  .then(() => console.log("\nAll smoke steps passed"))
  .catch((error) => {
    console.error(`\nFAIL  ${error.message}`);
    process.exitCode = 1;
  });
