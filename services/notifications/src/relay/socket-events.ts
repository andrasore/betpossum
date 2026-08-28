import type { NotificationEvent } from "../generated/events";

/**
 * Maps NotificationEvent.kind → the socket.io event name the frontend listens
 * on. The frontend validates the JSON payload with the matching generated Zod
 * schema.
 *
 * Adding a notification type = add a message `$def` + `kind` enum value in
 * `/schemas`, then an entry here.
 */
export const SOCKET_EVENT: Record<NotificationEvent["kind"], string> = {
  oddsUpdated: "odds.updated",
  betHeld: "bet.held",
  betSettled: "bet.settled",
  balanceUpdated: "balance.updated",
};
