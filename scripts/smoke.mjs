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
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    data: response.headers.get("content-type")?.includes("application/json") ? await response.json() : null,
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

  await signUpAndSignIn(owner, "owner");
  check("dashboard renders for signed-in user", await request(owner, "/dashboard"), { status: 200 });
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

  check(
    "wrong-header CSV rejected",
    await request(owner, "/api/expenses/import", {
      method: "POST",
      file: "Wrong;Kwota;Tytul\n2026-09-29;-1.00;Synthetic invalid file",
    }),
    { status: 400 },
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
