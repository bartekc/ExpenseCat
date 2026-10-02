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

async function request(session, path, { method = "GET", form, file, origin = ORIGIN } = {}) {
  const headers = { Cookie: session.cookies(), Origin: origin };
  let body;
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form).toString();
  }
  if (file !== undefined) {
    body = new globalThis.FormData();
    body.set("file", new globalThis.Blob([file], { type: "text/csv" }), "synthetic.csv");
  }

  const response = await fetch(BASE_URL + path, { method, redirect: "manual", headers, body });
  session.store(response);
  const isJson = response.headers.get("content-type")?.includes("application/json");
  return {
    status: response.status,
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
