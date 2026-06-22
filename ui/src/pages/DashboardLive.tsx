import { useEffect } from "react";
import { ArrowLeft, RadioTower } from "lucide-react";
import { Link } from "@/lib/router";
import { ActiveAgentsPanel } from "../components/ActiveAgentsPanel";
import { EmptyState } from "../components/EmptyState";
import { SinkDinkCeoControl } from "../components/SinkDinkCeoControl";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";

const DASHBOARD_LIVE_RUN_LIMIT = 50;

export function DashboardLive() {
  const { selectedCompanyId, companies } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Dashboard", href: "/dashboard" },
      { label: "Live runs" },
    ]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return (
      <div className="space-y-5">
        <SinkDinkCeoControl />
        <EmptyState
          icon={RadioTower}
          message={companies.length === 0 ? "Create a company to view classic live runs. SINK-DINK CEO control is ready above." : "Select a company to view classic live runs. SINK-DINK CEO control is ready above."}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SinkDinkCeoControl />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-foreground">Live agent runs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Active runs first, followed by the most recent completed runs.
          </p>
        </div>
        <div className="text-sm text-muted-foreground">Showing up to {DASHBOARD_LIVE_RUN_LIMIT}</div>
      </div>

      <ActiveAgentsPanel
        companyId={selectedCompanyId}
        title="Active / recent"
        minRunCount={DASHBOARD_LIVE_RUN_LIMIT}
        fetchLimit={DASHBOARD_LIVE_RUN_LIMIT}
        cardLimit={DASHBOARD_LIVE_RUN_LIMIT}
        gridClassName="gap-3 md:grid-cols-2 2xl:grid-cols-3"
        cardClassName="h-[420px]"
        emptyMessage="No active or recent agent runs."
        queryScope="dashboard-live"
        showMoreLink={false}
      />
    </div>
  );
}
