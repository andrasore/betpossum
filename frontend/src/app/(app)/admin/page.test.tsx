import { Table } from "@radix-ui/themes";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUserRow } from "@/lib/api";
import { render, screen } from "@/test/render";

// The row calls the admin API on confirm; stub the module so no network is hit.
vi.mock("@/lib/api", () => ({ setAdminUserBalance: vi.fn() }));

import { setAdminUserBalance } from "@/lib/api";
import { UserRow } from "./page";

const user: AdminUserRow = {
  id: "u1",
  email: "ada@example.com",
  name: "Ada",
  betCount: 3,
  balanceCents: 10_000,
};

function renderRow(overrides: Partial<AdminUserRow> = {}) {
  return render(
    <Table.Root>
      <Table.Body>
        <UserRow user={{ ...user, ...overrides }} onSaved={() => {}} />
      </Table.Body>
    </Table.Root>,
  );
}

const field = () => screen.getByLabelText("Balance");

beforeEach(() => {
  vi.mocked(setAdminUserBalance).mockClear();
});

describe("admin UserRow balance field", () => {
  it("seeds the field from the stored cents", () => {
    renderRow();
    expect(field()).toHaveValue("100.00");
  });

  it("refuses more than two decimals as they are typed", async () => {
    renderRow();
    await userEvent.clear(field());
    await userEvent.type(field(), "0.333333");
    expect(field()).toHaveValue("0.33");
  });

  it("submits the amount as integer cents", async () => {
    renderRow();
    await userEvent.clear(field());
    await userEvent.type(field(), "12.34");
    await userEvent.click(screen.getByLabelText("Confirm"));

    expect(setAdminUserBalance).toHaveBeenCalledWith("u1", 1234);
  });

  it("treats a re-typed equal amount as no change", async () => {
    renderRow();
    // "100" and the stored "100.00" are the same money, so Confirm must not
    // offer to write it back.
    await userEvent.clear(field());
    await userEvent.type(field(), "100");
    expect(screen.getByLabelText("Confirm")).toBeDisabled();
  });

  it("keeps Discard reachable and blocks Confirm when the field is emptied", async () => {
    renderRow();
    await userEvent.clear(field());

    expect(screen.getByLabelText("Discard")).toBeEnabled();
    expect(screen.getByLabelText("Confirm")).toBeDisabled();
    expect(
      screen.getByText("Enter an amount in dollars and cents."),
    ).toBeInTheDocument();
  });

  it("restores the stored amount on discard", async () => {
    renderRow();
    await userEvent.clear(field());
    await userEvent.type(field(), "7.50");
    await userEvent.click(screen.getByLabelText("Discard"));

    expect(field()).toHaveValue("100.00");
    expect(setAdminUserBalance).not.toHaveBeenCalled();
  });
});
