import type { ExecutionContext, INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { Request } from "express";
import request from "supertest";
import type { AuthUser } from "../common/current-user.decorator";
import { RolesGuard } from "../common/roles.guard";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

describe("AdminController (auth boundary)", () => {
  let app: INestApplication;
  let currentUser: AuthUser | null;
  const listUsers = jest.fn<Promise<unknown[]>, []>();
  const setUserBalance = jest.fn<Promise<void>, [string, number]>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        RolesGuard,
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (ctx: ExecutionContext) => {
              const req = ctx
                .switchToHttp()
                .getRequest<Request & { user?: AuthUser }>();
              if (!currentUser) {
                return false;
              }
              req.user = currentUser;
              return true;
            },
          },
        },
        {
          provide: AdminService,
          useValue: { listUsers, setUserBalance },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    listUsers.mockReset();
    setUserBalance.mockReset();
  });

  const authedAs = (roles: string[]): AuthUser =>
    ({
      id: "11111111-1111-1111-1111-111111111111",
      email: null,
      name: null,
      roles,
    }) as AuthUser;

  it("rejects a non-admin user with 403 on GET /admin/users", async () => {
    currentUser = authedAs(["user"]);
    await request(app.getHttpServer()).get("/admin/users").expect(403);
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("rejects a non-admin user with 403 on PUT /admin/users/:id/balance", async () => {
    currentUser = authedAs(["user"]);
    await request(app.getHttpServer())
      .put("/admin/users/22222222-2222-2222-2222-222222222222/balance")
      .send({ amount: 100 })
      .expect(403);
    expect(setUserBalance).not.toHaveBeenCalled();
  });

  it("allows an admin user through to GET /admin/users", async () => {
    listUsers.mockResolvedValue([{ id: "u1", balance: 50 }]);
    currentUser = authedAs(["admin"]);

    const res = await request(app.getHttpServer())
      .get("/admin/users")
      .expect(200);
    expect(res.body).toEqual([{ id: "u1", balance: 50 }]);
    expect(listUsers).toHaveBeenCalledTimes(1);
  });
});
