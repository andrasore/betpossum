import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";

// Hands the current Keycloak access token to authenticated browser
// sessions for the socket.io handshake. NextAuth transparently refreshes
// the token inside the jwt callback, so a fresh value is returned on each
// call.
export async function GET(): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  return NextResponse.json({ token: session.accessToken });
}
