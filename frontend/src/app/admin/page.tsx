"use client";

import {
  Badge,
  Box,
  Button,
  ButtonGroup,
  Flex,
  Heading,
  IconButton,
  Input,
  Spinner,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { Navbar } from "@/components/Navbar";
import {
  type AdminUserRow,
  fetchAdminUsers,
  fetchOdds,
  resolveAdminEvent,
  setAdminUserBalance,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Outcome } from "@/lib/schemas";
import type { OddsEvent } from "@/types";

export default function AdminPage() {
  const router = useRouter();
  const { isAuthenticated, roles } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!roles.includes("admin")) router.replace("/dashboard");
  }, [isAuthenticated, roles, router]);

  const isAdmin = isAuthenticated && roles.includes("admin");

  if (!isAdmin) return null;

  return (
    <Flex
      direction="column"
      h="100vh"
      data-theme="light"
      bg="white"
      color="gray.900"
    >
      <Navbar />
      <Box as="main" flex="1" overflowY="auto" p={6}>
        <Tabs.Root defaultValue="users" variant="line">
          <Tabs.List>
            <Tabs.Trigger value="users">Users</Tabs.Trigger>
            <Tabs.Trigger value="events" data-testid="admin-events-tab">
              Events
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="users">
            <UsersPanel />
          </Tabs.Content>
          <Tabs.Content value="events">
            <EventsPanel />
          </Tabs.Content>
        </Tabs.Root>
      </Box>
    </Flex>
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
      <Heading as="h2" size="md" mb={4}>
        Users
      </Heading>
      {isLoading && !users ? (
        <Spinner />
      ) : users && users.length > 0 ? (
        <Table.Root size="sm" variant="line">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>User ID</Table.ColumnHeader>
              <Table.ColumnHeader>Email</Table.ColumnHeader>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Bets</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">
                Balance (£)
              </Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {users.map((u) => (
              <UserRow key={u.id} user={u} onSaved={mutate} />
            ))}
          </Table.Body>
        </Table.Root>
      ) : (
        <Text fontSize="sm" color="fg.muted">
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
    if (!dirty || !valid) return;
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
        <Text as="span" fontFamily="mono" fontSize="xs" color="fg.muted">
          {user.id}
        </Text>
      </Table.Cell>
      <Table.Cell>
        {user.email ?? (
          <Text as="span" color="fg.muted">
            —
          </Text>
        )}
      </Table.Cell>
      <Table.Cell>
        {user.name ?? (
          <Text as="span" color="fg.muted">
            —
          </Text>
        )}
      </Table.Cell>
      <Table.Cell textAlign="end">{user.betCount}</Table.Cell>
      <Table.Cell textAlign="end">
        <Flex align="center" justify="flex-end" gap={2}>
          <Input
            size="xs"
            type="number"
            step="0.01"
            min="0"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            width="120px"
            textAlign="end"
            disabled={saving}
            borderColor={dirty ? "yellow.500" : undefined}
          />
          {dirty && (
            <>
              <IconButton
                aria-label="Confirm"
                size="xs"
                colorPalette="green"
                onClick={confirm}
                disabled={!valid || saving}
                loading={saving}
              >
                <Check size={14} />
              </IconButton>
              <IconButton
                aria-label="Discard"
                size="xs"
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
          <Text fontSize="xs" color="red.500" mt={1}>
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
      <Heading as="h2" size="md" mb={4}>
        Events
      </Heading>
      {isLoading && !events ? (
        <Spinner />
      ) : events && events.length > 0 ? (
        <Table.Root size="sm" variant="line">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Event</Table.ColumnHeader>
              <Table.ColumnHeader>Sport</Table.ColumnHeader>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Resolve</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {events.map((e) => (
              <EventRow key={e.eventId} event={e} onSaved={mutate} />
            ))}
          </Table.Body>
        </Table.Root>
      ) : (
        <Text fontSize="sm" color="fg.muted">
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
        <Text fontSize="sm" fontWeight="medium">
          {event.homeTeam} vs {event.awayTeam}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="xs" color="fg.muted">
          {event.sport}
        </Text>
      </Table.Cell>
      <Table.Cell>
        {resolved ? (
          <Badge
            colorPalette="green"
            data-testid={`admin-event-status-${event.eventId}`}
          >
            Resolved ({outcomeLabel[resolved]})
          </Badge>
        ) : (
          <Badge
            colorPalette="yellow"
            data-testid={`admin-event-status-${event.eventId}`}
          >
            Held
          </Badge>
        )}
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Flex direction="column" align="flex-end" gap={1}>
          <ButtonGroup size="xs" attached variant="outline">
            {(
              [
                "home",
                "away",
                ...(supportsDraw ? (["draw"] as const) : []),
              ] as Outcome[]
            ).map((o) => (
              <Button
                key={o}
                data-testid={`admin-event-resolve-${event.eventId}-${o}`}
                onClick={() => click(o)}
                disabled={resolved !== null || busy !== null}
                loading={busy === o}
                colorPalette={resolved === o ? "green" : undefined}
              >
                {outcomeLabel[o]}
              </Button>
            ))}
          </ButtonGroup>
          {error && (
            <Text fontSize="xs" color="red.500">
              {error}
            </Text>
          )}
        </Flex>
      </Table.Cell>
    </Table.Row>
  );
}
