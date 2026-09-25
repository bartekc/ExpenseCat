const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_KEY are required");
  process.exit(1);
}

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

async function expensesRequest(user, path = "", options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/expenses${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${user.accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...options.headers,
    },
  });
  return parseResponse(response);
}

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

async function run() {
  const owner = await signUp("owner");
  const other = await signUp("other");

  const ownerInsert = await expensesRequest(owner, "", { method: "POST", body: JSON.stringify([{}]) });
  expectStatus(ownerInsert, 201, "owner insert");
  const ownerExpense = ownerInsert.body?.[0];
  if (!ownerExpense?.id || ownerExpense.owner_id !== owner.id) {
    fail(`owner insert returned an invalid record: ${JSON.stringify(ownerInsert.body)}`);
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
  });
  if (foreignInsert.status < 400) {
    fail(`cross-owner insert was allowed: ${foreignInsert.status} ${JSON.stringify(foreignInsert.body)}`);
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

  console.log("PASS  expense storage enforces owner-only CRUD");
}

run().catch((error) => {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
});
