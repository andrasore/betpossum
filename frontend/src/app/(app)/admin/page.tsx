"use client";

import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  IconButton,
  Spinner,
  Table,
  Tabs,
  Text,
  TextField,
} from "@radix-ui/themes";
import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";
import type { Outcome } from "@/generated/events";
import {
  type AdminUserRow,
  fetchAdminUsers,
  fetchOdds,
  resolveAdminEvent,
  setAdminUserBalance,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { OddsEvent } from "@/types";

export default function AdminPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, roles } = useAuth();

  useEffect(() => {
    // Wait for the silent bootstrap to settle before deciding — a full-page
    // load lands here unauthenticated for a beat while the session restores.
    if (isLoading) {
      return;
    }
    if (!isAuthenticated || !roles.includes("admin")) {
      router.replace("/dashboard");
    }
  }, [isLoading, isAuthenticated, roles, router]);

  const isAdmin = isAuthenticated && roles.includes("admin");

  if (isLoading || !isAdmin) {
    return null;
  }

  return (
    <Box asChild flexGrow="1" p="6" style={{ overflowY: "auto" }}>
      <main>
        <Tabs.Root defaultValue="users">
          <Tabs.List>
            <Tabs.Trigger value="users">Users</Tabs.Trigger>
            <Tabs.Trigger value="events" data-testid="admin-events-tab">
              Events
            </Tabs.Trigger>
          </Tabs.List>
          <Box pt="4">
            <Tabs.Content value="users">
              <UsersPanel />
            </Tabs.Content>
            <Tabs.Content value="events">
              <EventsPanel />
            </Tabs.Content>
          </Box>
        </Tabs.Root>
      </main>
    </Box>
  );
}

function UsersPanel() {
  const {
    data: users,
    isLoading,
    mutate,
  } = useSWR<AdminUserRow[]>("admin-users", () => fetchAdminUsers(), {
    refreshInterval: 15_000,
  });

  return (
    <>
      <Heading as="h2" size="4" mb="4">
        Users
      </Heading>
      {isLoading && !users ? (
        <Spinner />
      ) : users && users.length > 0 ? (
        <Table.Root size="1" variant="surface">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>User ID</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Email</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">
                Bets
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">
                Balance (£)
              </Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {users.map((u) => (
              <UserRow key={u.id} user={u} onSaved={mutate} />
            ))}
          </Table.Body>
        </Table.Root>
      ) : (
        <Text size="2" color="gray">
          No users yet.
        </Text>
      )}
    </>
  );
}

function UserRow({
  user,
  onSaved,
}: {
  user: AdminUserRow;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<string>(user.balance.toFixed(2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(user.balance.toFixed(2));
  }, [user.balance]);

  const parsed = Number(draft);
  const dirty = draft.trim() !== user.balance.toFixed(2);
  const valid = Number.isFinite(parsed) && parsed >= 0;

  const confirm = async () => {
    if (!dirty || !valid) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setAdminUserBalance(user.id, parsed);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(user.balance.toFixed(2));
    setError(null);
  };

  return (
    <Table.Row>
      <Table.Cell>
        <Text
          as="span"
          size="1"
          color="gray"
          style={{ fontFamily: "var(--code-font-family)" }}
        >
          {user.id}
        </Text>
      </Table.Cell>
      <Table.Cell>
        {user.email ?? (
          <Text as="span" color="gray">
            —
          </Text>
        )}
      </Table.Cell>
      <Table.Cell>
        {user.name ?? (
          <Text as="span" color="gray">
            —
          </Text>
        )}
      </Table.Cell>
      <Table.Cell justify="end">{user.betCount}</Table.Cell>
      <Table.Cell justify="end">
        <Flex align="center" justify="end" gap="2">
          <TextField.Root
            size="1"
            type="number"
            step="0.01"
            min="0"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            style={{
              width: "120px",
              textAlign: "end",
              ...(dirty ? { boxShadow: "inset 0 0 0 1px var(--amber-9)" } : {}),
            }}
          />
          {dirty && (
            <>
              <IconButton
                aria-label="Confirm"
                size="1"
                color="green"
                onClick={confirm}
                disabled={!valid || saving}
                loading={saving}
              >
                <Check size={14} />
              </IconButton>
              <IconButton
                aria-label="Discard"
                size="1"
                variant="ghost"
                onClick={discard}
                disabled={saving}
              >
                <X size={14} />
              </IconButton>
            </>
          )}
        </Flex>
        {error && (
          <Text size="1" color="red" as="div" mt="1">
            {error}
          </Text>
        )}
      </Table.Cell>
    </Table.Row>
  );
}

function EventsPanel() {
  const {
    data: events,
    isLoading,
    mutate,
  } = useSWR<OddsEvent[]>("admin-events", () => fetchOdds(), {
    refreshInterval: 15_000,
  });

  return (
    <>
      <Heading as="h2" size="4" mb="4">
        Events
      </Heading>
      {isLoading && !events ? (
        <Spinner />
      ) : events && events.length > 0 ? (
        <Table.Root size="1" variant="surface">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Event</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Sport</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">
                Resolve
              </Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {events.map((e) => (
              <EventRow key={e.eventId} event={e} onSaved={mutate} />
            ))}
          </Table.Body>
        </Table.Root>
      ) : (
        <Text size="2" color="gray">
          No events yet.
        </Text>
      )}
    </>
  );
}

const outcomeLabel: Record<Outcome, string> = {
  home: "Home",
  away: "Away",
  draw: "Draw",
};

function EventRow({
  event,
  onSaved,
}: {
  event: OddsEvent;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolved = event.outcome ?? null;
  const supportsDraw = event.drawOdds > 0;

  const click = async (outcome: Outcome) => {
    setBusy(outcome);
    setError(null);
    try {
      await resolveAdminEvent(event.eventId, outcome);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Table.Row data-testid={`admin-event-row-${event.eventId}`}>
      <Table.Cell>
        <Text size="2" weight="medium">
          {event.homeTeam} vs {event.awayTeam}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text size="1" color="gray">
          {event.sport}
        </Text>
      </Table.Cell>
      <Table.Cell>
        {resolved ? (
          <Badge
            color="green"
            data-testid={`admin-event-status-${event.eventId}`}
          >
            Resolved ({outcomeLabel[resolved]})
          </Badge>
        ) : (
          <Badge
            color="yellow"
            data-testid={`admin-event-status-${event.eventId}`}
          >
            Held
          </Badge>
        )}
      </Table.Cell>
      <Table.Cell justify="end">
        <Flex direction="column" align="end" gap="1">
          <Flex gap="1">
            {(
              [
                "home",
                "away",
                ...(supportsDraw ? (["draw"] as const) : []),
              ] as Outcome[]
            ).map((o) => (
              <Button
                key={o}
                size="1"
                variant="outline"
                data-testid={`admin-event-resolve-${event.eventId}-${o}`}
                onClick={() => click(o)}
                disabled={
                  resolved !== null || busy !== null || event.origin !== "mock"
                }
                loading={busy === o}
                color={resolved === o ? "green" : undefined}
              >
                {outcomeLabel[o]}
              </Button>
            ))}
          </Flex>
          {error && (
            <Text size="1" color="red">
              {error}
            </Text>
          )}
        </Flex>
      </Table.Cell>
    </Table.Row>
  );
}
