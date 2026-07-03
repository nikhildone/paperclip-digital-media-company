import type { IssueTreeHold as SharedIssueTreeHold } from "@paperclipai/shared";

declare global {
  type IssueTreeHold = SharedIssueTreeHold;
}

export {};
