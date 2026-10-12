import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { PlatformAccessGate } from "@/components/platform-access-gate";

export default function OnboardingPage() {
  return (
    <PlatformAccessGate>
      <OnboardingFlow />
    </PlatformAccessGate>
  );
}
