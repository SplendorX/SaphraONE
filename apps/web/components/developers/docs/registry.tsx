// Which component renders each docs page.
import type { ComponentType } from "react";

import type { DocContext } from "@/components/developers/docs/context";
import {
  HowItWorksDoc,
  IntroductionDoc,
  QuickstartDoc,
  SandboxLiveDoc,
} from "@/components/developers/docs/content/get-started";
import {
  AcceptPaymentDoc,
  BusinessGuideDoc,
  FulfilOrdersDoc,
  GoingLiveDoc,
  SecurityDoc,
  TestingDoc,
} from "@/components/developers/docs/content/guides";
import {
  ApiOverviewDoc,
  AuthenticationDoc,
  CheckoutSessionsDoc,
  ErrorsDoc,
  IdempotencyDoc,
  PaginationDoc,
  WebhooksDoc,
} from "@/components/developers/docs/content/reference";
import { ChangelogDoc } from "@/components/developers/docs/content/resources";

export const docComponents: Record<string, ComponentType<{ ctx: DocContext }>> = {
  "": IntroductionDoc,
  "accept-a-payment": AcceptPaymentDoc,
  api: ApiOverviewDoc,
  "api/authentication": AuthenticationDoc,
  "api/checkout-sessions": CheckoutSessionsDoc,
  "api/errors": ErrorsDoc,
  "api/idempotency": IdempotencyDoc,
  "api/pagination": PaginationDoc,
  "api/webhooks": WebhooksDoc,
  "business-guide": BusinessGuideDoc,
  changelog: ChangelogDoc,
  "fulfil-orders": FulfilOrdersDoc,
  "going-live": GoingLiveDoc,
  "how-it-works": HowItWorksDoc,
  quickstart: QuickstartDoc,
  "sandbox-and-live": SandboxLiveDoc,
  security: SecurityDoc,
  testing: TestingDoc,
};
