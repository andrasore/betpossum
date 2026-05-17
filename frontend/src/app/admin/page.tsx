'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box, Flex, Heading, IconButton, Input, Spinner, Table, Text,
} from '@chakra-ui/react';
import { Check, X } from 'lucide-react';
import useSWR from 'swr';
import { Navbar } from '@/components/Navbar';
import { fetchAdminUsers, setAdminUserBalance, type AdminUserRow } from '@/lib/api';
import { isAdmin } from '@/lib/keycloak';
import { useForceTheme } from '@/hooks/useForceTheme';

export default function AdminPage() {
  useForceTheme('light');
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) { router.replace('/login'); return; }
    if (!isAdmin(t)) { router.replace('/dashboard'); return; }
    setToken(t);
  }, [router]);

  const { data: users, isLoading, mutate } = useSWR<AdminUserRow[]>(
    token ? 'admin-users' : null,
    () => fetchAdminUsers(),
    { refreshInterval: 15_000 },
  );

  if (!token) return null;

  return (
    <Flex direction="column" h="100vh">
      <Navbar />
      <Box as="main" flex="1" overflowY="auto" p={6}>
        <Heading as="h2" size="md" mb={4}>Users</Heading>
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
                <Table.ColumnHeader textAlign="end">Balance (£)</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {users.map((u) => (
                <UserRow key={u.id} user={u} onSaved={mutate} />
              ))}
            </Table.Body>
          </Table.Root>
        ) : (
          <Text fontSize="sm" color="fg.muted">No users yet.</Text>
        )}
      </Box>
    </Flex>
  );
}

function UserRow({ user, onSaved }: { user: AdminUserRow; onSaved: () => void }) {
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
      setError(e instanceof Error ? e.message : 'Failed');
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
        <Text as="span" fontFamily="mono" fontSize="xs" color="fg.muted">{user.id}</Text>
      </Table.Cell>
      <Table.Cell>{user.email ?? <Text as="span" color="fg.muted">—</Text>}</Table.Cell>
      <Table.Cell>{user.name ?? <Text as="span" color="fg.muted">—</Text>}</Table.Cell>
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
            borderColor={dirty ? 'yellow.500' : undefined}
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
          <Text fontSize="xs" color="red.500" mt={1}>{error}</Text>
        )}
      </Table.Cell>
    </Table.Row>
  );
}
