import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PermissionScope, SystemRoleKey } from '@kenzo/shared';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { createApp } from '../../src/bootstrap';
import { hashPassword } from '../../src/infrastructure/crypto/password-hasher';
import { MailService } from '../../src/infrastructure/mail/mail.service';
import { NumberingService } from '../../src/infrastructure/numbering/numbering.service';
import { OutboxService } from '../../src/infrastructure/outbox/outbox.service';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { CompanyProvisioningService } from '../../src/modules/organization/company-provisioning.service';

export const PASSWORD = 'Correct-Horse-Battery-9';
export const ORIGIN = 'http://localhost:3000';

let cachedHash: Promise<string> | undefined;

export interface TestCompany {
  id: string;
  code: string;
  roleIds: Map<string, string>;
  departments: { eng: string; fin: string };
}

export interface TestUser {
  id: string;
  email: string;
}

/** A logged-in HTTP client that carries the session cookie and CSRF header. */
export class Client {
  constructor(
    readonly agent: TestAgent,
    readonly csrf: string,
  ) {}

  get(path: string) {
    return this.agent.get(`/api/v1${path}`);
  }
  post(path: string, body?: object) {
    return this.agent
      .post(`/api/v1${path}`)
      .set('x-csrf-token', this.csrf)
      .send(body ?? {});
  }
  put(path: string, body?: object) {
    return this.agent
      .put(`/api/v1${path}`)
      .set('x-csrf-token', this.csrf)
      .send(body ?? {});
  }
  patch(path: string, body?: object) {
    return this.agent
      .patch(`/api/v1${path}`)
      .set('x-csrf-token', this.csrf)
      .send(body ?? {});
  }
  delete(path: string) {
    return this.agent.delete(`/api/v1${path}`).set('x-csrf-token', this.csrf);
  }
}

export class Harness {
  app!: INestApplication;
  prisma!: PrismaService;

  async start(): Promise<this> {
    this.app = await createApp({ logger: false });
    await this.app.init();
    this.prisma = this.app.get(PrismaService);
    return this;
  }

  async stop(): Promise<void> {
    await this.app?.close();
  }

  get http() {
    return request(this.app.getHttpServer());
  }

  get mail(): MailService {
    return this.app.get(MailService);
  }

  async flushOutbox(): Promise<void> {
    const outbox = this.app.get(OutboxService);
    for (let i = 0; i < 10; i++) {
      const r = await outbox.dispatchOnce();
      if (r.processed + r.failed === 0) break;
    }
  }

  uid(prefix = ''): string {
    return `${prefix}${randomBytes(4).toString('hex')}`.toUpperCase();
  }

  /** Provisions an isolated company with two departments. */
  async company(): Promise<TestCompany> {
    const code = this.uid('T');
    return this.prisma.$transaction(
      async (tx) => {
        const provisioning = new CompanyProvisioningService(new NumberingService());
        const { company, roleIds } = await provisioning.provision(tx, { code, legalName: `Test ${code} Pvt Ltd`, displayName: `Test ${code}` }, null);
        const eng = await tx.department.create({ data: { companyId: company.id, code: 'ENG', name: 'Engineering' } });
        const fin = await tx.department.create({ data: { companyId: company.id, code: 'FIN', name: 'Finance' } });
        return { id: company.id, code, roleIds, departments: { eng: eng.id, fin: fin.id } };
      },
      { timeout: 60_000 },
    );
  }

  /** Creates an ACTIVE user holding the given system roles in the company. */
  async user(
    company: TestCompany,
    roles: SystemRoleKey[],
    opts: { departmentId?: string | null; managerId?: string; status?: 'ACTIVE' | 'INVITED' | 'DEACTIVATED' } = {},
  ): Promise<TestUser> {
    cachedHash ??= hashPassword(PASSWORD);
    const email = `${this.uid('u').toLowerCase()}@example.test`;
    const user = await this.prisma.user.create({
      data: {
        companyId: company.id,
        email,
        fullName: `User ${email.slice(0, 9)}`,
        status: opts.status ?? 'ACTIVE',
        passwordHash: await cachedHash,
        departmentId: opts.departmentId === undefined ? company.departments.eng : opts.departmentId,
        managerId: opts.managerId ?? null,
      },
    });
    for (const role of roles) {
      await this.prisma.userRoleAssignment.create({ data: { companyId: company.id, userId: user.id, roleId: company.roleIds.get(role)! } });
    }
    return { id: user.id, email };
  }

  /** Creates a custom role with explicit grants (for scope tests). */
  async customRole(company: TestCompany, grants: Array<[string, PermissionScope]>): Promise<string> {
    const role = await this.prisma.role.create({
      data: {
        companyId: company.id,
        key: this.uid('R'),
        name: 'Custom',
        permissions: { create: grants.map(([permissionKey, scope]) => ({ permissionKey, scope })) },
      },
    });
    return role.id;
  }

  async login(email: string, password = PASSWORD): Promise<Client> {
    const agent = request.agent(this.app.getHttpServer());
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    return new Client(agent, res.body.csrfToken as string);
  }

  async as(company: TestCompany, roles: SystemRoleKey[], opts: Parameters<Harness['user']>[2] = {}): Promise<{ user: TestUser; client: Client }> {
    const user = await this.user(company, roles, opts);
    return { user, client: await this.login(user.email) };
  }
}
