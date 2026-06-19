type PaperclipActor = {
  type: "none" | "board" | "agent" | string;
  source?: "local_implicit" | string;
  userId?: string | null;
  agentId?: string | null;
  companyId?: string | null;
  runId?: string | null;
  isInstanceAdmin?: boolean;
  companyIds?: string[];
  memberships?: Array<{
    companyId: string;
    status?: string | null;
    membershipRole?: string | null;
  }>;
  [key: string]: unknown;
};

declare module "express-serve-static-core" {
  interface Request {
    actor: PaperclipActor;
  }
}

declare global {
  namespace Express {
    interface Request {
      actor: PaperclipActor;
    }
  }
}

export {};
